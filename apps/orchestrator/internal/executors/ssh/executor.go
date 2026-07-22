package ssh

import (
	"bufio"
	"context"
	stderrors "errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/auth"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/payload"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/retry"
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
	config        config.SSHConfig
	timeoutConfig config.TimeoutConfig
	log           *logrus.Logger
	apiClient     *api.Client

	// Connection pool
	pool *ConnectionPool

	// Runner binary info
	runnerInfo   RunnerInfo
	runnerInfoMu sync.Mutex

	// Runner cache
	runnerCache *RunnerCache

	// Payload signer (nil when signing is unavailable; runner falls back to
	// legacy unverified mode)
	signer *payload.Signer

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
	jobID                  string
	conn                   *ssh.Client
	session                *ssh.Session
	cancelFunc             context.CancelFunc
	connectionID           string
	remotePayloadMu        sync.Mutex
	remotePayloadDirectory string
}

// NewExecutor creates a new SSH executor
func NewExecutor(cfg config.SSHConfig, apiClient *api.Client, runtimeHost string, runtimePort int, jwtSecret string, log *logrus.Logger) (*Executor, error) {
	// Create connection pool
	pool, err := NewConnectionPool(cfg.ConnectionPool, cfg.Security, cfg.CircuitBreaker, log)
	if err != nil {
		return nil, err
	}

	// Get runner binary info. A missing artifact does not disable non-SSH jobs,
	// but SSH deployment will fail closed until a valid artifact and checksum
	// manifest are available.
	runnerPath := getRunnerPath()
	runnerChecksum, checksumErr := loadTrustedRunnerChecksum(runnerPath)
	if checksumErr != nil {
		log.WithError(checksumErr).WithField("runnerPath", runnerPath).
			Warn("SSH runner artifact is unavailable or failed local integrity verification")
	}
	runnerInfo := RunnerInfo{
		Version:  getRunnerVersion(),
		Path:     runnerPath,
		Checksum: runnerChecksum,
	}

	// Create runner cache
	runnerCache := NewRunnerCache(log)

	// Load or create the payload signing key. Signing is MANDATORY (HI-15): if
	// the key cannot be loaded or created we refuse to start SSH execution
	// rather than deploy unsigned payloads a tampering attacker could exploit.
	signer, err := payload.LoadOrCreateSigner(cfg.Security.PayloadSigningKeyFile)
	if err != nil {
		return nil, fmt.Errorf(
			"payload signing key unavailable (%s): refusing to start SSH execution — payload signing is mandatory (HI-15): %w",
			cfg.Security.PayloadSigningKeyFile, err,
		)
	}

	// Create metrics tracker
	metrics := NewExecutorMetrics(logrus.NewEntry(log).WithField("component", "ssh-executor"))

	return &Executor{
		config:        cfg,
		timeoutConfig: config.LoadTimeoutConfig(),
		log:           log,
		apiClient:     apiClient,
		pool:          pool,
		runnerInfo:    runnerInfo,
		runnerCache:   runnerCache,
		signer:        signer,
		runtimeHost:   runtimeHost,
		runtimePort:   runtimePort,
		jwtSecret:     jwtSecret,
		sessions:      make(map[string]*Session),
		metrics:       metrics,
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

	// Check for script content or payload path (backwards compatibility)
	if job.Execution.Script == nil || job.Execution.Script.Content == "" {
		// Check for legacy payload path
		if job.Metadata == nil || job.Metadata["payloadPath"] == nil {
			return fmt.Errorf("script content or payload path required for SSH execution")
		}
	}

	return nil
}

// Execute runs the job via SSH using the runner
func (e *Executor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	updates := make(chan types.ExecutionUpdate, 100)

	go func() {
		defer close(updates)

		// Initialize phase timing
		timing := NewExecutionTiming()
		timing.ServerName = job.Execution.Target.ServerDetails.Name

		// Send initial status
		e.sendUpdate(updates, types.UpdateTypeStatus, &types.StatusUpdate{
			Status:  types.JobStatusRunning,
			Message: "Connecting to server",
		})

		// Check if execution ID was provided (from multi-server executor)
		var executionID string
		var executionExists bool
		if job.Metadata != nil {
			if eid, ok := job.Metadata["executionId"].(string); ok && eid != "" {
				executionID = eid
				executionExists = true
			}
		}

		// Generate execution ID if not provided
		if executionID == "" {
			executionID = fmt.Sprintf("exec_%s_%d", job.ID, time.Now().Unix())
		}

		// Create execution record in the database only if it doesn't exist
		if e.apiClient != nil {
			if !executionExists {
				serverID := job.Execution.Target.ServerDetails.ID
				serverName := job.Execution.Target.ServerDetails.Name
				if err := e.apiClient.CreateExecution(ctx, executionID, job.ID, &serverID, &serverName); err != nil {
					e.log.WithError(err).Warn("Failed to create execution record")
					// Continue anyway - execution tracking is not critical for job success
				}
			}

			// Mark execution as started with setup phase timing
			if err := e.apiClient.UpdateExecution(ctx, executionID, types.JobStatusRunning, timing.ToExecutionStatusUpdate()); err != nil {
				e.log.WithError(err).Warn("Failed to update execution status to running")
			}
		}

		// SETUP PHASE: Get connection from pool
		timing.ConnectionStart = time.Now()
		server := job.Execution.Target.ServerDetails
		conn, connectionID, err := e.pool.Get(ctx, server)
		timing.ConnectionEnd = time.Now()
		if err != nil {
			connError := fmt.Errorf("SSH connection failed to %s:%d: %w", server.Host, server.Port, err)
			e.sendError(updates, connError, true)

			// Update execution record with connection failure and timing
			if e.apiClient != nil {
				timing.MarkCleanupComplete() // Mark all phases as complete on error
				updateData := timing.ToExecutionStatusUpdate()
				exitCode := -3 // Indicate connection failure
				errorMsg := connError.Error()
				updateData.ExitCode = &exitCode
				updateData.Error = &errorMsg

				apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
				defer apiCancel()
				if err := e.apiClient.UpdateExecution(apiCtx, executionID, types.JobStatusFailed, updateData); err != nil {
					e.log.WithError(err).Warn("Failed to update execution with connection failure")
				}
			}

			e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
				Status:   types.JobStatusFailed,
				ExitCode: intPtr(-3),
				Message:  connError.Error(),
			})
			return
		}

		// Create session
		session, err := conn.NewSession()
		if err != nil {
			e.pool.Put(connectionID, conn, false) // Return connection as failed
			sessionError := fmt.Errorf("failed to create SSH session: %w", err)
			e.sendError(updates, sessionError, true)

			// Update execution record with session failure and timing
			if e.apiClient != nil {
				timing.MarkCleanupComplete() // Mark all phases as complete on error
				updateData := timing.ToExecutionStatusUpdate()
				exitCode := -4 // Indicate session failure
				errorMsg := sessionError.Error()
				updateData.ExitCode = &exitCode
				updateData.Error = &errorMsg

				apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
				defer apiCancel()
				if err := e.apiClient.UpdateExecution(apiCtx, executionID, types.JobStatusFailed, updateData); err != nil {
					e.log.WithError(err).Warn("Failed to update execution with session failure")
				}
			}

			e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
				Status:   types.JobStatusFailed,
				ExitCode: intPtr(-4),
				Message:  sessionError.Error(),
			})
			return
		}

		// Create context for cancellation with timeout
		var execCtx context.Context
		var cancel context.CancelFunc

		// Apply timeout if specified (default to 1 hour if not set)
		timeout := job.Execution.Timeout
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
			jobID:        job.ID,
			conn:         conn,
			session:      session,
			cancelFunc:   cancel,
			connectionID: connectionID,
		}
		e.trackSession(job.ID, sess)
		defer e.untrackSession(job.ID)

		// Clean up session
		defer func() {
			session.Close()
			e.pool.Put(connectionID, conn, true) // Return connection as healthy
		}()

		// Execute with runner
		e.executeWithRunner(execCtx, sess, job, updates, timing, timeout, executionID)
	}()

	return updates, nil
}

// executeWithRunner executes the job using the runner binary
func (e *Executor) executeWithRunner(ctx context.Context, sess *Session, job *types.Job, updates chan<- types.ExecutionUpdate, timing *ExecutionTiming, timeout time.Duration, executionID string) {

	// SETUP PHASE: Create or get payload path
	timing.PayloadCreateStart = time.Now()
	payloadPath, err := e.createPayloadForJob(job, executionID)
	timing.PayloadCreateEnd = time.Now()
	if err != nil {
		payloadError := fmt.Errorf("failed to create payload: %w", err)
		e.sendError(updates, payloadError, true)

		// Update execution record with payload failure and timing
		if e.apiClient != nil {
			timing.MarkCleanupComplete() // Mark all phases as complete on error
			updateData := timing.ToExecutionStatusUpdate()
			exitCode := -5 // Indicate payload failure
			errorMsg := payloadError.Error()
			updateData.ExitCode = &exitCode
			updateData.Error = &errorMsg

			apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer apiCancel()
			if err := e.apiClient.UpdateExecution(apiCtx, executionID, types.JobStatusFailed, updateData); err != nil {
				e.log.WithError(err).Warn("Failed to update execution with payload failure")
			}
		}

		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   types.JobStatusFailed,
			ExitCode: intPtr(-5),
			Message:  payloadError.Error(),
		})
		return
	}
	defer e.cleanupPayload(payloadPath, job)

	// SETUP PHASE: Ensure the trusted runner is deployed.
	timing.RunnerDeployStart = time.Now()
	runnerPath, runnerChecksum, err := e.ensureRunnerDeployed(ctx, sess.conn, job.Execution.Target.ServerDetails)
	if err != nil {
		timing.RunnerDeployEnd = time.Now()
		deployError := fmt.Errorf("failed to deploy runner: %w", err)
		e.sendError(updates, deployError, true)

		// Update execution record with deployment failure and timing
		if e.apiClient != nil {
			timing.MarkCleanupComplete() // Mark all phases as complete on error
			updateData := timing.ToExecutionStatusUpdate()
			exitCode := -6 // Indicate deployment failure
			errorMsg := deployError.Error()
			updateData.ExitCode = &exitCode
			updateData.Error = &errorMsg

			apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer apiCancel()
			if err := e.apiClient.UpdateExecution(apiCtx, executionID, types.JobStatusFailed, updateData); err != nil {
				e.log.WithError(err).Warn("Failed to update execution with deployment failure")
			}
		}

		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   types.JobStatusFailed,
			ExitCode: intPtr(-6),
			Message:  deployError.Error(),
		})
		return
	}
	timing.RunnerDeployEnd = time.Now()

	// SETUP PHASE: Verify runner is ready
	timing.RunnerVerifyStart = time.Now()
	if err := verifyRemoteRunner(sess.conn, runnerPath, runnerChecksum); err != nil {
		e.runnerCache.Remove(runnerCacheKey(job.Execution.Target.ServerDetails))
		e.sendError(updates, fmt.Errorf("failed to verify runner integrity: %w", err), true)
		return
	}
	timing.RunnerVerifyEnd = time.Now()

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

	if useAPIMode {
		// SETUP PHASE: Set up reverse tunnel for API mode
		timing.TunnelSetupStart = time.Now()
		e.log.Info("Setting up SSH reverse tunnel for API mode")

		// Find an available remote port (starting from 9090)
		remotePort := 9090
		tunnelManager = NewTunnelManager(e.runtimeHost, e.runtimePort, remotePort, e.log)

		if err := tunnelManager.Start(sess.conn); err != nil {
			timing.TunnelSetupEnd = time.Now()
			e.log.WithError(err).Warn("Failed to establish SSH tunnel, falling back to bundled mode")
			useAPIMode = false
		} else {
			timing.TunnelSetupEnd = time.Now()
			// Generate JWT token for this execution
			jwtManager := auth.NewJWTManager(e.jwtSecret)
			userID := ""  // Extract from job metadata if available
			eventID := "" // Extract from job metadata if available

			if job.Metadata != nil {
				if uid, ok := job.Metadata["userId"].(string); ok {
					userID = uid
				}
				if eid, ok := job.Metadata["eventId"].(string); ok {
					eventID = eid
				}
			}

			token, err := jwtManager.GenerateJobToken(job.ID, executionID, userID, eventID, job.CapabilityToken)
			if err != nil {
				e.log.WithError(err).Warn("Failed to generate JWT token, falling back to bundled mode")
				tunnelManager.Stop()
				useAPIMode = false
			} else {
				apiEndpoint = tunnelManager.GetRemoteEndpoint()
				apiToken = token
				e.log.WithFields(logrus.Fields{
					"endpoint":    apiEndpoint,
					"executionId": executionID,
				}).Info("API mode enabled for execution")
			}
		}
	}

	// Clean up tunnel when done
	if tunnelManager != nil {
		defer tunnelManager.Stop()
	}

	// SETUP PHASE: Create a private randomized directory and atomically publish
	// the payload (and signature, when present) inside it.
	timing.PayloadTransferStart = time.Now()
	remotePayload, err := createRemotePayloadDirectory(sess.conn)
	if err != nil {
		timing.PayloadTransferEnd = time.Now()
		e.sendError(updates, fmt.Errorf("failed to prepare remote payload directory: %w", err), true)
		return
	}
	sess.setRemotePayloadDirectory(remotePayload.Directory)
	defer func() {
		if err := cleanupRemotePayloadDirectory(sess.conn, remotePayload.Directory); err != nil {
			e.log.WithError(err).Warn("Failed to clean up private remote payload directory")
		}
		sess.clearRemotePayloadDirectory(remotePayload.Directory)
	}()

	if err := uploadPayloadToServer(sess.conn, payloadPath, remotePayload); err != nil {
		timing.PayloadTransferEnd = time.Now()
		e.sendError(updates, fmt.Errorf("failed to copy payload: %w", err), true)
		return
	}
	timing.PayloadTransferEnd = time.Now()
	remotePayloadPath := remotePayload.PayloadPath

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
		shellExport("CRONIUM_JOB_ID", job.ID),
		shellExport("CRONIUM_EXECUTION_ID", executionID),
	)

	// Pass the payload verification key so the runner enforces the signature
	if verifyKey := e.payloadVerifyKey(payloadPath); verifyKey != "" {
		envVars = append(envVars, shellExport("CRONIUM_VERIFY_KEY", verifyKey))
	}

	if useAPIMode {
		envVars = append(envVars,
			shellExport("CRONIUM_HELPER_MODE", "api"),
			shellExport("CRONIUM_API_ENDPOINT", apiEndpoint),
			shellExport("CRONIUM_API_TOKEN", apiToken),
		)
	}

	// Hash the runner again in the final remote shell immediately before exec.
	// This narrows the verification-to-execution window and fails closed if a
	// previously cached binary was replaced during setup.
	cmd := buildRunnerCommand(runnerPath, runnerChecksum, remotePayloadPath, e.log.GetLevel() == logrus.DebugLevel)

	// Add environment variables using export
	if len(envVars) > 0 {
		cmd = fmt.Sprintf("%s && %s", strings.Join(envVars, " && "), cmd)
	}

	// EXECUTION PHASE: Mark setup complete and start execution
	timing.MarkSetupComplete()
	if err := sess.session.Start(cmd); err != nil {
		e.sendError(updates, fmt.Errorf("failed to start runner: %w", err), true)
		return
	}

	// Stream output and collect for execution record
	var wg sync.WaitGroup
	wg.Add(2)

	sequence := int64(0)
	sequenceMu := sync.Mutex{}

	// Buffers to collect output
	var stdoutBuf, stderrBuf strings.Builder
	var outputMu sync.Mutex

	// Create a context for the streaming goroutines
	streamCtx, cancelStream := context.WithCancel(context.Background())
	defer cancelStream()

	// Read stdout
	go func() {
		defer wg.Done()
		e.streamOutputWithContextAndCollect(streamCtx, stdout, "stdout", updates, &sequence, &sequenceMu, &stdoutBuf, &outputMu)
	}()

	// Read stderr
	go func() {
		defer wg.Done()
		e.streamOutputWithContextAndCollect(streamCtx, stderr, "stderr", updates, &sequence, &sequenceMu, &stderrBuf, &outputMu)
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
		// Mark execution as complete and start cleanup
		timing.MarkExecutionComplete()

		// First cancel the streaming goroutines
		cancelStream()

		// Then terminate the SSH session
		sess.session.Signal(ssh.SIGTERM)
		time.Sleep(5 * time.Second)
		sess.session.Signal(ssh.SIGKILL)

		// Determine if it was a timeout or cancellation
		var exitCode int
		var finalStatus types.JobStatus
		var statusMessage string

		if stderrors.Is(ctx.Err(), context.DeadlineExceeded) {
			e.log.WithField("jobID", job.ID).Warn("Execution timed out")
			e.sendError(updates, fmt.Errorf("execution timed out after %v", timeout), true)
			totalDuration := time.Duration(timing.GetTotalDuration()) * time.Millisecond
			e.metrics.RecordExecution(job.ID, false, totalDuration, true)
			exitCode = -1 // Indicate timeout
			finalStatus = types.JobStatusFailed
			statusMessage = fmt.Sprintf("SSH execution timed out after %v", timeout)
		} else {
			e.sendError(updates, fmt.Errorf("execution cancelled"), true)
			totalDuration := time.Duration(timing.GetTotalDuration()) * time.Millisecond
			e.metrics.RecordExecution(job.ID, false, totalDuration, false)
			exitCode = -2 // Indicate cancellation
			finalStatus = types.JobStatusFailed
			statusMessage = "SSH execution cancelled"
		}

		// Update execution record with timeout/cancellation status and timing
		if e.apiClient != nil {
			timing.MarkCleanupComplete()
			updateData := timing.ToExecutionStatusUpdate()
			updateData.ExitCode = &exitCode

			// Include output collected so far
			outputMu.Lock()
			outputStr := stdoutBuf.String()
			errorStr := stderrBuf.String()
			outputMu.Unlock()

			if outputStr != "" {
				updateData.Output = &outputStr
			}
			if errorStr != "" {
				updateData.Error = &errorStr
			} else {
				// Add timeout error if no stderr captured
				updateData.Error = &statusMessage
			}

			// Use a fresh context for the API call
			apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer apiCancel()
			if err := e.apiClient.UpdateExecution(apiCtx, executionID, finalStatus, updateData); err != nil {
				e.log.WithError(err).Warn("Failed to update execution timeout status")
			}
		}

		// Send completion update
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   finalStatus,
			ExitCode: &exitCode,
			Message:  statusMessage,
		})

	case err := <-done:
		// Command completed - mark execution phase complete
		timing.MarkExecutionComplete()

		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*ssh.ExitError); ok {
				exitCode = exitErr.ExitStatus()
				if exitCode == runnerIntegrityFailureExitCode {
					e.runnerCache.Remove(runnerCacheKey(job.Execution.Target.ServerDetails))
				}
			} else {
				e.sendError(updates, fmt.Errorf("runner failed: %w", err), true)
				totalSeconds := time.Duration(timing.GetTotalDuration()) * time.Millisecond
				e.metrics.RecordExecution(job.ID, false, totalSeconds, false)
				return
			}
		}

		// Record execution metrics
		totalSeconds := time.Duration(timing.GetTotalDuration()) * time.Millisecond
		e.metrics.RecordExecution(job.ID, exitCode == 0, totalSeconds, false)

		// Send completion update with appropriate status
		status := types.JobStatusCompleted
		if exitCode != 0 {
			status = types.JobStatusFailed
		}

		// Update execution record with completion status, output and timing
		if e.apiClient != nil {
			timing.MarkCleanupComplete()
			updateData := timing.ToExecutionStatusUpdate()
			updateData.ExitCode = &exitCode

			// Include output if available
			outputMu.Lock()
			outputStr := stdoutBuf.String()
			errorStr := stderrBuf.String()
			outputMu.Unlock()

			if outputStr != "" {
				updateData.Output = &outputStr
			}
			if errorStr != "" {
				updateData.Error = &errorStr
			}

			// Use a fresh context for the API call in case original timed out
			apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer apiCancel()
			if err := e.apiClient.UpdateExecution(apiCtx, executionID, status, updateData); err != nil {
				e.log.WithError(err).Warn("Failed to update execution completion status")
			}
		}

		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   status,
			ExitCode: &exitCode,
			Message:  fmt.Sprintf("Runner exited with code %d", exitCode),
		})
	}
}

// ensureRunnerDeployed checks if the exact trusted runner artifact is deployed
// and returns its content-addressed remote path and pinned checksum.
func (e *Executor) ensureRunnerDeployed(ctx context.Context, conn *ssh.Client, server *types.ServerDetails) (string, string, error) {
	checksum, err := e.trustedRunnerChecksum()
	if err != nil {
		return "", "", fmt.Errorf("local runner integrity verification failed: %w", err)
	}
	runnerPath := runnerRemotePath(server, checksum)

	// Configure retry for deployment
	retryCfg := retry.Config{
		MaxAttempts:  3,
		InitialDelay: 2 * time.Second,
		MaxDelay:     8 * time.Second,
		Multiplier:   2.0,
	}

	logEntry := e.log.WithFields(logrus.Fields{
		"serverID": server.ID,
		"server":   server.Name,
	})

	// Use retry utility for deployment attempts
	err = retry.WithRetry(ctx, retryCfg, func() error {
		deployErr := e.deployRunnerWithRetry(ctx, conn, server, runnerPath, checksum)
		if deployErr != nil {
			// Create typed SSH error for deployment failures
			sshErr := errors.NewSSHError(
				"DEPLOYMENT_FAILED",
				fmt.Sprintf("Failed to deploy runner: %v", deployErr),
				"DeployRunner",
			)
			sshErr.ServerID = server.ID
			sshErr.Host = server.Host
			sshErr.Retryable = true // Deployment failures are retryable
			return sshErr
		}
		return nil
	}, logEntry)

	if err != nil {
		return "", "", fmt.Errorf("failed to deploy runner after retries: %w", err)
	}

	return runnerPath, checksum, nil
}

// deployRunnerWithRetry performs a single deployment attempt
func (e *Executor) deployRunnerWithRetry(ctx context.Context, conn *ssh.Client, server *types.ServerDetails, runnerPath, checksum string) error {
	deployStart := time.Now()
	if err := ctx.Err(); err != nil {
		return err
	}

	cacheKey := runnerCacheKey(server)
	unlock := e.runnerCache.Lock(cacheKey)
	defer unlock()

	verify := func() error {
		return verifyRemoteRunner(conn, runnerPath, checksum)
	}
	if e.verifyCachedRunner(cacheKey, runnerPath, checksum, verify) {
		e.log.WithFields(logrus.Fields{
			"serverID": server.ID,
			"version":  e.runnerInfo.Version,
		}).Debug("Using checksum-verified cached runner deployment")
		e.metrics.RecordDeployment(server.ID, true, true, time.Since(deployStart))
		return nil
	}

	// A process restart loses the in-memory cache. Reuse the content-addressed
	// remote file only after hashing it; never execute it to discover a version.
	if err := verify(); err == nil {
		now := time.Now()
		e.runnerCache.Set(cacheKey, &RunnerCacheEntry{
			ServerID:     server.ID,
			RunnerPath:   runnerPath,
			Version:      e.runnerInfo.Version,
			Checksum:     checksum,
			DeployedAt:   now,
			LastVerified: now,
		})
		e.log.WithField("serverID", server.ID).Debug("Reused checksum-verified remote runner")
		e.metrics.RecordDeployment(server.ID, true, true, time.Since(deployStart))
		return nil
	}

	// Need to deploy runner
	e.log.WithFields(logrus.Fields{
		"serverID": server.ID,
		"version":  e.runnerInfo.Version,
	}).Info("Deploying runner to server")

	if err := e.installRunnerAtomically(conn, e.runnerInfo.Path, runnerPath, checksum); err != nil {
		e.runnerCache.Remove(cacheKey)
		return err
	}

	// Add to cache
	e.runnerCache.Set(cacheKey, &RunnerCacheEntry{
		ServerID:     server.ID,
		RunnerPath:   runnerPath,
		Version:      e.runnerInfo.Version,
		Checksum:     checksum,
		DeployedAt:   time.Now(),
		LastVerified: time.Now(),
	})

	e.log.WithField("serverID", server.ID).Info("Runner deployed successfully")
	e.metrics.RecordDeployment(server.ID, true, false, time.Since(deployStart))
	return nil
}

func (e *Executor) installRunnerAtomically(conn *ssh.Client, localPath, runnerPath, checksum string) error {
	runnerDir := filepath.Dir(runnerPath)
	quotedDir := shellQuote(runnerDir)
	ensureDirCmd := fmt.Sprintf(
		"if [ -e %s ]; then test -d %s && test ! -L %s; else umask 077 && mkdir %s; fi && chmod 0700 %s",
		quotedDir,
		quotedDir,
		quotedDir,
		quotedDir,
		quotedDir,
	)
	if err := runRemoteCommand(conn, ensureDirCmd); err != nil {
		return fmt.Errorf("create private runner directory: %w", err)
	}

	uploadPath, err := randomRunnerUploadPath(runnerPath)
	if err != nil {
		return err
	}
	defer removeRemoteFile(conn, uploadPath)

	if err := copyRunnerFile(conn, localPath, uploadPath); err != nil {
		return fmt.Errorf("upload runner to random temporary path: %w", err)
	}
	if err := runRemoteCommand(conn, fmt.Sprintf("chmod 0500 %s", shellQuote(uploadPath))); err != nil {
		return fmt.Errorf("set restrictive runner upload permissions: %w", err)
	}
	if err := verifyRemoteRunner(conn, uploadPath, checksum); err != nil {
		return fmt.Errorf("verify uploaded runner before install: %w", err)
	}

	// Rename within the same directory is atomic, so no job can observe a
	// partially written final runner.
	installCmd := fmt.Sprintf(
		"mv -f %s %s && chmod 0500 %s",
		shellQuote(uploadPath),
		shellQuote(runnerPath),
		shellQuote(runnerPath),
	)
	if err := runRemoteCommand(conn, installCmd); err != nil {
		return fmt.Errorf("atomically install runner: %w", err)
	}
	if err := verifyRemoteRunner(conn, runnerPath, checksum); err != nil {
		removeRemoteFile(conn, runnerPath)
		return fmt.Errorf("verify installed runner: %w", err)
	}
	return nil
}

func runRemoteCommand(conn *ssh.Client, command string) error {
	session, err := conn.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	return session.Run(command)
}

func removeRemoteFile(conn *ssh.Client, path string) {
	if err := runRemoteCommand(conn, fmt.Sprintf("rm -f %s", shellQuote(path))); err != nil {
		// Cleanup is best-effort; deployment verification still fails closed.
		return
	}
}

func copyRunnerFile(conn *ssh.Client, localPath, remotePath string) error {
	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local runner: %w", err)
	}
	defer localFile.Close()

	copySession, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("create runner upload session: %w", err)
	}
	defer copySession.Close()

	stdin, err := copySession.StdinPipe()
	if err != nil {
		return fmt.Errorf("create runner upload pipe: %w", err)
	}
	command := fmt.Sprintf("umask 077 && set -C && cat > %s", shellQuote(remotePath))
	if err := copySession.Start(command); err != nil {
		return fmt.Errorf("start runner upload: %w", err)
	}
	if _, err := io.Copy(stdin, localFile); err != nil {
		stdin.Close()
		return fmt.Errorf("stream runner upload: %w", err)
	}
	if err := stdin.Close(); err != nil {
		return fmt.Errorf("close runner upload: %w", err)
	}
	if err := copySession.Wait(); err != nil {
		return fmt.Errorf("finish runner upload: %w", err)
	}
	return nil
}

// streamOutputWithContextAndCollect reads from a reader, sends log updates, and collects output
func (e *Executor) streamOutputWithContextAndCollect(ctx context.Context, reader io.Reader, stream string, updates chan<- types.ExecutionUpdate, sequence *int64, sequenceMu *sync.Mutex, buffer *strings.Builder, bufferMu *sync.Mutex) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return
		default:
		}

		line := scanner.Text()

		// Collect output
		bufferMu.Lock()
		buffer.WriteString(line)
		buffer.WriteString("\n")
		bufferMu.Unlock()

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

	if err := scanner.Err(); err != nil && !stderrors.Is(err, context.Canceled) {
		e.log.WithError(err).Errorf("Error reading %s stream", stream)
	}
}

// streamOutputWithContext reads from a reader and sends log updates until context is cancelled
func (e *Executor) streamOutputWithContext(ctx context.Context, reader io.Reader, stream string, updates chan<- types.ExecutionUpdate, sequence *int64, sequenceMu *sync.Mutex) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return
		default:
		}

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

	if err := scanner.Err(); err != nil && !stderrors.Is(err, context.Canceled) {
		e.log.WithError(err).Errorf("Error reading %s stream", stream)
	}
}

// streamOutput reads from a reader and sends log updates
func (e *Executor) streamOutput(reader io.Reader, stream string, updates chan<- types.ExecutionUpdate, sequence *int64, sequenceMu *sync.Mutex) {
	e.streamOutputWithContext(context.Background(), reader, stream, updates, sequence, sequenceMu)
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

		// Clean up only the exact random directory allocated for this session.
		if sess.conn != nil {
			if payloadDirectory := sess.getRemotePayloadDirectory(); payloadDirectory != "" {
				if err := cleanupRemotePayloadDirectory(sess.conn, payloadDirectory); err != nil {
					e.log.WithError(err).WithField("jobID", job.ID).Warn("Failed to clean up private remote payload directory")
				} else {
					sess.clearRemotePayloadDirectory(payloadDirectory)
				}
			}

			// Return the exact authenticated connection identity acquired for this
			// session. Recomputing from mutable job details could release it under
			// a different tenant or credential key.
			e.pool.Put(sess.connectionID, sess.conn, false)
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

func (s *Session) setRemotePayloadDirectory(directory string) {
	s.remotePayloadMu.Lock()
	s.remotePayloadDirectory = directory
	s.remotePayloadMu.Unlock()
}

func (s *Session) getRemotePayloadDirectory() string {
	s.remotePayloadMu.Lock()
	defer s.remotePayloadMu.Unlock()
	return s.remotePayloadDirectory
}

func (s *Session) clearRemotePayloadDirectory(directory string) {
	s.remotePayloadMu.Lock()
	if s.remotePayloadDirectory == directory {
		s.remotePayloadDirectory = ""
	}
	s.remotePayloadMu.Unlock()
}

// sendUpdate sends an execution update
func (e *Executor) sendUpdate(updates chan<- types.ExecutionUpdate, updateType types.UpdateType, data interface{}) {
	// Check if channel is nil or use non-blocking send to avoid panic
	if updates == nil {
		return
	}

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

// intPtr returns a pointer to an int value
func intPtr(i int) *int {
	return &i
}
