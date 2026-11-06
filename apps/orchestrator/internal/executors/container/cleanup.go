package container

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/client"
	"github.com/sirupsen/logrus"
)

// orphanContainerFilters narrows the search to job containers and runtime sidecars.
// Docker matches these against the whole name, so they're anchored. They only narrow
// the search: isOrphanCandidate is what decides.
func orphanContainerFilters() client.Filters {
	return make(client.Filters).Add("name", "^/cronium-job-", "^/cronium-runtime-")
}

// isOrphanCandidate reports whether a container is one this process may remove if
// nothing is tracking it. A sidecar has always carried the managed label, and a name
// alone isn't enough to go on: the stack's own runtime service is named
// <project>-cronium-runtime-1, and a project could be called cronium-runtime. A job
// container from before it was labelled can only be known by its name.
func (e *Executor) isOrphanCandidate(names []string, labels map[string]string) bool {
	if e.foreignToThisStack(labels) {
		return false
	}
	if labels[labelManaged] == "true" {
		return true
	}
	for _, name := range names {
		if strings.HasPrefix(strings.TrimPrefix(name, "/"), "cronium-job-") {
			return true
		}
	}
	return false
}

// orphanedAfter is how old an untracked container must be to count as orphaned. One
// labelled by this orchestrator is only untracked while it's being set up, so past
// that its removal failed. An older one may be anything's, so it gets longer.
func (e *Executor) orphanedAfter(labels map[string]string) time.Duration {
	if _, labelled := labels[labelOrchestratorID]; labelled && e.timeoutConfig.SetupTimeout > 0 {
		return e.timeoutConfig.SetupTimeout
	}
	return time.Hour
}

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

// cleanupOrphanedContainers removes containers that are no longer tracked. What an
// earlier process left is dealt with at startup, so this catches removals that
// failed, and containers from before they carried this orchestrator's labels.
func (cm *CleanupManager) cleanupOrphanedContainers(ctx context.Context) error {
	result, err := cm.executor.dockerClient.ContainerList(ctx, client.ContainerListOptions{
		All:     true,
		Filters: orphanContainerFilters(),
	})
	if err != nil {
		return fmt.Errorf("failed to list containers: %w", err)
	}
	containers := result.Items

	// Get currently tracked containers
	cm.executor.mu.RLock()
	trackedContainers := make(map[string]bool)
	for _, containerID := range cm.executor.containers {
		trackedContainers[containerID] = true
	}
	for _, sidecarID := range cm.executor.sidecars {
		trackedContainers[sidecarID] = true
	}
	for _, res := range cm.executor.leftovers {
		trackedContainers[res.containerID] = true
		trackedContainers[res.sidecarID] = true
	}
	cm.executor.mu.RUnlock()

	// Clean up untracked containers
	for _, container := range containers {
		if !cm.executor.isOrphanCandidate(container.Names, container.Labels) {
			continue
		}
		if !trackedContainers[container.ID] {
			if time.Since(time.Unix(container.Created, 0)) > cm.executor.orphanedAfter(container.Labels) {
				cm.log.WithFields(logrus.Fields{
					"containerID":   container.ID[:12],
					"containerName": container.Names[0],
					"created":       time.Unix(container.Created, 0),
				}).Info("Removing orphaned container")

				// Stop container if running
				if container.State == "running" {
					timeout := 10
					if _, err := cm.executor.dockerClient.ContainerStop(ctx, container.ID, client.ContainerStopOptions{
						Timeout: &timeout,
					}); err != nil {
						cm.log.WithError(err).Warn("Failed to stop orphaned container")
					}
				}

				// Remove container
				if _, err := cm.executor.dockerClient.ContainerRemove(ctx, container.ID, client.ContainerRemoveOptions{
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
	// Job networks have always carried this label
	filters := make(client.Filters).Add("label", labelManaged+"=true")

	result, err := cm.executor.dockerClient.NetworkList(ctx, client.NetworkListOptions{
		Filters: filters,
	})
	if err != nil {
		return fmt.Errorf("failed to list networks: %w", err)
	}
	networks := result.Items

	// Get currently tracked networks
	cm.executor.mu.RLock()
	trackedNetworks := make(map[string]bool)
	for _, networkID := range cm.executor.networks {
		trackedNetworks[networkID] = true
	}
	for _, res := range cm.executor.leftovers {
		trackedNetworks[res.networkID] = true
	}
	cm.executor.mu.RUnlock()

	// Clean up untracked networks
	for _, network := range networks {
		if cm.executor.foreignToThisStack(network.Labels) {
			continue
		}
		if !trackedNetworks[network.ID] {
			// Check if network is old enough and not in use
			inspectResult, err := cm.executor.dockerClient.NetworkInspect(ctx, network.ID, client.NetworkInspectOptions{})
			if err != nil {
				cm.log.WithError(err).Warn("Failed to inspect network")
				continue
			}
			networkInfo := inspectResult.Network

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

				if _, err := cm.executor.dockerClient.NetworkRemove(ctx, network.ID, client.NetworkRemoveOptions{}); err != nil {
					cm.log.WithError(err).Error("Failed to remove orphaned network")
				}
			}
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
