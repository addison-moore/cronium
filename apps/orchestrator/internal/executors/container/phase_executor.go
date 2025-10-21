package container

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/sirupsen/logrus"
)

// executeWithPhaseTimeouts executes the job with separate timeouts for each phase
func (e *Executor) executeWithPhaseTimeouts(ctx context.Context, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming) {
	// PHASE 1: Setup (network, sidecar, container creation)
	setupCtx, setupCancel := context.WithTimeout(ctx, e.timeoutConfig.SetupTimeout)
	defer setupCancel()

	var networkID, sidecarID, containerID string

	// Defer cleanup
	defer func() {
		// Cleanup always runs with its own timeout
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), e.timeoutConfig.CleanupTimeout)
		defer cleanupCancel()

		timing.MarkCleanupComplete()

		// Clean up container
		if containerID != "" {
			e.mu.Lock()
			delete(e.containers, job.ID)
			e.mu.Unlock()
			if err := e.removeContainer(cleanupCtx, containerID); err != nil {
				e.log.WithError(err).WithField("containerID", containerID).Error("Failed to remove container")
			}
		}

		// Clean up sidecar
		if sidecarID != "" {
			e.mu.Lock()
			delete(e.sidecars, job.ID)
			e.mu.Unlock()
			if err := e.sidecar.StopSidecar(cleanupCtx, sidecarID); err != nil {
				e.log.WithError(err).WithField("sidecarID", sidecarID).Error("Failed to stop sidecar")
			}
		}

		// Clean up network
		if networkID != "" {
			e.mu.Lock()
			delete(e.networks, job.ID)
			e.mu.Unlock()
			if err := e.sidecar.RemoveJobNetwork(cleanupCtx, networkID); err != nil {
				e.log.WithError(err).WithField("networkID", networkID).Error("Failed to remove job network")
			}
		}

		// Update final timing
		if e.apiClient != nil {
			finalUpdate := timing.ToExecutionStatusUpdate()
			if err := e.apiClient.UpdateExecution(cleanupCtx, executionID, types.JobStatusCompleted, finalUpdate); err != nil {
				e.log.WithError(err).Warn("Failed to update final execution timing")
			}
		}
	}()

	// Send initial status
	e.sendUpdate(updates, types.UpdateTypeStatus, &types.StatusUpdate{
		Status:  types.JobStatusRunning,
		Message: "Preparing execution environment",
	})

	// SETUP PHASE: Create isolated network
	timing.NetworkCreateStart = time.Now()
	var err error
	networkID, err = e.sidecar.CreateJobNetwork(setupCtx, job.ID)
	timing.NetworkCreateEnd = time.Now()
	
	if err != nil {
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while creating network"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to create job network: %w", err), true)
		}
		e.updateExecutionError(ctx, executionID, err)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed",
		})
		return
	}

	// Track network
	e.mu.Lock()
	e.networks[job.ID] = networkID
	e.mu.Unlock()

	// SETUP PHASE: Create runtime sidecar
	timing.SidecarCreateStart = time.Now()
	sidecarID, err = e.sidecar.CreateRuntimeSidecar(setupCtx, job, networkID)
	timing.SidecarCreateEnd = time.Now()
	
	if err != nil {
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while creating sidecar"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to create runtime sidecar: %w", err), true)
		}
		e.updateExecutionError(ctx, executionID, err)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed",
		})
		return
	}

	// Track sidecar
	e.mu.Lock()
	e.sidecars[job.ID] = sidecarID
	e.mu.Unlock()

	// SETUP PHASE: Create container
	timing.ContainerCreateStart = time.Now()
	containerID, err = e.createContainer(setupCtx, job, networkID, timing)
	timing.ContainerCreateEnd = time.Now()
	
	if err != nil {
		if setupCtx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("setup timeout exceeded while creating container"), true)
		} else {
			e.sendError(updates, fmt.Errorf("failed to create container: %w", err), true)
		}
		e.updateExecutionError(ctx, executionID, err)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Setup phase failed",
		})
		return
	}

	// Track container
	e.mu.Lock()
	e.containers[job.ID] = containerID
	e.mu.Unlock()

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

	// Execute the container with the execution timeout
	e.runContainer(execCtx, containerID, job, updates, executionID, timing)
}

// runContainer handles the execution phase of the container
func (e *Executor) runContainer(ctx context.Context, containerID string, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming) {
	// Start the container
	if err := e.dockerClient.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		e.sendError(updates, fmt.Errorf("failed to start container: %w", err), true)
		e.updateExecutionError(ctx, executionID, err)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Failed to start container",
		})
		return
	}

	// Create a WaitGroup for log streaming
	var logWg sync.WaitGroup
	logWg.Add(1)
	go func() {
		defer logWg.Done()
		e.streamLogs(ctx, containerID, updates)
	}()

	// Wait for container to finish with execution timeout
	statusCh, errCh := e.dockerClient.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)
	var exitCode int
	var timedOut bool

	select {
	case <-ctx.Done():
		// Execution timeout exceeded
		timedOut = true
		if ctx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("script execution timeout exceeded"), true)
			e.log.WithFields(logrus.Fields{
				"jobID":     job.ID,
				"timeout":   job.GetTimeout().String(),
			}).Info("Script execution timed out")
			
			// Try to stop the container gracefully
			stopTimeout := 10
			e.dockerClient.ContainerStop(context.Background(), containerID, container.StopOptions{
				Timeout: &stopTimeout,
			})
			
			// Get container info for exit code
			if inspect, err := e.dockerClient.ContainerInspect(context.Background(), containerID); err == nil {
				exitCode = inspect.State.ExitCode
				if inspect.State.OOMKilled {
					e.sendError(updates, fmt.Errorf("container killed due to out of memory"), true)
				}
			} else {
				exitCode = -1 // Indicate timeout
			}
		} else {
			e.sendError(updates, fmt.Errorf("script execution cancelled"), true)
			exitCode = -2 // Indicate cancellation
		}
		// Wait for logs to finish
		logWg.Wait()
		
	case err := <-errCh:
		if err != nil {
			e.sendError(updates, fmt.Errorf("container wait error: %w", err), true)
			e.updateExecutionError(ctx, executionID, err)
		}
		logWg.Wait()
		
	case status := <-statusCh:
		exitCode = int(status.StatusCode)
		logWg.Wait()
	}

	// Mark execution as complete
	timing.MarkExecutionComplete()

	// Collect final logs
	var outputStr string
	var errorStr string
	logsCtx, logsCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer logsCancel()
	
	logsReader, err := e.dockerClient.ContainerLogs(logsCtx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: false,
	})
	if err == nil {
		defer logsReader.Close()
		stdout := &bytes.Buffer{}
		stderr := &bytes.Buffer{}
		if _, err := stdcopy.StdCopy(stdout, stderr, logsReader); err == nil {
			outputStr = stdout.String()
			errorStr = stderr.String()
		}
	}

	// Determine final status
	var finalStatus types.JobStatus
	var statusMessage string

	if timedOut {
		finalStatus = types.JobStatusFailed
		if exitCode == -1 {
			statusMessage = "Script execution timed out"
		} else {
			statusMessage = "Script execution cancelled"
		}
	} else if exitCode == 0 {
		finalStatus = types.JobStatusCompleted
		statusMessage = "Container execution completed successfully"
	} else {
		finalStatus = types.JobStatusFailed
		statusMessage = fmt.Sprintf("Container exited with code %d", exitCode)
	}

	// Send completion update
	e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
		Status:   finalStatus,
		Message:  statusMessage,
		ExitCode: &exitCode,
	})

	// Update execution with final status
	if e.apiClient != nil {
		updateData := &api.ExecutionStatusUpdate{
			ExitCode: &exitCode,
		}
		if outputStr != "" {
			updateData.Output = &outputStr
		}
		if errorStr != "" {
			updateData.Error = &errorStr
		} else if timedOut {
			errMsg := statusMessage
			updateData.Error = &errMsg
		}
		
		apiCtx, apiCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer apiCancel()
		if err := e.apiClient.UpdateExecution(apiCtx, executionID, finalStatus, updateData); err != nil {
			e.log.WithError(err).Warn("Failed to update execution completion status")
		}
	}
}