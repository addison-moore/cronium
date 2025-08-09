package ssh

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/auth"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

// RunnerInfo contains information about the runner binary
type RunnerInfo struct {
	Version  string
	Path     string
	Checksum string
}

// Executor implements SSH-based job execution using the runner binary
type Executor struct {
	config     config.SSHConfig
	log        *logrus.Logger
	
	// Connection pool
	pool *ConnectionPool
	
	// Runner binary info
	runnerInfo RunnerInfo
	
	// Runner cache
	runnerCache *RunnerCache
	
	// Runtime API settings
	runtimeHost string
	runtimePort int
	jwtSecret   string
	
	// Track active sessions
	mu       sync.RWMutex
	sessions map[string]*Session
	
	// Metrics
	metrics *ExecutorMetrics
}

// Session represents an active SSH session
type Session struct {
	jobID      string
	conn       *ssh.Client
	session    *ssh.Session
	cancelFunc context.CancelFunc
}

// NewExecutor creates a new SSH executor
func NewExecutor(cfg config.SSHConfig, runtimeHost string, runtimePort int, jwtSecret string, log *logrus.Logger) (*Executor, error) {
	// Create connection pool
	pool := NewConnectionPool(cfg.ConnectionPool, log)
	
	// Get runner binary info
	runnerInfo := RunnerInfo{
		Version:  getRunnerVersion(),
		Path:     getRunnerPath(),
		Checksum: getRunnerChecksum(),
	}
	
	// Create runner cache
	runnerCache := NewRunnerCache(log)
	
	// Create metrics tracker
	metrics := NewExecutorMetrics(logrus.NewEntry(log).WithField("component", "ssh-executor"))
	
	return &Executor{
		config:      cfg,
		log:         log,
		pool:        pool,
		runnerInfo:  runnerInfo,
		runnerCache: runnerCache,
		runtimeHost: runtimeHost,
		runtimePort: runtimePort,
		jwtSecret:   jwtSecret,
		sessions:    make(map[string]*Session),
		metrics:     metrics,
	}, nil
}

// Type returns the executor type
func (e *Executor) Type() types.JobType {
	return types.JobTypeSSH
}

// Validate checks if the job can be executed
func (e *Executor) Validate(job *types.Job) error {
	if job.Execution.Target.Type != types.TargetTypeServer {
		return fmt.Errorf("SSH executor requires server target")
	}
	
	if job.Execution.Target.ServerDetails == nil {
		return fmt.Errorf("server details required for SSH execution")
	}
	
	// Check for payload information in job metadata
	if job.Metadata == nil || job.Metadata["payloadPath"] == nil {
		return fmt.Errorf("payload path required in job metadata for runner execution")
	}
	
	return nil
}

// Execute runs the job via SSH using the runner
func (e *Executor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	updates := make(chan types.ExecutionUpdate, 100)
	
	go func() {
		defer close(updates)
		
		// Track execution time
		startTime := time.Now()
		
		// Send initial status
		e.sendUpdate(updates, types.UpdateTypeStatus, &types.StatusUpdate{
			Status:  types.JobStatusRunning,
			Message: "Connecting to server",
		})
		
		// Get connection from pool
		serverKey := fmt.Sprintf("%s:%d", job.Execution.Target.ServerDetails.Host, job.Execution.Target.ServerDetails.Port)
		conn, err := e.pool.Get(ctx, serverKey, job.Execution.Target.ServerDetails)
		if err != nil {
			e.sendError(updates, fmt.Errorf("failed to connect: %w", err), true)
			return
		}
		
		// Create session
		session, err := conn.NewSession()
		if err != nil {
			e.pool.Put(serverKey, conn, false) // Return connection as failed
			e.sendError(updates, fmt.Errorf("failed to create session: %w", err), true)
			return
		}
		
		// Create context for cancellation with timeout
		var execCtx context.Context
		var cancel context.CancelFunc
		
		// Apply timeout if specified (default to 1 hour if not set)
		timeout := time.Duration(job.Execution.Timeout) * time.Second
		if timeout <= 0 {
			timeout = time.Hour
		}
		
		execCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
		
		e.log.WithFields(logrus.Fields{
			"jobID":   job.ID,
			"timeout": timeout.String(),
		}).Debug("Execution timeout configured")
		
		// Track session
		sess := &Session{
			jobID:      job.ID,
			conn:       conn,
			session:    session,
			cancelFunc: cancel,
		}
		e.trackSession(job.ID, sess)
		defer e.untrackSession(job.ID)
		
		// Clean up session
		defer func() {
			session.Close()
			e.pool.Put(serverKey, conn, true) // Return connection as healthy
		}()
		
		// Execute with runner
		e.executeWithRunner(execCtx, sess, job, updates, startTime, timeout)
	}()
	
	return updates, nil
}

// executeWithRunner executes the job using the runner binary
func (e *Executor) executeWithRunner(ctx context.Context, sess *Session, job *types.Job, updates chan<- types.ExecutionUpdate, startTime time.Time, timeout time.Duration) {
	// Get payload path from job metadata
	payloadPath, ok := job.Metadata["payloadPath"].(string)
	if !ok {
		e.sendError(updates, fmt.Errorf("invalid payload path in job metadata"), true)
		return
	}
	
	// Ensure runner is deployed (create a new session for deployment)
	runnerPath := fmt.Sprintf("/tmp/cronium-runner-%s", e.runnerInfo.Version)
	deploySession, err := sess.conn.NewSession()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create deployment session: %w", err), true)
		return
	}
	defer deploySession.Close()
	
	if err := e.ensureRunnerDeployed(ctx, deploySession, sess.conn, job.Execution.Target.ServerDetails, runnerPath); err != nil {
		e.sendError(updates, fmt.Errorf("failed to deploy runner: %w", err), true)
		return
	}
	
	// Log runner version
	e.sendUpdate(updates, types.UpdateTypeLog, &types.LogEntry{
		Stream:    "system",
		Line:      fmt.Sprintf("Using Cronium Runner version %s", e.runnerInfo.Version),
		Timestamp: time.Now(),
		Sequence:  1,
	})
	
	// Determine if we should use API mode
	useAPIMode := e.runtimePort > 0 && e.jwtSecret != ""
	var tunnelManager *TunnelManager
	var apiEndpoint, apiToken string
	executionID := fmt.Sprintf("exec-%s-%d", job.ID, time.Now().Unix())
	
	if useAPIMode {
		// Try to set up reverse tunnel for API mode
		e.log.Info("Setting up SSH reverse tunnel for API mode")
		
		// Find an available remote port (starting from 9090)
		remotePort := 9090
		tunnelManager = NewTunnelManager(e.runtimeHost, e.runtimePort, remotePort, e.log)
		
		if err := tunnelManager.Start(sess.conn); err != nil {
			e.log.WithError(err).Warn("Failed to establish SSH tunnel, falling back to bundled mode")
			useAPIMode = false
		} else {
			// Generate JWT token for this execution
			jwtManager := auth.NewJWTManager(e.jwtSecret)
			userID := "" // Extract from job metadata if available
			eventID := "" // Extract from job metadata if available
			
			if job.Metadata != nil {
				if uid, ok := job.Metadata["userId"].(string); ok {
					userID = uid
				}
				if eid, ok := job.Metadata["eventId"].(string); ok {
					eventID = eid
				}
			}
			
			token, err := jwtManager.GenerateJobToken(job.ID, executionID, userID, eventID)
			if err != nil {
				e.log.WithError(err).Warn("Failed to generate JWT token, falling back to bundled mode")
				tunnelManager.Stop()
				useAPIMode = false
			} else {
				apiEndpoint = tunnelManager.GetRemoteEndpoint()
				apiToken = token
				e.log.WithFields(logrus.Fields{
					"endpoint": apiEndpoint,
					"executionId": executionID,
				}).Info("API mode enabled for execution")
			}
		}
	}
	
	// Clean up tunnel when done
	if tunnelManager != nil {
		defer tunnelManager.Stop()
	}
	
	// Copy payload to server (create a new session for file transfer)
	remotePayloadPath := fmt.Sprintf("/tmp/cronium-payload-%s.tar.gz", job.ID)
	copySession, err := sess.conn.NewSession()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create copy session: %w", err), true)
		return
	}
	defer copySession.Close()
	
	if err := e.copyPayloadToServer(copySession, sess.conn, payloadPath, remotePayloadPath); err != nil {
		e.sendError(updates, fmt.Errorf("failed to copy payload: %w", err), true)
		return
	}
	
	// Clean up payload after execution
	defer func() {
		cleanupSession, _ := sess.conn.NewSession()
		if cleanupSession != nil {
			cleanupSession.Run(fmt.Sprintf("rm -f %s", remotePayloadPath))
			cleanupSession.Close()
		}
	}()
	
	// Set up pipes for stdout and stderr
	stdout, err := sess.session.StdoutPipe()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create stdout pipe: %w", err), true)
		return
	}
	
	stderr, err := sess.session.StderrPipe()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create stderr pipe: %w", err), true)
		return
	}
	
	// Build environment variables for the runner
	envVars := make([]string, 0)
	
	// Always include job ID and execution ID
	envVars = append(envVars,
		fmt.Sprintf("CRONIUM_JOB_ID=%s", job.ID),
		fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", executionID),
	)
	
	if useAPIMode {
		envVars = append(envVars,
			fmt.Sprintf("CRONIUM_HELPER_MODE=api"),
			fmt.Sprintf("CRONIUM_API_ENDPOINT=%s", apiEndpoint),
			fmt.Sprintf("CRONIUM_API_TOKEN=%s", apiToken),
		)
	}
	
	// Build the command with environment variables
	var cmd string
	if e.log.GetLevel() == logrus.DebugLevel {
		cmd = fmt.Sprintf("%s --log-level=debug run %s", runnerPath, remotePayloadPath)
	} else {
		cmd = fmt.Sprintf("%s run %s", runnerPath, remotePayloadPath)
	}
	
	// Add environment variables using export
	if len(envVars) > 0 {
		exports := make([]string, len(envVars))
		for i, env := range envVars {
			exports[i] = fmt.Sprintf("export %s", env)
		}
		cmd = fmt.Sprintf("%s && %s", strings.Join(exports, " && "), cmd)
	}
	
	if err := sess.session.Start(cmd); err != nil {
		e.sendError(updates, fmt.Errorf("failed to start runner: %w", err), true)
		return
	}
	
	// Stream output
	var wg sync.WaitGroup
	wg.Add(2)
	
	sequence := int64(0)
	sequenceMu := sync.Mutex{}
	
	// Read stdout
	go func() {
		defer wg.Done()
		e.streamOutput(stdout, "stdout", updates, &sequence, &sequenceMu)
	}()
	
	// Read stderr
	go func() {
		defer wg.Done()
		e.streamOutput(stderr, "stderr", updates, &sequence, &sequenceMu)
	}()
	
	// Wait for command to complete or context cancellation
	done := make(chan error, 1)
	go func() {
		wg.Wait()
		done <- sess.session.Wait()
	}()
	
	select {
	case <-ctx.Done():
		// Context cancelled or timed out
		sess.session.Signal(ssh.SIGTERM)
		time.Sleep(5 * time.Second)
		sess.session.Signal(ssh.SIGKILL)
		
		// Determine if it was a timeout or cancellation
		duration := time.Since(startTime)
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			e.log.WithField("jobID", job.ID).Warn("Execution timed out")
			e.sendError(updates, fmt.Errorf("execution timed out after %v", timeout), true)
			e.metrics.RecordExecution(job.ID, false, duration, true)
		} else {
			e.sendError(updates, fmt.Errorf("execution cancelled"), true)
			e.metrics.RecordExecution(job.ID, false, duration, false)
		}
		
	case err := <-done:
		// Command completed
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*ssh.ExitError); ok {
				exitCode = exitErr.ExitStatus()
			} else {
				e.sendError(updates, fmt.Errorf("runner failed: %w", err), true)
				e.metrics.RecordExecution(job.ID, false, time.Since(startTime), false)
				return
			}
		}
		
		// Record execution metrics
		e.metrics.RecordExecution(job.ID, exitCode == 0, time.Since(startTime), false)
		
		// Send completion update with appropriate status
		status := types.JobStatusCompleted
		if exitCode != 0 {
			status = types.JobStatusFailed
		}
		
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   status,
			ExitCode: &exitCode,
			Message:  fmt.Sprintf("Runner exited with code %d", exitCode),
		})
	}
}

// ensureRunnerDeployed checks if the runner is deployed and deploys it if necessary
func (e *Executor) ensureRunnerDeployed(ctx context.Context, session *ssh.Session, conn *ssh.Client, server *types.ServerDetails, runnerPath string) error {
	const maxRetries = 3
	var lastErr error
	
	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Check for context cancellation
		select {
		case <-ctx.Done():
			return fmt.Errorf("deployment cancelled: %w", ctx.Err())
		default:
		}
		
		err := e.deployRunnerWithRetry(ctx, session, conn, server, runnerPath)
		if err == nil {
			return nil
		}
		
		lastErr = err
		e.log.WithFields(logrus.Fields{
			"serverID": server.ID,
			"attempt":  attempt,
			"error":    err,
		}).Warn("Runner deployment attempt failed")
		
		if attempt < maxRetries {
			// Exponential backoff: 2s, 4s, 8s
			backoff := time.Duration(attempt) * 2 * time.Second
			select {
			case <-time.After(backoff):
				// Continue to next attempt
			case <-ctx.Done():
				return fmt.Errorf("deployment cancelled during retry: %w", ctx.Err())
			}
		}
	}
	
	return fmt.Errorf("failed to deploy runner after %d attempts: %w", maxRetries, lastErr)
}

// deployRunnerWithRetry performs a single deployment attempt
func (e *Executor) deployRunnerWithRetry(ctx context.Context, session *ssh.Session, conn *ssh.Client, server *types.ServerDetails, runnerPath string) error {
	deployStart := time.Now()
	
	// Check cache first
	cachedEntry, isValid := e.runnerCache.Get(server.ID)
	if isValid && cachedEntry.Version == e.runnerInfo.Version {
		e.log.WithFields(logrus.Fields{
			"serverID": server.ID,
			"version":  cachedEntry.Version,
		}).Debug("Using cached runner deployment")
		e.metrics.RecordDeployment(server.ID, true, true, time.Since(deployStart))
		return nil
	}
	
	// If we have a cached entry but it needs verification
	if cachedEntry != nil && cachedEntry.Version == e.runnerInfo.Version {
		// Quick version check
		checkCmd := fmt.Sprintf("test -f %s && %s version | grep -q %s", runnerPath, runnerPath, e.runnerInfo.Version)
		if err := session.Run(checkCmd); err == nil {
			// Runner still valid, update cache
			e.runnerCache.UpdateVerified(server.ID)
			e.log.Debug("Runner verified from cache")
			return nil
		}
		// Runner invalid, remove from cache
		e.runnerCache.Remove(server.ID)
	}
	
	// Check if runner exists and has correct version
	checkCmd := fmt.Sprintf("test -f %s && %s version | grep -q %s", runnerPath, runnerPath, e.runnerInfo.Version)
	if err := session.Run(checkCmd); err == nil {
		// Runner exists and has correct version, add to cache
		e.runnerCache.Set(server.ID, &RunnerCacheEntry{
			ServerID:     server.ID,
			RunnerPath:   runnerPath,
			Version:      e.runnerInfo.Version,
			Checksum:     e.runnerInfo.Checksum,
			DeployedAt:   time.Now(),
			LastVerified: time.Now(),
		})
		e.log.Debug("Runner already deployed, added to cache")
		return nil
	}
	
	// Need to deploy runner
	e.log.WithFields(logrus.Fields{
		"serverID": server.ID,
		"version":  e.runnerInfo.Version,
	}).Info("Deploying runner to server")
	
	// Ensure deployment directory exists
	mkdirSession, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create mkdir session: %w", err)
	}
	defer mkdirSession.Close()
	
	runnerDir := "/tmp/cronium"
	if err := mkdirSession.Run(fmt.Sprintf("mkdir -p %s", runnerDir)); err != nil {
		return fmt.Errorf("failed to create runner directory: %w", err)
	}
	
	// Create new session for deployment
	deploySession, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create deployment session: %w", err)
	}
	defer deploySession.Close()
	
	// Copy runner binary with cleanup on failure
	localRunnerPath := e.runnerInfo.Path
	if err := e.copyFileToServer(deploySession, conn, localRunnerPath, runnerPath); err != nil {
		// Clean up partial deployment
		cleanupSession, _ := conn.NewSession()
		if cleanupSession != nil {
			cleanupSession.Run(fmt.Sprintf("rm -f %s", runnerPath))
			cleanupSession.Close()
		}
		return fmt.Errorf("failed to copy runner binary: %w", err)
	}
	
	// Make runner executable
	chmodSession, err := conn.NewSession()
	if err != nil {
		// Clean up partial deployment
		cleanupSession, _ := conn.NewSession()
		if cleanupSession != nil {
			cleanupSession.Run(fmt.Sprintf("rm -f %s", runnerPath))
			cleanupSession.Close()
		}
		return fmt.Errorf("failed to create chmod session: %w", err)
	}
	defer chmodSession.Close()
	
	if err := chmodSession.Run(fmt.Sprintf("chmod +x %s", runnerPath)); err != nil {
		// Clean up partial deployment
		cleanupSession, _ := conn.NewSession()
		if cleanupSession != nil {
			cleanupSession.Run(fmt.Sprintf("rm -f %s", runnerPath))
			cleanupSession.Close()
		}
		return fmt.Errorf("failed to make runner executable: %w", err)
	}
	
	// Verify deployment
	verifySession, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create verify session: %w", err)
	}
	defer verifySession.Close()
	
	verifyCmd := fmt.Sprintf("test -x %s && %s version", runnerPath, runnerPath)
	if err := verifySession.Run(verifyCmd); err != nil {
		// Clean up failed deployment
		cleanupSession, _ := conn.NewSession()
		if cleanupSession != nil {
			cleanupSession.Run(fmt.Sprintf("rm -f %s", runnerPath))
			cleanupSession.Close()
		}
		return fmt.Errorf("failed to verify runner deployment: %w", err)
	}
	
	// Add to cache
	e.runnerCache.Set(server.ID, &RunnerCacheEntry{
		ServerID:     server.ID,
		RunnerPath:   runnerPath,
		Version:      e.runnerInfo.Version,
		Checksum:     e.runnerInfo.Checksum,
		DeployedAt:   time.Now(),
		LastVerified: time.Now(),
	})
	
	e.log.WithField("serverID", server.ID).Info("Runner deployed successfully")
	e.metrics.RecordDeployment(server.ID, true, false, time.Since(deployStart))
	return nil
}

// copyPayloadToServer copies a payload file to the server
func (e *Executor) copyPayloadToServer(session *ssh.Session, conn *ssh.Client, localPath, remotePath string) error {
	// Read local file
	data, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("failed to read payload file: %w", err)
	}
	
	// Create new session for copy
	copySession, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create copy session: %w", err)
	}
	defer copySession.Close()
	
	// Set up stdin pipe
	stdin, err := copySession.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	
	// Start cat command
	if err := copySession.Start(fmt.Sprintf("cat > %s", remotePath)); err != nil {
		return fmt.Errorf("failed to start cat command: %w", err)
	}
	
	// Write data
	if _, err := stdin.Write(data); err != nil {
		return fmt.Errorf("failed to write data: %w", err)
	}
	stdin.Close()
	
	// Wait for completion
	if err := copySession.Wait(); err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}
	
	return nil
}

// copyFileToServer copies a file to the server using scp-like functionality
func (e *Executor) copyFileToServer(session *ssh.Session, conn *ssh.Client, localPath, remotePath string) error {
	return e.copyPayloadToServer(session, conn, localPath, remotePath)
}

// streamOutput reads from a reader and sends log updates
func (e *Executor) streamOutput(reader io.Reader, stream string, updates chan<- types.ExecutionUpdate, sequence *int64, sequenceMu *sync.Mutex) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		
		// Send log entry
		sequenceMu.Lock()
		*sequence++
		seq := *sequence
		sequenceMu.Unlock()
		
		e.sendUpdate(updates, types.UpdateTypeLog, &types.LogEntry{
			Stream:    stream,
			Line:      line,
			Timestamp: time.Now(),
			Sequence:  seq,
		})
	}
	
	if err := scanner.Err(); err != nil {
		e.log.WithError(err).Errorf("Error reading %s stream", stream)
	}
}

// Cleanup performs cleanup after execution
func (e *Executor) Cleanup(ctx context.Context, job *types.Job) error {
	e.mu.RLock()
	sess, exists := e.sessions[job.ID]
	e.mu.RUnlock()
	
	if exists {
		// Cancel the session
		sess.cancelFunc()
		
		// Close SSH session
		if sess.session != nil {
			sess.session.Close()
		}
		
		// Clean up remote files if we have a connection
		if sess.conn != nil && job.Execution.Target.ServerDetails != nil {
			// Clean up payload file
			payloadPath := fmt.Sprintf("/tmp/cronium/payloads/%s.tar.gz", job.ID)
			cleanupSession, err := sess.conn.NewSession()
			if err == nil {
				e.log.WithField("jobID", job.ID).Debug("Cleaning up remote payload file")
				cleanupCmd := fmt.Sprintf("rm -f %s", payloadPath)
				if err := cleanupSession.Run(cleanupCmd); err != nil {
					e.log.WithError(err).Warn("Failed to clean up payload file")
				}
				cleanupSession.Close()
			}
			
			// Return connection to pool
			serverKey := fmt.Sprintf("%s:%d", 
				job.Execution.Target.ServerDetails.Host, 
				job.Execution.Target.ServerDetails.Port)
			e.pool.Put(serverKey, sess.conn, false)
		}
		
		e.untrackSession(job.ID)
	}
	
	return nil
}

// trackSession tracks an active session
func (e *Executor) trackSession(jobID string, session *Session) {
	e.mu.Lock()
	e.sessions[jobID] = session
	e.mu.Unlock()
}

// untrackSession removes a session from tracking
func (e *Executor) untrackSession(jobID string) {
	e.mu.Lock()
	delete(e.sessions, jobID)
	e.mu.Unlock()
}

// sendUpdate sends an execution update
func (e *Executor) sendUpdate(updates chan<- types.ExecutionUpdate, updateType types.UpdateType, data interface{}) {
	select {
	case updates <- types.ExecutionUpdate{
		Type:      updateType,
		Timestamp: time.Now(),
		Data:      data,
	}:
	default:
		e.log.Warn("Updates channel full, dropping update")
	}
}

// sendError sends an error update
func (e *Executor) sendError(updates chan<- types.ExecutionUpdate, err error, fatal bool) {
	status := types.JobStatusFailed
	if !fatal {
		status = types.JobStatusRunning
	}
	
	e.sendUpdate(updates, types.UpdateTypeError, &types.StatusUpdate{
		Status:  status,
		Message: err.Error(),
		Error:   types.ErrorDetailsFromError(err),
	})
}

// Helper functions to get runner info
func getRunnerVersion() string {
	// In production, this would read from a config or build info
	version := os.Getenv("RUNNER_VERSION")
	if version == "" {
		return "dev"
	}
	return version
}

func getRunnerPath() string {
	// Get runner path based on architecture
	arch := "linux-amd64" // Default
	if runtime := os.Getenv("RUNNER_ARCH"); runtime != "" {
		arch = runtime
	}
	
	runnerDir := os.Getenv("RUNNER_ARTIFACTS_DIR")
	if runnerDir == "" {
		runnerDir = "/app/artifacts/runners"
	}
	
	version := getRunnerVersion()
	return filepath.Join(runnerDir, version, fmt.Sprintf("cronium-runner-%s", arch))
}

func getRunnerChecksum() string {
	// In production, this would read the checksum file
	checksumPath := getRunnerPath() + ".sha256"
	data, err := os.ReadFile(checksumPath)
	if err != nil {
		return ""
	}
	parts := strings.Fields(string(data))
	if len(parts) > 0 {
		return parts[0]
	}
	return ""
}