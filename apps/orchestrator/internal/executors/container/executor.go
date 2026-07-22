package container

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	units "github.com/docker/go-units"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
	"github.com/sirupsen/logrus"
)

// Executor implements container-based job execution
type Executor struct {
	config        config.ContainerConfig
	timeoutConfig config.TimeoutConfig
	dockerClient  *client.Client
	log           *logrus.Logger
	apiClient     *api.Client
	sidecar       *SidecarManager
	cleanup       *CleanupManager

	// Track active containers and resources
	mu           sync.RWMutex
	containers   map[string]string // jobID -> containerID
	sidecars     map[string]string // jobID -> sidecarContainerID
	networks     map[string]string // jobID -> networkID
	tokens       map[string]string // jobID -> execution JWT token
	executionIDs map[string]string // jobID -> executionID (must match the JWT claim + CRONIUM_EXECUTION_ID)
}

// validateDockerEndpoint fails closed on a plaintext remote Docker endpoint
// (3.6). The client wires no TLS, so a tcp://host:port endpoint would be an
// unauthenticated, unencrypted Docker API — full RCE on that host to anyone on
// the path. Only local transports (unix socket / Windows named pipe) are allowed
// unless an operator explicitly accepts the risk on a trusted network.
func validateDockerEndpoint(endpoint string) error {
	if strings.HasPrefix(endpoint, "unix://") || strings.HasPrefix(endpoint, "npipe://") {
		return nil
	}
	if os.Getenv("CRONIUM_ALLOW_INSECURE_DOCKER_ENDPOINT") == "true" {
		return nil
	}
	return fmt.Errorf(
		"refusing Docker endpoint %q: only a local unix:// or npipe:// socket is allowed. "+
			"A remote tcp:// endpoint has no mutual TLS wired and would expose an unauthenticated Docker API. "+
			"Use the local socket, or set CRONIUM_ALLOW_INSECURE_DOCKER_ENDPOINT=true only on a fully trusted network",
		endpoint,
	)
}

// NewExecutor creates a new container executor
func NewExecutor(cfg config.ContainerConfig, apiClient *api.Client, log *logrus.Logger) (*Executor, error) {
	if err := validateDockerEndpoint(cfg.Docker.Endpoint); err != nil {
		return nil, err
	}
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

	if _, err := dockerClient.Ping(ctx, client.PingOptions{}); err != nil {
		return nil, fmt.Errorf("failed to connect to Docker daemon: %w", err)
	}

	executor := &Executor{
		config:        cfg,
		timeoutConfig: config.LoadTimeoutConfig(),
		dockerClient:  dockerClient,
		log:           log,
		apiClient:     apiClient,
		containers:    make(map[string]string),
		sidecars:      make(map[string]string),
		networks:      make(map[string]string),
		tokens:        make(map[string]string),
		executionIDs:  make(map[string]string),
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
		return errors.NewValidationError(
			"script",
			"required",
			"container job missing script configuration",
		)
	}

	// Validate script type
	switch job.Execution.Script.Type {
	case types.ScriptTypeBash, types.ScriptTypePython, types.ScriptTypeNode:
		// Valid types
	default:
		return errors.NewValidationError(
			"scriptType",
			"enum",
			fmt.Sprintf("unsupported script type: %s", job.Execution.Script.Type),
		)
	}

	return nil
}

// Execute runs the job in a container with phase-based timeouts
func (e *Executor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	updates := make(chan types.ExecutionUpdate, 100)

	// Generate execution ID
	executionID := fmt.Sprintf("exec_%s_%d", job.ID, time.Now().Unix())

	// Store execution ID for later use. This is the id the runtime sidecar's JWT
	// claim and the CRONIUM_EXECUTION_ID env must both carry, or the runtime API
	// rejects cronium.output()/input() with 403 (execution ID mismatch).
	e.mu.Lock()
	if e.executionIDs == nil {
		e.executionIDs = make(map[string]string)
	}
	e.executionIDs[job.ID] = executionID
	e.mu.Unlock()

	go func() {
		defer close(updates)

		// Initialize phase timing
		timing := NewExecutionTiming()

		// Create execution record in the database
		if e.apiClient != nil {
			if err := e.apiClient.CreateExecution(ctx, executionID, job.ID, nil, nil); err != nil {
				e.log.WithError(err).Warn("Failed to create execution record")
			}

			// Mark execution as started
			if err := e.apiClient.UpdateExecution(ctx, executionID, types.JobStatusRunning, timing.ToExecutionStatusUpdate()); err != nil {
				e.log.WithError(err).Warn("Failed to update execution status to running")
			}
		}

		// Log phase timeouts being used
		e.log.WithFields(logrus.Fields{
			"jobID":            job.ID,
			"setupTimeout":     e.timeoutConfig.SetupTimeout.String(),
			"executionTimeout": job.GetTimeout().String(),
			"cleanupTimeout":   e.timeoutConfig.CleanupTimeout.String(),
		}).Info("Starting job execution with phase-based timeouts")

		// Execute with phase-based timeouts
		e.executeWithPhaseTimeouts(ctx, job, updates, executionID, timing)
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
		if _, err := e.dockerClient.ContainerStop(ctx, containerID, client.ContainerStopOptions{
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

	// Clean up token + execution ID
	e.mu.Lock()
	delete(e.tokens, job.ID)
	delete(e.executionIDs, job.ID)
	e.mu.Unlock()

	// Return combined error if any
	if len(errs) > 0 {
		return fmt.Errorf("cleanup errors: %v", errs)
	}

	return nil
}

// createContainer creates a new container for the job
func (e *Executor) createContainer(ctx context.Context, job *types.Job, networkID string, timing *ExecutionTiming) (string, error) {
	// Select image based on script type
	image := e.getImageForScript(job.Execution.Script.Type)

	// Try to pull the image first (in case it's not available locally)
	if timing != nil {
		timing.ContainerPullStart = time.Now()
	}
	if err := e.ensureImage(ctx, image); err != nil {
		dockerErr := errors.NewDockerError(
			"IMAGE_PULL_FAILED",
			fmt.Sprintf("failed to ensure image %s: %v", image, err),
			"PullImage",
		)
		dockerErr.ImageName = image
		return "", dockerErr
	}
	if timing != nil {
		timing.ContainerPullEnd = time.Now()
	}

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

	// Build host configuration with resource limits + sandbox hardening (3.1).
	hostConfig := e.buildHostConfig(job, networkID)

	// Network configuration
	networkConfig := &network.NetworkingConfig{
		EndpointsConfig: map[string]*network.EndpointSettings{
			networkID: {
				// No special aliases needed for main container
			},
		},
	}

	// Create container
	resp, err := e.dockerClient.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config:           containerConfig,
		HostConfig:       hostConfig,
		NetworkingConfig: networkConfig,
		Name:             fmt.Sprintf("cronium-job-%s", job.ID),
	})
	if err != nil {
		dockerErr := errors.NewDockerError(
			"CONTAINER_CREATE_FAILED",
			fmt.Sprintf("failed to create container: %v", err),
			"CreateContainer",
		)
		dockerErr.ImageName = image
		// Check for specific error conditions
		if strings.Contains(err.Error(), "out of memory") || strings.Contains(err.Error(), "OOMKilled") {
			dockerErr.Code = "RESOURCE_LIMIT_EXCEEDED"
			dockerErr.Retryable = false
		} else if strings.Contains(err.Error(), "no such image") {
			dockerErr.Code = "IMAGE_NOT_FOUND"
		}
		return "", dockerErr
	}

	return resp.ID, nil
}

// getImageForScript returns the appropriate image for the script type
func (e *Executor) getImageForScript(scriptType types.ScriptType) string {
	// Default images if not configured
	defaults := map[string]string{
		"BASH":   "cronium/runner:bash-alpine",
		"PYTHON": "cronium/runner:python-alpine",
		"NODEJS": "cronium/runner:node-alpine",
	}

	// Get configured image or use default
	imageKey := string(scriptType)
	if image, ok := e.config.Images[strings.ToLower(imageKey)]; ok && image != "" {
		return image
	}

	// Fallback to defaults
	if defaultImage, ok := defaults[imageKey]; ok {
		return defaultImage
	}

	// Ultimate fallback
	return "cronium/runner:bash-alpine"
}

// buildCommand builds the container command.
//
// Each runtime image ships the cronium helper SDK but does not auto-load it, so
// we prepend a loader that exposes `cronium` to the user's script without an
// explicit import — matching the runner path and the documented no-import usage
// (e.g. `cronium.output(...)`). Without this the script fails with
// NameError/ReferenceError: cronium is not defined.
func (e *Executor) buildCommand(script *types.Script) []string {
	switch script.Type {
	case types.ScriptTypeBash:
		// cronium.sh is also auto-sourced via BASH_ENV; source explicitly for safety.
		return []string{"/bin/bash", "-c", "source /usr/local/bin/cronium.sh 2>/dev/null || true\n" + script.Content}
	case types.ScriptTypePython:
		return []string{"python", "-c", "import cronium\n" + script.Content}
	case types.ScriptTypeNode:
		return []string{"node", "-e", "globalThis.cronium = require('cronium');\n" + script.Content}
	default:
		return []string{"/bin/bash", "-c", "source /usr/local/bin/cronium.sh 2>/dev/null || true\n" + script.Content}
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

	// Get actual execution ID (kept in its own map so it is never clobbered by
	// the JWT token, which the sidecar stores under e.tokens).
	e.mu.RLock()
	executionID := e.executionIDs[job.ID]
	e.mu.RUnlock()
	if executionID == "" {
		// Fallback if not found
		executionID = fmt.Sprintf("exec_%s_%d", job.ID, time.Now().Unix())
	}

	// Add Cronium-specific variables
	env = append(env,
		fmt.Sprintf("CRONIUM_JOB_ID=%s", job.ID),
		fmt.Sprintf("CRONIUM_JOB_TYPE=%s", job.Type),
		"CRONIUM_EXECUTION_MODE=container",
		fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", executionID),
		fmt.Sprintf("CRONIUM_EXECUTION_TOKEN=%s", token),
		"CRONIUM_RUNTIME_API=http://runtime-api:8081",
	)

	return env
}

// buildResourceLimits builds container resource limits
// buildResourceLimits computes the container resource caps (Phase 3.1). It
// starts from the configured defaults, lets a job LOWER-or-set each field
// independently (a partial resource object never leaves a field unbounded), and
// then CLAMPS every field to the configured maximum so an untrusted job cannot
// request more CPU/memory/PIDs than the operator allows. A NOFILE ulimit caps
// file descriptors; disk is bounded by the read-only rootfs plus sized tmpfs
// mounts.
func (e *Executor) buildResourceLimits(job *types.Job) container.Resources {
	d := e.config.Resources.Defaults
	max := e.config.Resources.Limits

	cpu := d.CPU
	memBytes, _ := parseMemory(d.Memory)
	pids := d.Pids

	if job.Execution.Resources != nil {
		if job.Execution.Resources.CPULimit > 0 {
			cpu = job.Execution.Resources.CPULimit
		}
		if job.Execution.Resources.MemoryLimit > 0 {
			memBytes = job.Execution.Resources.MemoryLimit
		}
		if job.Execution.Resources.PidsLimit > 0 {
			pids = job.Execution.Resources.PidsLimit
		}
	}

	// Clamp to the configured ceiling — never exceed operator-set maximums.
	if max.CPU > 0 && (cpu <= 0 || cpu > max.CPU) {
		cpu = max.CPU
	}
	if maxMem, err := parseMemory(max.Memory); err == nil && maxMem > 0 {
		if memBytes <= 0 || memBytes > maxMem {
			memBytes = maxMem
		}
	}
	if max.Pids > 0 && (pids <= 0 || pids > max.Pids) {
		pids = max.Pids
	}

	pidsLimit := pids
	return container.Resources{
		NanoCPUs:  int64(cpu * 1e9),
		Memory:    memBytes,
		PidsLimit: &pidsLimit,
		Ulimits: []*units.Ulimit{
			{Name: "nofile", Soft: 1024, Hard: 4096},
		},
	}
}

// buildMounts builds container mounts
func (e *Executor) buildMounts(_ *types.Job) []mount.Mount {
	// With a read-only root filesystem (3.1), every writable path a job needs
	// must be an explicit tmpfs mount. /workspace is the working directory,
	// /tmp is scratch, and /home gives nonroot tooling (pip/npm caches, etc.) a
	// writable HOME. Everything else stays read-only.
	return []mount.Mount{
		{
			Type:   mount.TypeTmpfs,
			Target: "/tmp",
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: 100 * 1024 * 1024, // 100MB
				Mode:      0o1777,
			},
		},
		{
			Type:   mount.TypeTmpfs,
			Target: "/workspace",
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: 500 * 1024 * 1024, // 500MB
				Mode:      0o755,
			},
		},
		{
			Type:   mount.TypeTmpfs,
			Target: "/home",
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: 100 * 1024 * 1024, // 100MB
				Mode:      0o1777,
			},
		},
	}
}

// buildHostConfig assembles the hardened Docker HostConfig for a job container
// (Phase 3.1). CapDrop [ALL] removes every Linux capability, a read-only root
// filesystem confines writes to the explicit tmpfs work mounts, and the job
// runs on its own per-job network — so an untrusted job cannot tamper with the
// image, escalate via a capability, or reach the host/control plane. Fails
// closed: if capability dropping is unconfigured it still drops ALL.
func (e *Executor) buildHostConfig(job *types.Job, networkID string) *container.HostConfig {
	dropCaps := e.config.Security.DropCapabilities
	if len(dropCaps) == 0 {
		dropCaps = []string{"ALL"}
	}
	return &container.HostConfig{
		AutoRemove:     false,
		NetworkMode:    container.NetworkMode(networkID),
		Resources:      e.buildResourceLimits(job),
		Mounts:         e.buildMounts(job),
		SecurityOpt:    e.buildSecurityOptions(),
		CapDrop:        dropCaps,
		ReadonlyRootfs: e.config.Security.ReadOnlyRootfs,
	}
}

// buildSecurityOptions builds container security options
func (e *Executor) buildSecurityOptions() []string {
	opts := []string{}

	if e.config.Security.NoNewPrivileges {
		opts = append(opts, "no-new-privileges")
	}

	// Seccomp: an empty/"default" profile lets Docker apply its built-in default
	// seccomp filter (already a strong syscall allowlist); a named profile
	// overrides it. We never pass "seccomp=unconfined", so the default is always
	// enforced (Phase 3.1).
	if e.config.Security.SeccompProfile != "" && e.config.Security.SeccompProfile != "default" {
		opts = append(opts, fmt.Sprintf("seccomp=%s", e.config.Security.SeccompProfile))
	}

	// AppArmor: apply a named profile when configured. Empty by default so
	// AppArmor-less hosts (macOS/dev) are unaffected; on Linux Docker applies
	// its docker-default profile automatically.
	if e.config.Security.ApparmorProfile != "" {
		opts = append(opts, fmt.Sprintf("apparmor=%s", e.config.Security.ApparmorProfile))
	}

	return opts
}

// streamLogs streams container logs to the updates channel
func (e *Executor) streamLogs(ctx context.Context, containerID string, updates chan<- types.ExecutionUpdate) {
	options := client.ContainerLogsOptions{
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
	_, err := e.dockerClient.ContainerRemove(ctx, containerID, client.ContainerRemoveOptions{
		Force: true,
	})
	return err
}

// sendUpdate sends an execution update. Fast path is non-blocking; when the
// buffer is full it falls back to a bounded blocking send instead of dropping.
// A drop-on-full here previously meant a lost UpdateTypeComplete turned a
// failed job into a reported success (scheduling review C6) — terminal updates
// must never be droppable, and a 30s consumer stall is the only case where
// anything is dropped now (loudly).
func (e *Executor) sendUpdate(updates chan<- types.ExecutionUpdate, updateType types.UpdateType, data interface{}) {
	update := types.ExecutionUpdate{
		Type:      updateType,
		Timestamp: time.Now(),
		Data:      data,
	}
	select {
	case updates <- update:
		return
	default:
	}
	select {
	case updates <- update:
	case <-time.After(30 * time.Second):
		e.log.WithField("updateType", updateType).
			Error("Updates channel blocked for 30s, dropping update")
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

	// Simple parser for common units. Suffixes are checked LONGEST-first: "B" is
	// a suffix of "MB"/"KB"/"GB", so a map with random iteration order would
	// sometimes match "512MB" as "512M"+"B" and fail (silently leaving memory
	// unbounded). This ordered slice makes "512MB" always parse correctly.
	mem = strings.ToUpper(strings.TrimSpace(mem))

	units := []struct {
		suffix     string
		multiplier int64
	}{
		{"KB", 1024},
		{"MB", 1024 * 1024},
		{"GB", 1024 * 1024 * 1024},
		{"B", 1},
	}

	for _, u := range units {
		if strings.HasSuffix(mem, u.suffix) {
			valueStr := strings.TrimSuffix(mem, u.suffix)
			value, err := strconv.ParseFloat(valueStr, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid memory value: %s", mem)
			}
			return int64(value * float64(u.multiplier)), nil
		}
	}

	// Try parsing as raw number (assume bytes)
	value, err := strconv.ParseInt(mem, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid memory format: %s", mem)
	}

	return value, nil
}

// ensureImage ensures the image is available locally
func (e *Executor) ensureImage(ctx context.Context, image string) error {
	// First check if image exists locally
	_, err := e.dockerClient.ImageInspect(ctx, image)
	if err == nil {
		// Image exists locally
		return nil
	}

	// Image doesn't exist, try to pull it
	e.log.WithField("image", image).Info("Pulling Docker image")

	reader, err := e.dockerClient.ImagePull(ctx, image, client.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("failed to pull image: %w", err)
	}
	defer reader.Close()

	// Read the output to ensure the pull completes
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, reader); err != nil {
		return fmt.Errorf("failed to read pull output: %w", err)
	}

	e.log.WithField("image", image).Info("Successfully pulled Docker image")
	return nil
}

// updateExecutionError updates the execution record with error details
func (e *Executor) updateExecutionError(ctx context.Context, executionID string, err error) {
	if e.apiClient == nil || executionID == "" {
		return
	}

	now := time.Now()
	errorMsg := err.Error()
	exitCode := -99 // Generic error code

	// Determine exit code based on error type
	if errors.GetErrorType(err) == errors.ErrorTypeTimeout {
		exitCode = -1
	} else if errors.GetErrorType(err) == errors.ErrorTypeDocker {
		exitCode = -10
	} else if errors.GetErrorType(err) == errors.ErrorTypeValidation {
		exitCode = -20
	}

	updateData := &api.ExecutionStatusUpdate{
		CompletedAt: &now,
		ExitCode:    &exitCode,
		Error:       &errorMsg,
	}

	// Use a fresh context for the API call
	apiCtx, apiCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer apiCancel()

	if e.apiClient != nil {
		if err := e.apiClient.UpdateExecution(apiCtx, executionID, types.JobStatusFailed, updateData); err != nil {
			e.log.WithError(err).Warn("Failed to update execution with error")
		}
	}
}

// GetCleanupManager returns the cleanup manager for this executor
func (e *Executor) GetCleanupManager() *CleanupManager {
	return e.cleanup
}
