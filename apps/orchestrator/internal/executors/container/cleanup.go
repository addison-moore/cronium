package container

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	containertypes "github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	networktypes "github.com/docker/docker/api/types/network"
	"github.com/sirupsen/logrus"
)

// CleanupManager handles cleanup of Docker resources
type CleanupManager struct {
	executor     *Executor
	log          *logrus.Logger
	cleanupMutex sync.Mutex
}

// NewCleanupManager creates a new cleanup manager
func NewCleanupManager(executor *Executor, log *logrus.Logger) *CleanupManager {
	return &CleanupManager{
		executor: executor,
		log:      log,
	}
}

// CleanupOrphanedResources performs a full cleanup of orphaned resources
func (cm *CleanupManager) CleanupOrphanedResources(ctx context.Context) error {
	cm.cleanupMutex.Lock()
	defer cm.cleanupMutex.Unlock()

	cm.log.Info("Starting cleanup of orphaned resources")

	var errors []error

	// Clean up orphaned containers
	if err := cm.cleanupOrphanedContainers(ctx); err != nil {
		errors = append(errors, fmt.Errorf("container cleanup failed: %w", err))
	}

	// Clean up orphaned networks
	if err := cm.cleanupOrphanedNetworks(ctx); err != nil {
		errors = append(errors, fmt.Errorf("network cleanup failed: %w", err))
	}

	if len(errors) > 0 {
		return fmt.Errorf("cleanup completed with errors: %v", errors)
	}

	cm.log.Info("Cleanup of orphaned resources completed successfully")
	return nil
}

// cleanupOrphanedContainers removes containers that are no longer tracked
func (cm *CleanupManager) cleanupOrphanedContainers(ctx context.Context) error {
	// List all containers with cronium-job prefix
	filters := filters.NewArgs()
	filters.Add("name", "cronium-job-")
	filters.Add("name", "cronium-sidecar-")

	containers, err := cm.executor.dockerClient.ContainerList(ctx, containertypes.ListOptions{
		All:     true,
		Filters: filters,
	})
	if err != nil {
		return fmt.Errorf("failed to list containers: %w", err)
	}

	// Get currently tracked containers
	cm.executor.mu.RLock()
	trackedContainers := make(map[string]bool)
	for _, containerID := range cm.executor.containers {
		trackedContainers[containerID] = true
	}
	for _, sidecarID := range cm.executor.sidecars {
		trackedContainers[sidecarID] = true
	}
	cm.executor.mu.RUnlock()

	// Clean up untracked containers
	for _, container := range containers {
		if !trackedContainers[container.ID] {
			// Check if container is old enough (e.g., created more than 1 hour ago)
			if time.Since(time.Unix(container.Created, 0)) > time.Hour {
				cm.log.WithFields(logrus.Fields{
					"containerID":   container.ID[:12],
					"containerName": container.Names[0],
					"created":       time.Unix(container.Created, 0),
				}).Info("Removing orphaned container")

				// Stop container if running
				if container.State == "running" {
					timeout := 10
					if err := cm.executor.dockerClient.ContainerStop(ctx, container.ID, containertypes.StopOptions{
						Timeout: &timeout,
					}); err != nil {
						cm.log.WithError(err).Warn("Failed to stop orphaned container")
					}
				}

				// Remove container
				if err := cm.executor.dockerClient.ContainerRemove(ctx, container.ID, containertypes.RemoveOptions{
					Force: true,
				}); err != nil {
					cm.log.WithError(err).Error("Failed to remove orphaned container")
				}
			}
		}
	}

	return nil
}

// cleanupOrphanedNetworks removes networks that are no longer tracked
func (cm *CleanupManager) cleanupOrphanedNetworks(ctx context.Context) error {
	// List all networks with cronium-job prefix
	filters := filters.NewArgs()
	filters.Add("name", "cronium-job-")

	networks, err := cm.executor.dockerClient.NetworkList(ctx, networktypes.ListOptions{
		Filters: filters,
	})
	if err != nil {
		return fmt.Errorf("failed to list networks: %w", err)
	}

	// Get currently tracked networks
	cm.executor.mu.RLock()
	trackedNetworks := make(map[string]bool)
	for _, networkID := range cm.executor.networks {
		trackedNetworks[networkID] = true
	}
	cm.executor.mu.RUnlock()

	// Clean up untracked networks
	for _, network := range networks {
		if !trackedNetworks[network.ID] {
			// Check if network is old enough and not in use
			networkInfo, err := cm.executor.dockerClient.NetworkInspect(ctx, network.ID, networktypes.InspectOptions{})
			if err != nil {
				cm.log.WithError(err).Warn("Failed to inspect network")
				continue
			}

			// Skip if network has connected containers
			if len(networkInfo.Containers) > 0 {
				continue
			}

			// Remove if created more than 30 minutes ago
			if time.Since(networkInfo.Created) > 30*time.Minute {
				cm.log.WithFields(logrus.Fields{
					"networkID":   network.ID[:12],
					"networkName": network.Name,
					"created":     networkInfo.Created,
				}).Info("Removing orphaned network")

				if err := cm.executor.dockerClient.NetworkRemove(ctx, network.ID); err != nil {
					cm.log.WithError(err).Error("Failed to remove orphaned network")
				}
			}
		}
	}

	return nil
}

// CleanupJobResources ensures all resources for a specific job are cleaned up
func (cm *CleanupManager) CleanupJobResources(ctx context.Context, jobID string) error {
	cm.log.WithField("jobID", jobID).Info("Performing comprehensive job cleanup")

	var errors []error

	// Clean up by job ID pattern in container/network names
	jobPattern := fmt.Sprintf("job-%s", jobID)

	// Clean up containers
	if err := cm.cleanupContainersByPattern(ctx, jobPattern); err != nil {
		errors = append(errors, fmt.Errorf("container cleanup failed: %w", err))
	}

	// Clean up networks
	if err := cm.cleanupNetworksByPattern(ctx, jobPattern); err != nil {
		errors = append(errors, fmt.Errorf("network cleanup failed: %w", err))
	}

	// Note: executor.Cleanup requires a specific job, so we don't call it here
	// The container and network cleanup above handles orphaned resources

	if len(errors) > 0 {
		return fmt.Errorf("job cleanup completed with errors: %v", errors)
	}

	return nil
}

// cleanupContainersByPattern removes containers matching a pattern
func (cm *CleanupManager) cleanupContainersByPattern(ctx context.Context, pattern string) error {
	filters := filters.NewArgs()
	filters.Add("name", pattern)

	containers, err := cm.executor.dockerClient.ContainerList(ctx, containertypes.ListOptions{
		All:     true,
		Filters: filters,
	})
	if err != nil {
		return fmt.Errorf("failed to list containers: %w", err)
	}

	for _, container := range containers {
		cm.log.WithFields(logrus.Fields{
			"containerID":   container.ID[:12],
			"containerName": container.Names[0],
		}).Debug("Cleaning up container")

		// Stop if running
		if container.State == "running" {
			timeout := 10
			if err := cm.executor.dockerClient.ContainerStop(ctx, container.ID, containertypes.StopOptions{
				Timeout: &timeout,
			}); err != nil && !strings.Contains(err.Error(), "not running") {
				cm.log.WithError(err).Warn("Failed to stop container")
			}
		}

		// Remove container
		if err := cm.executor.dockerClient.ContainerRemove(ctx, container.ID, containertypes.RemoveOptions{
			Force: true,
		}); err != nil && !strings.Contains(err.Error(), "No such container") {
			cm.log.WithError(err).Error("Failed to remove container")
		}
	}

	return nil
}

// cleanupNetworksByPattern removes networks matching a pattern
func (cm *CleanupManager) cleanupNetworksByPattern(ctx context.Context, pattern string) error {
	filters := filters.NewArgs()
	filters.Add("name", pattern)

	networks, err := cm.executor.dockerClient.NetworkList(ctx, networktypes.ListOptions{
		Filters: filters,
	})
	if err != nil {
		return fmt.Errorf("failed to list networks: %w", err)
	}

	for _, network := range networks {
		cm.log.WithFields(logrus.Fields{
			"networkID":   network.ID[:12],
			"networkName": network.Name,
		}).Debug("Cleaning up network")

		if err := cm.executor.dockerClient.NetworkRemove(ctx, network.ID); err != nil && 
			!strings.Contains(err.Error(), "No such network") &&
			!strings.Contains(err.Error(), "has active endpoints") {
			cm.log.WithError(err).Error("Failed to remove network")
		}
	}

	return nil
}

// StartPeriodicCleanup starts a goroutine that periodically cleans up orphaned resources
func (cm *CleanupManager) StartPeriodicCleanup(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				cm.log.Info("Stopping periodic cleanup")
				return
			case <-ticker.C:
				if err := cm.CleanupOrphanedResources(ctx); err != nil {
					cm.log.WithError(err).Error("Periodic cleanup failed")
				}
			}
		}
	}()
}