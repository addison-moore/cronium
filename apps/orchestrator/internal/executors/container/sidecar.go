package container

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/go-connections/nat"
	"github.com/sirupsen/logrus"
)

// SidecarManager manages runtime API sidecar containers
type SidecarManager struct {
	executor *Executor
	log      *logrus.Logger
}

// NewSidecarManager creates a new sidecar manager
func NewSidecarManager(executor *Executor, log *logrus.Logger) *SidecarManager {
	return &SidecarManager{
		executor: executor,
		log:      log,
	}
}

// CreateRuntimeSidecar creates and starts a runtime API sidecar container
func (sm *SidecarManager) CreateRuntimeSidecar(ctx context.Context, job *types.Job, networkID string) (string, error) {
	// Generate JWT token for this execution
	token, err := sm.generateExecutionToken(job)
	if err != nil {
		return "", fmt.Errorf("failed to generate execution token: %w", err)
	}

	// Build container configuration
	containerConfig := &container.Config{
		Image: sm.getRuntimeImage(),
		Env: []string{
			"EXECUTION_ID=" + job.ID,
			"JWT_SECRET=" + sm.executor.config.Runtime.JWTSecret,
			"BACKEND_URL=" + sm.executor.config.Runtime.BackendURL,
			"BACKEND_TOKEN=" + os.Getenv("CRONIUM_API_TOKEN"),
			"VALKEY_URL=" + sm.executor.config.Runtime.ValkeyURL,
			"PORT=8081",
			"LOG_LEVEL=info",
		},
		ExposedPorts: nat.PortSet{
			"8081/tcp": struct{}{},
		},
		User: "1000:1000",
		Labels: map[string]string{
			"cronium.type":    "sidecar",
			"cronium.job.id":  job.ID,
			"cronium.service": "runtime-api",
			"cronium.managed": "true",
		},
		AttachStdout: true,
		AttachStderr: true,
	}

	// Build host configuration
	hostConfig := &container.HostConfig{
		AutoRemove:   false,
		NetworkMode:  container.NetworkMode(networkID),
		PortBindings: nil, // No external port binding
		Resources: container.Resources{
			Memory:   256 * 1024 * 1024, // 256MB
			NanoCPUs: int64(0.5 * 1e9),  // 0.5 CPU
		},
		RestartPolicy: container.RestartPolicy{
			Name: "no",
		},
		SecurityOpt: []string{
			"no-new-privileges",
		},
		ReadonlyRootfs: true,
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeTmpfs,
				Target: "/tmp",
				TmpfsOptions: &mount.TmpfsOptions{
					SizeBytes: 50 * 1024 * 1024, // 50MB
					Mode:      0o1777,
				},
			},
		},
	}

	// Network configuration
	networkConfig := &network.NetworkingConfig{
		EndpointsConfig: map[string]*network.EndpointSettings{
			networkID: {
				Aliases: []string{"runtime-api", "runtime"},
			},
		},
	}

	// Create container
	resp, err := sm.executor.dockerClient.ContainerCreate(
		ctx,
		containerConfig,
		hostConfig,
		networkConfig,
		nil,
		fmt.Sprintf("cronium-runtime-%s", job.ID),
	)
	if err != nil {
		return "", fmt.Errorf("failed to create runtime sidecar: %w", err)
	}

	// Start container
	if err := sm.executor.dockerClient.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		// Clean up on failure
		_ = sm.executor.dockerClient.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return "", fmt.Errorf("failed to start runtime sidecar: %w", err)
	}

	// Connect to shared services network if in development mode
	if os.Getenv("GO_ENV") == "development" {
		// Try to connect to the development network for access to shared services
		// Try both possible network names
		networks := []string{"docker_cronium-dev-network", "cronium-dev_cronium-dev-network"}
		connected := false
		for _, netName := range networks {
			if err := sm.executor.dockerClient.NetworkConnect(ctx, netName, resp.ID, nil); err == nil {
				sm.log.WithField("network", netName).Debug("Connected sidecar to development network")
				connected = true
				break
			}
		}
		if !connected {
			sm.log.Warn("Failed to connect sidecar to any development network")
		}
	}

	// Wait for sidecar to be healthy
	if err := sm.waitForHealth(ctx, resp.ID); err != nil {
		// Clean up on failure
		_ = sm.StopSidecar(ctx, resp.ID)
		return "", fmt.Errorf("runtime sidecar health check failed: %w", err)
	}

	sm.log.WithFields(logrus.Fields{
		"containerID": resp.ID,
		"jobID":       job.ID,
		"network":     networkID,
	}).Info("Runtime sidecar started successfully")

	// Store the token for the main container
	sm.storeExecutionToken(job.ID, token)

	return resp.ID, nil
}

// StopSidecar stops and removes a sidecar container
func (sm *SidecarManager) StopSidecar(ctx context.Context, containerID string) error {
	// Stop container with timeout
	timeout := 5
	if err := sm.executor.dockerClient.ContainerStop(ctx, containerID, container.StopOptions{
		Timeout: &timeout,
	}); err != nil {
		sm.log.WithError(err).Warn("Failed to stop sidecar gracefully")
	}

	// Remove container
	if err := sm.executor.dockerClient.ContainerRemove(ctx, containerID, container.RemoveOptions{
		Force: true,
	}); err != nil {
		return fmt.Errorf("failed to remove sidecar: %w", err)
	}

	return nil
}

// waitForHealth waits for the sidecar to become healthy
func (sm *SidecarManager) waitForHealth(ctx context.Context, containerID string) error {
	healthCheckURL := "http://localhost:8081/health"
	maxAttempts := 30
	interval := 1 * time.Second

	for i := 0; i < maxAttempts; i++ {
		// Check if container is still running
		inspect, err := sm.executor.dockerClient.ContainerInspect(ctx, containerID)
		if err != nil {
			return fmt.Errorf("failed to inspect container: %w", err)
		}

		if !inspect.State.Running {
			return fmt.Errorf("container stopped unexpectedly")
		}

		// Execute health check inside the container
		execResp, err := sm.executor.dockerClient.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          []string{"wget", "-q", "-O-", healthCheckURL},
			AttachStdout: true,
			AttachStderr: true,
		})
		if err == nil {
			if err := sm.executor.dockerClient.ContainerExecStart(ctx, execResp.ID, container.ExecStartOptions{}); err == nil {
				// Check exit code
				inspect, err := sm.executor.dockerClient.ContainerExecInspect(ctx, execResp.ID)
				if err == nil && inspect.ExitCode == 0 {
					return nil // Health check passed
				}
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
			// Continue trying
		}
	}

	return fmt.Errorf("health check timed out after %d attempts", maxAttempts)
}

// generateExecutionToken generates a JWT token for the execution
func (sm *SidecarManager) generateExecutionToken(job *types.Job) (string, error) {
	// Extract user and event IDs from metadata
	userID := ""
	eventID := ""

	if job.Metadata != nil {
		if uid, ok := job.Metadata["userId"].(string); ok {
			userID = uid
		}
		if eid, ok := job.Metadata["eventId"].(float64); ok {
			eventID = fmt.Sprintf("%d", int(eid))
		} else if eid, ok := job.Metadata["eventId"].(int); ok {
			eventID = fmt.Sprintf("%d", eid)
		} else if eid, ok := job.Metadata["eventId"].(string); ok {
			eventID = eid
		}
	}

	return generateJWT(job.ID, sm.executor.config.Runtime.JWTSecret, userID, eventID)
}

// storeExecutionToken stores the token for use by the main container
func (sm *SidecarManager) storeExecutionToken(jobID string, token string) {
	// Store in executor's token map (we'll add this to the executor)
	sm.executor.mu.Lock()
	defer sm.executor.mu.Unlock()

	if sm.executor.tokens == nil {
		sm.executor.tokens = make(map[string]string)
	}
	sm.executor.tokens[jobID] = token
}

// getExecutionToken retrieves the token for a job
func (sm *SidecarManager) getExecutionToken(jobID string) (string, error) {
	sm.executor.mu.RLock()
	defer sm.executor.mu.RUnlock()

	token, ok := sm.executor.tokens[jobID]
	if !ok {
		return "", fmt.Errorf("no token found for job %s", jobID)
	}

	return token, nil
}

// getRuntimeImage returns the runtime API image to use
func (sm *SidecarManager) getRuntimeImage() string {
	if img := sm.executor.config.Runtime.Image; img != "" {
		return img
	}
	return "cronium/runtime-api:latest"
}

// CreateJobNetwork creates an isolated network for a job
func (sm *SidecarManager) CreateJobNetwork(ctx context.Context, jobID string) (string, error) {
	networkName := fmt.Sprintf("cronium-job-%s", jobID)

	// Create network with specific configuration
	resp, err := sm.executor.dockerClient.NetworkCreate(ctx, networkName, network.CreateOptions{
		Driver: "bridge",
		Labels: map[string]string{
			"cronium.job.id":  jobID,
			"cronium.managed": "true",
		},
		Internal: sm.executor.config.Runtime.IsolateNetwork, // No external access if configured
		Options: map[string]string{
			"com.docker.network.bridge.enable_icc": "true", // Enable inter-container communication
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create job network: %w", err)
	}

	return resp.ID, nil
}

// RemoveJobNetwork removes the job's network
func (sm *SidecarManager) RemoveJobNetwork(ctx context.Context, networkID string) error {
	if err := sm.executor.dockerClient.NetworkRemove(ctx, networkID); err != nil {
		return fmt.Errorf("failed to remove job network: %w", err)
	}
	return nil
}
