package container

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"github.com/sirupsen/logrus"
)

// logDrainLimit bounds how long a job's logs are read after stopping its script.
const logDrainLimit = 10 * time.Second

// executeWithPhaseTimeouts executes the job with separate timeouts for each phase.
// It returns what the job has on the Docker host, and whether that holds a result
// still to be reported (see finishRun, which removes it).
func (e *Executor) executeWithPhaseTimeouts(ctx context.Context, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming) (res jobResources, keepForReport bool) {
	// PHASE 1: Setup (network, sidecar, container creation)
	setupCtx, setupCancel := context.WithTimeout(ctx, e.timeoutConfig.SetupTimeout)
	defer setupCancel()

	// Send initial status
	e.sendUpdate(updates, types.UpdateTypeStatus, &types.StatusUpdate{
		Status:  types.JobStatusRunning,
		Message: "Preparing execution environment",
	})

	// SETUP PHASE: Clear what an earlier attempt at this job may have left. If this
	// fails and it matters, creating the network or container below says why.
	if err := e.removeStaleResources(setupCtx, job.ID); err != nil {
		e.log.WithError(err).WithField("jobID", job.ID).Warn("Could not remove what an earlier attempt at this job left")
	}

	// SETUP PHASE: Create isolated network
	timing.NetworkCreateStart = time.Now()
	var err error
	res.networkID, err = e.sidecar.CreateJobNetwork(setupCtx, job.ID)
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
		return res, false
	}

	// Track network
	e.mu.Lock()
	e.networks[job.ID] = res.networkID
	e.mu.Unlock()

	// SETUP PHASE: Create runtime sidecar
	timing.SidecarCreateStart = time.Now()
	res.sidecarID, err = e.sidecar.CreateRuntimeSidecar(setupCtx, job, res.networkID)
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
		return res, false
	}

	// Track sidecar
	e.mu.Lock()
	e.sidecars[job.ID] = res.sidecarID
	e.mu.Unlock()

	// SETUP PHASE: Create container
	timing.ContainerCreateStart = time.Now()
	res.containerID, err = e.createContainer(setupCtx, job, res.networkID, timing)
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
		return res, false
	}

	// Track container
	e.mu.Lock()
	e.containers[job.ID] = res.containerID
	e.mu.Unlock()

	// Mark setup as complete
	timing.MarkSetupComplete()

	// PHASE 2: Execution (run the user's script with user-configured timeout)
	// Cap the user timeout at the maximum allowed
	execTimeout := e.executionTimeout(job)
	if execTimeout != job.GetTimeout() {
		e.log.WithField("requestedTimeout", job.GetTimeout()).
			WithField("maxTimeout", e.timeoutConfig.MaxExecutionTimeout).
			Info("Capping execution timeout to maximum allowed")
	}

	execCtx, execCancel := context.WithTimeout(ctx, execTimeout)
	defer execCancel()

	// Execute the container with the execution timeout
	keepForReport = e.runContainer(execCtx, res.containerID, job, updates, executionID, timing)
	return res, keepForReport
}

// runContainer handles the execution phase of the container. It reports whether
// the container holds a result still to be reported.
func (e *Executor) runContainer(ctx context.Context, containerID string, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming) bool {
	// Start the container
	if _, err := e.dockerClient.ContainerStart(ctx, containerID, client.ContainerStartOptions{}); err != nil {
		e.sendError(updates, fmt.Errorf("failed to start container: %w", err), true)
		e.updateExecutionError(ctx, executionID, err)
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: "Failed to start container",
		})
		return false
	}

	// From here the script runs whether or not this process does. A job with other
	// halves can't outlive this process, because those halves can't.
	if !job.LocalBranch {
		e.setHandOver(job.ID, true)
	}

	return e.superviseContainer(ctx, containerID, job, updates, executionID, timing)
}

// superviseContainer follows a started container to its end and reports how it
// went. It works from Docker's record, so it serves a container this process just
// started and one found after a restart alike, even one that has already exited:
// logs read from the start, and the wait returns at once. It reports whether the
// container holds a result still to be reported, which is false only when the job
// was cancelled and the container should go straight away.
func (e *Executor) superviseContainer(ctx context.Context, containerID string, job *types.Job, updates chan types.ExecutionUpdate, executionID string, timing *ExecutionTiming) bool {
	// Logs are followed on their own context, so a script past its timeout still has
	// its output collected: what it prints on the way down, and all of it if it ran
	// past the timeout before this process found it. Following ends with the container.
	logCtx, logCancel := context.WithCancel(context.WithoutCancel(ctx))
	defer logCancel()

	// Create a WaitGroup for log streaming
	var logWg sync.WaitGroup
	logWg.Add(1)
	go func() {
		defer logWg.Done()
		e.streamLogs(logCtx, containerID, updates)
	}()

	// Wait for container to finish with execution timeout
	waitResult := e.dockerClient.ContainerWait(ctx, containerID, client.ContainerWaitOptions{
		Condition: container.WaitConditionNotRunning,
	})
	statusCh, errCh := waitResult.Result, waitResult.Error
	var exitCode int
	var timedOut bool
	var lostTrack bool
	var endedItself bool
	keepForReport := true

	// contextEnded handles the execution context ending while the script runs.
	contextEnded := func() {
		timedOut = true
		if ctx.Err() == context.DeadlineExceeded {
			e.sendError(updates, fmt.Errorf("script execution timeout exceeded"), true)
			e.log.WithFields(logrus.Fields{
				"jobID":   job.ID,
				"timeout": job.GetTimeout().String(),
			}).Info("Script execution timed out")

			// Try to stop the container gracefully
			stopTimeout := 10
			e.dockerClient.ContainerStop(context.Background(), containerID, client.ContainerStopOptions{
				Timeout: &stopTimeout,
			})

			// Get container info for exit code
			if inspect, err := e.dockerClient.ContainerInspect(context.Background(), containerID, client.ContainerInspectOptions{}); err == nil {
				exitCode = inspect.Container.State.ExitCode
				if inspect.Container.State.OOMKilled {
					e.sendError(updates, fmt.Errorf("container killed due to out of memory"), true)
				}
			} else {
				exitCode = -1 // Indicate timeout
			}
		} else {
			e.sendError(updates, fmt.Errorf("script execution cancelled"), true)
			exitCode = -2 // Indicate cancellation
			keepForReport = false
			// Nothing is left to hand over: the container goes as soon as this returns.
			e.setHandOver(job.ID, false)
			// It's still running, so following its logs would never end.
			logCancel()
		}
	}

	select {
	case <-ctx.Done():
		contextEnded()

	case err := <-errCh:
		switch {
		case ctx.Err() != nil:
			// The wait broke because the context ended. Both channels fire then.
			contextEnded()
		case err != nil:
			e.sendError(updates, fmt.Errorf("container wait error: %w", err), true)
			e.updateExecutionError(ctx, executionID, err)
			exitCode, lostTrack = e.exitCodeAfterLostWait(containerID)
		}

	case status := <-statusCh:
		exitCode = int(status.StatusCode)
		endedItself = true
	}

	// Wait for logs to finish. A script that ended by itself gets all of its output
	// read, however long that takes within the job's time. One that was stopped may
	// not have stopped, and then following would never end.
	if endedItself {
		stopFollowing := context.AfterFunc(ctx, logCancel)
		defer stopFollowing()
	} else {
		stopFollowing := time.AfterFunc(logDrainLimit, logCancel)
		defer stopFollowing.Stop()
	}
	logWg.Wait()

	// Mark execution as complete. For a container found already stopped, that was
	// when it stopped, not when this process noticed.
	timing.MarkExecutionComplete()
	if job.StartedAt != nil {
		if finished, ok := e.containerFinishedAt(containerID); ok && finished.After(*job.StartedAt) {
			timing.ExecutionEnd = finished
		}
	}

	// Collect final logs
	var outputStr string
	var errorStr string
	logsCtx, logsCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer logsCancel()

	logsReader, err := e.dockerClient.ContainerLogs(logsCtx, containerID, client.ContainerLogsOptions{
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

	if lostTrack {
		finalStatus = types.JobStatusFailed
		statusMessage = "Lost track of the container while it was running"
	} else if timedOut {
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
		if job.StartedAt != nil {
			addResumedTiming(updateData, timing)
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

		apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer apiCancel()
		if err := e.apiClient.UpdateExecution(apiCtx, executionID, finalStatus, updateData); err != nil {
			e.log.WithError(err).Warn("Failed to update execution completion status")
		}
	}

	return keepForReport
}

// containerFinishedAt asks Docker when a container stopped.
func (e *Executor) containerFinishedAt(containerID string) (time.Time, bool) {
	inspectCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	inspect, err := e.dockerClient.ContainerInspect(inspectCtx, containerID, client.ContainerInspectOptions{})
	if err != nil || inspect.Container.State == nil {
		return time.Time{}, false
	}
	finished, err := time.Parse(time.RFC3339Nano, inspect.Container.State.FinishedAt)
	if err != nil || finished.IsZero() {
		return time.Time{}, false
	}
	return finished, true
}

// exitCodeAfterLostWait works out how a script ended when waiting on its container
// failed, as when the Docker daemon restarts. A broken wait says nothing about the
// script, so it can't count as exit code 0. If Docker can't say the script stopped,
// the job has failed as far as anyone can tell, and lostTrack is true.
func (e *Executor) exitCodeAfterLostWait(containerID string) (exitCode int, lostTrack bool) {
	inspectCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	inspect, err := e.dockerClient.ContainerInspect(inspectCtx, containerID, client.ContainerInspectOptions{})
	if err != nil || inspect.Container.State == nil || inspect.Container.State.Running {
		return -99, true
	}
	return inspect.Container.State.ExitCode, false
}
