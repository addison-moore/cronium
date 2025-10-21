package ssh

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/auth"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

// executeWithPhaseTimeouts executes the SSH job with separate timeouts for each phase
func (e *Executor) executeWithPhaseTimeouts(ctx context.Context, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming) {
	// PHASE 1: Setup (SSH connection, runner deployment, payload creation)
	setupCtx, setupCancel := context.WithTimeout(ctx, e.timeoutConfig.SetupTimeout)
	defer setupCancel()

	// Get server details
	server := job.Execution.Target.ServerDetails
	if server == nil {
		e.sendError(updates, fmt.Errorf("no server details provided"), true)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "No server configuration",
		})
		return
	}

	// Log phase timeouts
	e.log.WithFields(logrus.Fields{
		"jobID":            job.ID,
		"server":           server.Name,
		"setupTimeout":     e.timeoutConfig.SetupTimeout.String(),
		"executionTimeout": job.GetTimeout().String(),
	}).Info("Starting SSH execution with phase-based timeouts")

	// SETUP PHASE: Get SSH connection
	timing.ConnectionStart = time.Now()
	serverKey := fmt.Sprintf("%s:%d", server.Host, server.Port)
	conn, err := e.pool.Get(setupCtx, serverKey, server)
	timing.ConnectionEnd = time.Now()

	if err != nil {
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while connecting to server"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to connect to server: %w", err), true)
		}
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: SSH connection",
		})
		return
	}
	defer e.pool.Put(serverKey, conn, true)

	// Create SSH session for main execution
	session, err := conn.NewSession()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create SSH session: %w", err), true)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: SSH session",
		})
		return
	}
	defer session.Close()

	// SETUP PHASE: Create payload
	timing.PayloadCreateStart = time.Now()
	payloadPath, err := e.createPayloadForJob(job, executionID)
	timing.PayloadCreateEnd = time.Now()

	if err != nil {
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while creating payload"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to create payload: %w", err), true)
		}
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: payload creation",
		})
		return
	}
	defer e.cleanupPayload(payloadPath, job)

	// SETUP PHASE: Deploy runner
	timing.RunnerDeployStart = time.Now()
	runnerPath := fmt.Sprintf("/tmp/cronium-runner-%s", e.runnerInfo.Version)
	deploySession, err := conn.NewSession()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create deployment session: %w", err), true)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: deployment session",
		})
		return
	}
	defer deploySession.Close()

	if err := e.ensureRunnerDeployed(setupCtx, deploySession, conn, server, runnerPath); err != nil {
		timing.RunnerDeployEnd = time.Now()
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while deploying runner"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to deploy runner: %w", err), true)
		}
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: runner deployment",
		})
		return
	}
	timing.RunnerDeployEnd = time.Now()

	// SETUP PHASE: Transfer payload
	timing.PayloadTransferStart = time.Now()
	remotePayloadPath := fmt.Sprintf("/tmp/cronium-payload-%s.tar.gz", job.ID)
	copySession, err := conn.NewSession()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create copy session: %w", err), true)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: copy session",
		})
		return
	}
	defer copySession.Close()

	if err := e.copyPayloadToServer(copySession, conn, payloadPath, remotePayloadPath); err != nil {
		timing.PayloadTransferEnd = time.Now()
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while transferring payload"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to transfer payload: %w", err), true)
		}
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed: payload transfer",
		})
		return
	}
	timing.PayloadTransferEnd = time.Now()

	// Cleanup payload after execution
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), e.timeoutConfig.CleanupTimeout)
		defer cleanupCancel()
		
		cleanupSession, _ := conn.NewSession()
		if cleanupSession != nil {
			cleanupSession.Run(fmt.Sprintf("rm -f %s", remotePayloadPath))
			cleanupSession.Close()
		}
		
		timing.MarkCleanupComplete()
		
		// Update final timing
		if e.apiClient != nil {
			finalUpdate := timing.ToExecutionStatusUpdate()
			if err := e.apiClient.UpdateExecution(cleanupCtx, executionID, types.JobStatusCompleted, finalUpdate); err != nil {
				e.log.WithError(err).Warn("Failed to update final execution timing")
			}
		}
	}()

	// Mark setup as complete
	timing.MarkSetupComplete()

	// PHASE 2: Execution (run the user's script with user-configured timeout)
	// Cap the user timeout at the maximum allowed
	execTimeout := job.GetTimeout()
	if execTimeout > e.timeoutConfig.MaxExecutionTimeout {
		e.log.WithField("requestedTimeout", execTimeout).
			WithField("maxTimeout", e.timeoutConfig.MaxExecutionTimeout).
			Info("Capping execution timeout to maximum allowed")
		execTimeout = e.timeoutConfig.MaxExecutionTimeout
	}

	execCtx, execCancel := context.WithTimeout(ctx, execTimeout)
	defer execCancel()

	// Execute the script
	e.log.WithFields(logrus.Fields{
		"jobID":      job.ID,
		"server":     server.Name,
		"timeout":    execTimeout.String(),
		"runner":     runnerPath,
		"payload":    remotePayloadPath,
	}).Info("Starting script execution phase")

	exitCode := e.runScriptWithTimeout(execCtx, session, conn, runnerPath, remotePayloadPath, job, updates, executionID, timing, execTimeout)

	// Mark execution as complete
	timing.MarkExecutionComplete()

	// Determine final status
	var finalStatus types.JobStatus
	var statusMessage string

	if execCtx.Err() == context.DeadlineExceeded {
		finalStatus = types.JobStatusFailed
		statusMessage = "Script execution timed out"
		exitCode = -1
	} else if exitCode == 0 {
		finalStatus = types.JobStatusCompleted
		statusMessage = "Script executed successfully"
	} else {
		finalStatus = types.JobStatusFailed
		statusMessage = fmt.Sprintf("Script exited with code %d", exitCode)
	}

	// Send completion update
	e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
		Status:   finalStatus,
		Message:  statusMessage,
		ExitCode: &exitCode,
	})

	// Update execution with final status
	if e.apiClient != nil {
		updateData := timing.ToExecutionStatusUpdate()
		updateData.ExitCode = &exitCode
		
		if err := e.apiClient.UpdateExecution(ctx, executionID, finalStatus, updateData); err != nil {
			e.log.WithError(err).Warn("Failed to update execution final status")
		}
	}
}

// runScriptWithTimeout executes the script with the given timeout
func (e *Executor) runScriptWithTimeout(ctx context.Context, session *ssh.Session, conn *ssh.Client, runnerPath, payloadPath string, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming, timeout time.Duration) int {
	// Set up pipes for stdout and stderr
	stdout, err := session.StdoutPipe()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create stdout pipe: %w", err), true)
		return -1
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to create stderr pipe: %w", err), true)
		return -1
	}

	// Build environment variables for the runner
	envVars := make([]string, 0)

	// Always include job ID and execution ID
	envVars = append(envVars,
		fmt.Sprintf("CRONIUM_JOB_ID=%s", job.ID),
		fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", executionID),
	)

	// Check if we should use API mode
	useAPIMode := e.runtimePort > 0 && e.jwtSecret != ""
	if useAPIMode {
		// Set up reverse tunnel for API mode
		remotePort := 9090
		tunnelManager := NewTunnelManager(e.runtimeHost, e.runtimePort, remotePort, e.log)
		
		if err := tunnelManager.Start(conn); err != nil {
			e.log.WithError(err).Warn("Failed to establish SSH tunnel, falling back to bundled mode")
			useAPIMode = false
		} else {
			defer tunnelManager.Stop()
			
			// Generate JWT token for this execution
			jwtManager := auth.NewJWTManager(e.jwtSecret)
			userID := ""
			eventID := ""
			
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
				apiEndpoint := tunnelManager.GetRemoteEndpoint()
				apiToken := token
				envVars = append(envVars,
					fmt.Sprintf("CRONIUM_HELPER_MODE=api"),
					fmt.Sprintf("CRONIUM_API_ENDPOINT=%s", apiEndpoint),
					fmt.Sprintf("CRONIUM_API_TOKEN=%s", apiToken),
				)
				e.log.WithFields(logrus.Fields{
					"endpoint":    apiEndpoint,
					"executionId": executionID,
				}).Info("API mode enabled for execution")
			}
		}
	}

	// Build the command with environment variables
	var cmd string
	if e.log.GetLevel() == logrus.DebugLevel {
		cmd = fmt.Sprintf("%s --log-level=debug run %s", runnerPath, payloadPath)
	} else {
		cmd = fmt.Sprintf("%s run %s", runnerPath, payloadPath)
	}

	// Add environment variables using export
	if len(envVars) > 0 {
		exports := make([]string, len(envVars))
		for i, env := range envVars {
			exports[i] = fmt.Sprintf("export %s", env)
		}
		cmd = fmt.Sprintf("%s && %s", strings.Join(exports, " && "), cmd)
	}

	// Start the command
	if err := session.Start(cmd); err != nil {
		e.sendError(updates, fmt.Errorf("failed to start runner: %w", err), true)
		return -1
	}

	// Stream output
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
		done <- session.Wait()
	}()

	select {
	case <-ctx.Done():
		// Context cancelled or timed out
		cancelStream()
		session.Signal(ssh.SIGTERM)
		time.Sleep(5 * time.Second)
		session.Signal(ssh.SIGKILL)

		if ctx.Err() == context.DeadlineExceeded {
			e.log.WithField("jobID", job.ID).Warn("Script execution timed out")
			e.sendError(updates, fmt.Errorf("script execution timed out after %v", timeout), true)
			return -1
		} else {
			e.sendError(updates, fmt.Errorf("script execution cancelled"), true)
			return -2
		}

	case err := <-done:
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*ssh.ExitError); ok {
				exitCode = exitErr.ExitStatus()
			} else {
				e.sendError(updates, fmt.Errorf("runner failed: %w", err), true)
				return -1
			}
		}
		
		// Update execution with output
		if e.apiClient != nil {
			outputMu.Lock()
			outputStr := stdoutBuf.String()
			errorStr := stderrBuf.String()
			outputMu.Unlock()
			
			updateData := &api.ExecutionStatusUpdate{}
			if outputStr != "" {
				updateData.Output = &outputStr
			}
			if errorStr != "" {
				updateData.Error = &errorStr
			}
			
			apiCtx, apiCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer apiCancel()
			if err := e.apiClient.UpdateExecution(apiCtx, executionID, types.JobStatusRunning, updateData); err != nil {
				e.log.WithError(err).Warn("Failed to update execution output")
			}
		}
		
		return exitCode
	}
}