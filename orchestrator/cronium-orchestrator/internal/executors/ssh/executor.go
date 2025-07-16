package ssh

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/addison-more/cronium/orchestrator/internal/config"
	"github.com/addison-more/cronium/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

// Executor implements SSH-based job execution
type Executor struct {
	config config.SSHConfig
	log    *logrus.Logger
	
	// Connection pool
	pool *ConnectionPool
	
	// Track active sessions
	mu       sync.RWMutex
	sessions map[string]*Session
}

// Session represents an active SSH session
type Session struct {
	jobID      string
	conn       *ssh.Client
	session    *ssh.Session
	cancelFunc context.CancelFunc
}

// NewExecutor creates a new SSH executor
func NewExecutor(cfg config.SSHConfig, log *logrus.Logger) (*Executor, error) {
	// Create connection pool
	pool := NewConnectionPool(cfg.ConnectionPool, log)
	
	return &Executor{
		config:   cfg,
		log:      log,
		pool:     pool,
		sessions: make(map[string]*Session),
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
	
	if job.Execution.Script == nil {
		return fmt.Errorf("script required for SSH execution")
	}
	
	return nil
}

// Execute runs the job via SSH
func (e *Executor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	updates := make(chan types.ExecutionUpdate, 100)
	
	go func() {
		defer close(updates)
		
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
		
		// Create context for cancellation
		execCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		
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
		
		// Set up environment
		if err := e.setupEnvironment(session, job); err != nil {
			e.sendError(updates, fmt.Errorf("failed to setup environment: %w", err), true)
			return
		}
		
		// Execute script
		e.executeScript(execCtx, session, job, updates)
	}()
	
	return updates, nil
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
		
		// Return connection to pool
		if sess.conn != nil && job.Execution.Target.ServerDetails != nil {
			serverKey := fmt.Sprintf("%s:%d", 
				job.Execution.Target.ServerDetails.Host, 
				job.Execution.Target.ServerDetails.Port)
			e.pool.Put(serverKey, sess.conn, false)
		}
		
		e.untrackSession(job.ID)
	}
	
	return nil
}

// setupEnvironment sets up the SSH session environment
func (e *Executor) setupEnvironment(session *ssh.Session, job *types.Job) error {
	// Set environment variables
	for key, value := range job.Execution.Environment {
		if err := session.Setenv(key, value); err != nil {
			// Some SSH servers don't allow setting env vars, log but don't fail
			e.log.WithError(err).WithField("var", key).Debug("Failed to set environment variable")
		}
	}
	
	// Set Cronium-specific variables
	session.Setenv("CRONIUM_JOB_ID", job.ID)
	session.Setenv("CRONIUM_JOB_TYPE", string(job.Type))
	session.Setenv("CRONIUM_EXECUTION_MODE", "ssh")
	
	// Note: Runtime helpers are not supported in SSH execution mode.
	// They will be available when using the signed runner binary approach.
	
	return nil
}

// executeScript executes the script and streams output
func (e *Executor) executeScript(ctx context.Context, session *ssh.Session, job *types.Job, updates chan<- types.ExecutionUpdate) {
	// Set up pipes for stdout and stderr
	stdout, err := session.StdoutPipe()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create stdout pipe: %w", err), true)
		return
	}
	
	stderr, err := session.StderrPipe()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create stderr pipe: %w", err), true)
		return
	}
	
	// Prepare script content
	script := e.prepareScript(job.Execution.Script)
	
	// Start the command
	var cmd string
	switch job.Execution.Script.Type {
	case types.ScriptTypeBash:
		cmd = e.config.Execution.DefaultShell + " -c " + shellQuote(script)
	case types.ScriptTypePython:
		cmd = "python3 -c " + shellQuote(script)
	case types.ScriptTypeNode:
		cmd = "node -e " + shellQuote(script)
	default:
		cmd = e.config.Execution.DefaultShell + " -c " + shellQuote(script)
	}
	
	if err := session.Start(cmd); err != nil {
		e.sendError(updates, fmt.Errorf("failed to start command: %w", err), true)
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
		done <- session.Wait()
	}()
	
	select {
	case <-ctx.Done():
		// Context cancelled, kill the process
		session.Signal(ssh.SIGTERM)
		time.Sleep(5 * time.Second)
		session.Signal(ssh.SIGKILL)
		e.sendError(updates, fmt.Errorf("execution cancelled"), true)
		
	case err := <-done:
		// Command completed
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*ssh.ExitError); ok {
				exitCode = exitErr.ExitStatus()
			} else {
				e.sendError(updates, fmt.Errorf("command failed: %w", err), true)
				return
			}
		}
		
		// Send completion update
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   types.JobStatusCompleted,
			ExitCode: &exitCode,
			Message:  fmt.Sprintf("Command exited with code %d", exitCode),
		})
	}
}

// prepareScript prepares the script content with any necessary modifications
func (e *Executor) prepareScript(script *types.Script) string {
	content := script.Content
	
	// Add working directory change if specified
	if script.WorkingDirectory != "" {
		switch script.Type {
		case types.ScriptTypeBash:
			content = fmt.Sprintf("cd %s && %s", shellQuote(script.WorkingDirectory), content)
		case types.ScriptTypePython:
			content = fmt.Sprintf("import os; os.chdir(%q); %s", script.WorkingDirectory, content)
		case types.ScriptTypeNode:
			content = fmt.Sprintf("process.chdir(%q); %s", script.WorkingDirectory, content)
		}
	}
	
	return content
}

// streamOutput reads from a reader and sends log updates
func (e *Executor) streamOutput(reader io.Reader, stream string, updates chan<- types.ExecutionUpdate, sequence *int64, sequenceMu *sync.Mutex) {
	buf := make([]byte, 4096)
	lineBuffer := bytes.NewBuffer(nil)
	
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			lineBuffer.Write(buf[:n])
			
			// Process complete lines
			for {
				line, err := lineBuffer.ReadString('\n')
				if err != nil {
					if err != io.EOF {
						break
					}
					// Save incomplete line for next iteration
					if line != "" {
						lineBuffer.WriteString(line)
					}
					break
				}
				
				// Send log entry
				line = strings.TrimSuffix(line, "\n")
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
		}
		
		if err == io.EOF {
			// Send any remaining data
			if lineBuffer.Len() > 0 {
				line := lineBuffer.String()
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
			break
		}
		
		if err != nil {
			e.log.WithError(err).Errorf("Error reading %s stream", stream)
			break
		}
	}
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

// shellQuote quotes a string for shell execution
func shellQuote(s string) string {
	return "'" + strings.Replace(s, "'", "'\"'\"'", -1) + "'"
}