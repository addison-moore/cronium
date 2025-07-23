package container

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/sirupsen/logrus"
)

// Executor implements container-based job execution
type Executor struct {
	config       config.ContainerConfig
	dockerClient *client.Client
	log          *logrus.Logger
	sidecar      *SidecarManager
	cleanup      *CleanupManager
	
	// Track active containers and resources
	mu         sync.RWMutex
	containers map[string]string // jobID -> containerID
	sidecars   map[string]string // jobID -> sidecarContainerID
	networks   map[string]string // jobID -> networkID
	tokens     map[string]string // jobID -> executionToken
}

// NewExecutor creates a new container executor
func NewExecutor(cfg config.ContainerConfig, log *logrus.Logger) (*Executor, error) {
	// Create Docker client
	dockerClient, err := client.NewClientWithOpts(
		client.WithHost(cfg.Docker.Endpoint),
		client.WithVersion(cfg.Docker.Version),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}
	
	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	if _, err := dockerClient.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to Docker daemon: %w", err)
	}
	
	executor := &Executor{
		config:       cfg,
		dockerClient: dockerClient,
		log:          log,
		containers:   make(map[string]string),
		sidecars:     make(map[string]string),
		networks:     make(map[string]string),
		tokens:       make(map[string]string),
	}
	
	// Create sidecar manager
	executor.sidecar = NewSidecarManager(executor, log)
	
	// Create cleanup manager
	executor.cleanup = NewCleanupManager(executor, log)
	
	return executor, nil
}

// Type returns the executor type
func (e *Executor) Type() types.JobType {
	return types.JobTypeContainer
}

// Validate checks if the job can be executed
func (e *Executor) Validate(job *types.Job) error {
	if job.Execution.Script == nil {
		return fmt.Errorf("container job missing script configuration")
	}
	
	// Validate script type
	switch job.Execution.Script.Type {
	case types.ScriptTypeBash, types.ScriptTypePython, types.ScriptTypeNode:
		// Valid types
	default:
		return fmt.Errorf("unsupported script type: %s", job.Execution.Script.Type)
	}
	
	return nil
}

// Execute runs the job in a container
func (e *Executor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	updates := make(chan types.ExecutionUpdate, 100)
	
	go func() {
		defer close(updates)
		
		// Ensure cleanup happens no matter what
		defer func() {
			if err := e.cleanup.CleanupJobResources(ctx, job.ID); err != nil {
				e.log.WithError(err).Error("Failed to cleanup job resources")
			}
		}()
		
		// Send initial status
		e.sendUpdate(updates, types.UpdateTypeStatus, &types.StatusUpdate{
			Status:  types.JobStatusRunning,
			Message: "Preparing execution environment",
		})
		
		// Create isolated network for this job
		networkID, err := e.sidecar.CreateJobNetwork(ctx, job.ID)
		if err != nil {
			e.sendError(updates, fmt.Errorf("failed to create job network: %w", err), true)
			e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
				Status:   types.JobStatusFailed,
				Message:  fmt.Sprintf("Failed to create network: %v", err),
			})
			return
		}
		
		// Track network
		e.mu.Lock()
		e.networks[job.ID] = networkID
		e.mu.Unlock()
		
		// Clean up network when done
		defer func() {
			e.mu.Lock()
			delete(e.networks, job.ID)
			e.mu.Unlock()
			
			if err := e.sidecar.RemoveJobNetwork(ctx, networkID); err != nil {
				e.log.WithError(err).WithField("networkID", networkID).Error("Failed to remove job network")
			}
		}()
		
		// Create and start runtime sidecar
		sidecarID, err := e.sidecar.CreateRuntimeSidecar(ctx, job, networkID)
		if err != nil {
			e.sendError(updates, fmt.Errorf("failed to create runtime sidecar: %w", err), true)
			e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
				Status:   types.JobStatusFailed,
				Message:  fmt.Sprintf("Failed to create sidecar: %v", err),
			})
			return
		}
		
		// Track sidecar
		e.mu.Lock()
		e.sidecars[job.ID] = sidecarID
		e.mu.Unlock()
		
		// Clean up sidecar when done
		defer func() {
			e.mu.Lock()
			delete(e.sidecars, job.ID)
			e.mu.Unlock()
			
			if err := e.sidecar.StopSidecar(ctx, sidecarID); err != nil {
				e.log.WithError(err).WithField("sidecarID", sidecarID).Error("Failed to stop sidecar")
			}
		}()
		
		// Create and run main container
		containerID, err := e.createContainer(ctx, job, networkID)
		if err != nil {
			e.sendError(updates, err, true)
			e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
				Status:   types.JobStatusFailed,
				Message:  fmt.Sprintf("Failed to create container: %v", err),
			})
			return
		}
		
		// Track container
		e.mu.Lock()
		e.containers[job.ID] = containerID
		e.mu.Unlock()
		
		// Clean up container when done
		defer func() {
			e.mu.Lock()
			delete(e.containers, job.ID)
			e.mu.Unlock()
			
			if err := e.removeContainer(ctx, containerID); err != nil {
				e.log.WithError(err).WithField("containerID", containerID).Error("Failed to remove container")
			}
		}()
		
		// Start container
		if err := e.dockerClient.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
			e.sendError(updates, fmt.Errorf("failed to start container: %w", err), true)
			e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
				Status:   types.JobStatusFailed,
				Message:  fmt.Sprintf("Failed to start container: %v", err),
			})
			return
		}
		
		// Create a WaitGroup to track log streaming completion
		var logWg sync.WaitGroup
		
		// Stream logs with synchronization
		logWg.Add(1)
		go func() {
			defer logWg.Done()
			e.streamLogs(ctx, containerID, updates)
		}()
		
		// Wait for container to finish
		statusCh, errCh := e.dockerClient.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)
		var exitCode int
		
		select {
		case err := <-errCh:
			if err != nil {
				e.sendError(updates, fmt.Errorf("container wait error: %w", err), true)
				// Wait for logs to finish streaming before returning
				logWg.Wait()
				return
			}
		case status := <-statusCh:
			exitCode = int(status.StatusCode)
		}
		
		// IMPORTANT: Wait for all logs to be read before sending completion
		logWg.Wait()
		
		// Now send completion update after all logs have been processed
		e.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
			Status:   types.JobStatusCompleted,
			ExitCode: &exitCode,
			Message:  fmt.Sprintf("Container exited with code %d", exitCode),
		})
	}()
	
	return updates, nil
}

// Cleanup performs cleanup after execution
func (e *Executor) Cleanup(ctx context.Context, job *types.Job) error {
	var errs []error
	
	// If job is nil, we can't clean up specific resources
	if job == nil {
		return nil
	}
	
	// Clean up main container
	e.mu.RLock()
	containerID, hasContainer := e.containers[job.ID]
	sidecarID, hasSidecar := e.sidecars[job.ID]
	networkID, hasNetwork := e.networks[job.ID]
	e.mu.RUnlock()
	
	if hasContainer {
		// Stop container if still running
		timeout := 10
		if err := e.dockerClient.ContainerStop(ctx, containerID, container.StopOptions{
			Timeout: &timeout,
		}); err != nil {
			e.log.WithError(err).Warn("Failed to stop container")
		}
		
		// Remove container
		if err := e.removeContainer(ctx, containerID); err != nil {
			errs = append(errs, fmt.Errorf("failed to remove container: %w", err))
		}
		
		e.mu.Lock()
		delete(e.containers, job.ID)
		e.mu.Unlock()
	}
	
	// Clean up sidecar
	if hasSidecar {
		if err := e.sidecar.StopSidecar(ctx, sidecarID); err != nil {
			errs = append(errs, fmt.Errorf("failed to stop sidecar: %w", err))
		}
		
		e.mu.Lock()
		delete(e.sidecars, job.ID)
		e.mu.Unlock()
	}
	
	// Clean up network
	if hasNetwork {
		if err := e.sidecar.RemoveJobNetwork(ctx, networkID); err != nil {
			errs = append(errs, fmt.Errorf("failed to remove network: %w", err))
		}
		
		e.mu.Lock()
		delete(e.networks, job.ID)
		e.mu.Unlock()
	}
	
	// Clean up token
	e.mu.Lock()
	delete(e.tokens, job.ID)
	e.mu.Unlock()
	
	// Return combined error if any
	if len(errs) > 0 {
		return fmt.Errorf("cleanup errors: %v", errs)
	}
	
	return nil
}

// createContainer creates a new container for the job
func (e *Executor) createContainer(ctx context.Context, job *types.Job, networkID string) (string, error) {
	// Select image based on script type
	image := e.getImageForScript(job.Execution.Script.Type)
	
	// Build container configuration
	containerConfig := &container.Config{
		Image:        image,
		Cmd:          e.buildCommand(job.Execution.Script),
		Env:          e.buildEnvironment(job),
		WorkingDir:   "/workspace",
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
		User:         e.config.Security.User,
	}
	
	// Build host configuration with resource limits
	hostConfig := &container.HostConfig{
		AutoRemove: false,
		NetworkMode: container.NetworkMode(networkID),
		Resources:  e.buildResourceLimits(job),
		Mounts:     e.buildMounts(job),
		SecurityOpt: e.buildSecurityOptions(),
	}
	
	// Network configuration
	networkConfig := &network.NetworkingConfig{
		EndpointsConfig: map[string]*network.EndpointSettings{
			networkID: {
				// No special aliases needed for main container
			},
		},
	}
	
	// Create container
	resp, err := e.dockerClient.ContainerCreate(
		ctx,
		containerConfig,
		hostConfig,
		networkConfig,
		nil,
		fmt.Sprintf("cronium-job-%s", job.ID),
	)
	if err != nil {
		return "", fmt.Errorf("failed to create container: %w", err)
	}
	
	return resp.ID, nil
}

// getImageForScript returns the appropriate image for the script type
func (e *Executor) getImageForScript(scriptType types.ScriptType) string {
	// Default images if not configured
	defaults := map[string]string{
		"bash":   "cronium/runner:bash-alpine",
		"python": "cronium/runner:python-alpine",
		"node":   "cronium/runner:node-alpine",
	}
	
	// Get configured image or use default
	imageKey := string(scriptType)
	if image, ok := e.config.Images[imageKey]; ok && image != "" {
		return image
	}
	
	// Fallback to defaults
	if defaultImage, ok := defaults[imageKey]; ok {
		return defaultImage
	}
	
	// Ultimate fallback
	return "cronium/runner:bash-alpine"
}

// buildCommand builds the container command
func (e *Executor) buildCommand(script *types.Script) []string {
	switch script.Type {
	case types.ScriptTypeBash:
		return []string{"/bin/bash", "-c", script.Content}
	case types.ScriptTypePython:
		return []string{"python", "-c", script.Content}
	case types.ScriptTypeNode:
		return []string{"node", "-e", script.Content}
	default:
		return []string{"/bin/bash", "-c", script.Content}
	}
}

// buildEnvironment builds the container environment variables
func (e *Executor) buildEnvironment(job *types.Job) []string {
	env := make([]string, 0)
	
	// Add execution environment variables
	for k, v := range job.Execution.Environment {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	
	// Get execution token
	token, err := e.sidecar.getExecutionToken(job.ID)
	if err != nil {
		e.log.WithError(err).Warn("Failed to get execution token")
		token = "" // Continue without token (will fail auth)
	}
	
	// Add Cronium-specific variables
	env = append(env,
		fmt.Sprintf("CRONIUM_JOB_ID=%s", job.ID),
		fmt.Sprintf("CRONIUM_JOB_TYPE=%s", job.Type),
		"CRONIUM_EXECUTION_MODE=container",
		fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", job.ID),
		fmt.Sprintf("CRONIUM_EXECUTION_TOKEN=%s", token),
		"CRONIUM_RUNTIME_API=http://runtime-api:8081",
	)
	
	return env
}

// buildResourceLimits builds container resource limits
func (e *Executor) buildResourceLimits(job *types.Job) container.Resources {
	resources := container.Resources{}
	
	// Use job-specific limits or defaults
	if job.Execution.Resources != nil {
		if job.Execution.Resources.CPULimit > 0 {
			resources.NanoCPUs = int64(job.Execution.Resources.CPULimit * 1e9)
		}
		if job.Execution.Resources.MemoryLimit > 0 {
			resources.Memory = job.Execution.Resources.MemoryLimit
		}
		if job.Execution.Resources.PidsLimit > 0 {
			resources.PidsLimit = &job.Execution.Resources.PidsLimit
		}
	} else {
		// Use defaults
		resources.NanoCPUs = int64(e.config.Resources.Defaults.CPU * 1e9)
		// Parse memory string (e.g., "512MB" -> bytes)
		if memBytes, err := parseMemory(e.config.Resources.Defaults.Memory); err == nil {
			resources.Memory = memBytes
		}
		pidsLimit := e.config.Resources.Defaults.Pids
		resources.PidsLimit = &pidsLimit
	}
	
	return resources
}

// buildMounts builds container mounts
func (e *Executor) buildMounts(job *types.Job) []mount.Mount {
	mounts := []mount.Mount{
		{
			Type:   mount.TypeTmpfs,
			Target: "/tmp",
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: 100 * 1024 * 1024, // 100MB
				Mode:      0o1777,
			},
		},
	}
	
	// Add workspace mount if needed
	if job.Execution.Script.WorkingDirectory != "" {
		// In production, this would mount from a secure location
		// For now, we'll just use tmpfs
		mounts = append(mounts, mount.Mount{
			Type:   mount.TypeTmpfs,
			Target: "/workspace",
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: 500 * 1024 * 1024, // 500MB
				Mode:      0o755,
			},
		})
	}
	
	return mounts
}

// buildSecurityOptions builds container security options
func (e *Executor) buildSecurityOptions() []string {
	opts := []string{}
	
	if e.config.Security.NoNewPrivileges {
		opts = append(opts, "no-new-privileges")
	}
	
	// Add seccomp profile
	if e.config.Security.SeccompProfile != "" && e.config.Security.SeccompProfile != "default" {
		// Only add custom seccomp profiles, let Docker use its default
		opts = append(opts, fmt.Sprintf("seccomp=%s", e.config.Security.SeccompProfile))
	}
	
	return opts
}

// streamLogs streams container logs to the updates channel
func (e *Executor) streamLogs(ctx context.Context, containerID string, updates chan<- types.ExecutionUpdate) {
	options := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Timestamps: true,
	}
	
	logs, err := e.dockerClient.ContainerLogs(ctx, containerID, options)
	if err != nil {
		e.sendError(updates, fmt.Errorf("failed to get container logs: %w", err), false)
		return
	}
	defer logs.Close()
	
	// Read logs and send updates
	stdoutReader, stdoutWriter := io.Pipe()
	stderrReader, stderrWriter := io.Pipe()
	
	// WaitGroup to track when all log processing is complete
	var wg sync.WaitGroup
	
	// Start the log splitter
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer stdoutWriter.Close()
		defer stderrWriter.Close()
		
		if _, err := stdcopy.StdCopy(stdoutWriter, stderrWriter, logs); err != nil {
			e.log.WithError(err).Error("Failed to read container logs")
		}
	}()
	
	// Read stdout
	wg.Add(1)
	go func() {
		defer wg.Done()
		e.readStream(stdoutReader, "stdout", updates)
	}()
	
	// Read stderr
	wg.Add(1)
	go func() {
		defer wg.Done()
		e.readStream(stderrReader, "stderr", updates)
	}()
	
	// Wait for all log processing to complete
	wg.Wait()
}

// readStream reads from a stream and sends log updates
func (e *Executor) readStream(reader io.Reader, stream string, updates chan<- types.ExecutionUpdate) {
	buffer := make([]byte, 4096)
	sequence := int64(0)
	
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			lines := strings.Split(string(buffer[:n]), "\n")
			for _, line := range lines {
				if line != "" {
					sequence++
					e.sendUpdate(updates, types.UpdateTypeLog, &types.LogEntry{
						Stream:    stream,
						Line:      line,
						Timestamp: time.Now(),
						Sequence:  sequence,
					})
				}
			}
		}
		
		if err == io.EOF {
			break
		}
		if err != nil {
			e.log.WithError(err).Errorf("Error reading %s stream", stream)
			break
		}
	}
}

// removeContainer removes a container
func (e *Executor) removeContainer(ctx context.Context, containerID string) error {
	return e.dockerClient.ContainerRemove(ctx, containerID, container.RemoveOptions{
		Force: true,
	})
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

// parseMemory parses memory strings like "512MB", "1GB" to bytes
func parseMemory(mem string) (int64, error) {
	if mem == "" {
		return 0, fmt.Errorf("empty memory string")
	}
	
	// Simple parser for common units
	mem = strings.ToUpper(strings.TrimSpace(mem))
	
	multipliers := map[string]int64{
		"B":  1,
		"KB": 1024,
		"MB": 1024 * 1024,
		"GB": 1024 * 1024 * 1024,
	}
	
	for suffix, multiplier := range multipliers {
		if strings.HasSuffix(mem, suffix) {
			valueStr := strings.TrimSuffix(mem, suffix)
			value, err := strconv.ParseFloat(valueStr, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid memory value: %s", mem)
			}
			return int64(value * float64(multiplier)), nil
		}
	}
	
	// Try parsing as raw number (assume bytes)
	value, err := strconv.ParseInt(mem, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid memory format: %s", mem)
	}
	
	return value, nil
}

// GetCleanupManager returns the cleanup manager for this executor
func (e *Executor) GetCleanupManager() *CleanupManager {
	return e.cleanup
}