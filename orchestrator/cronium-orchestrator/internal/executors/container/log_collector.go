package container

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/addison-more/cronium/orchestrator/pkg/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/pkg/stdcopy"
)

// collectFinalLogs collects all logs from a stopped container
// This is an alternative approach that ensures no logs are lost
func (e *Executor) collectFinalLogs(ctx context.Context, containerID string, updates chan<- types.ExecutionUpdate) error {
	// Get all logs from the container (not following)
	options := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     false, // Don't follow, just get what's there
		Timestamps: true,
		Details:    true,
	}
	
	logs, err := e.dockerClient.ContainerLogs(ctx, containerID, options)
	if err != nil {
		return fmt.Errorf("failed to collect final logs: %w", err)
	}
	defer logs.Close()
	
	// Process all logs at once
	stdout := &strings.Builder{}
	stderr := &strings.Builder{}
	
	if _, err := stdcopy.StdCopy(stdout, stderr, logs); err != nil {
		return fmt.Errorf("failed to process final logs: %w", err)
	}
	
	// Send stdout logs
	if stdout.Len() > 0 {
		sequence := int64(0)
		for _, line := range strings.Split(strings.TrimRight(stdout.String(), "\n"), "\n") {
			if line != "" {
				sequence++
				e.sendUpdate(updates, types.UpdateTypeLog, &types.LogEntry{
					Stream:    "stdout",
					Line:      line,
					Timestamp: time.Now(),
					Sequence:  sequence,
				})
			}
		}
	}
	
	// Send stderr logs
	if stderr.Len() > 0 {
		sequence := int64(0)
		for _, line := range strings.Split(strings.TrimRight(stderr.String(), "\n"), "\n") {
			if line != "" {
				sequence++
				e.sendUpdate(updates, types.UpdateTypeLog, &types.LogEntry{
					Stream:    "stderr",
					Line:      line,
					Timestamp: time.Now(),
					Sequence:  sequence,
				})
			}
		}
	}
	
	return nil
}

// Alternative Execute implementation that collects logs after container stops
// This ensures 100% log capture but loses real-time streaming
// NOTE: This is a placeholder for an alternative implementation approach
// The actual implementation would need to properly create the container first
/*
func (e *Executor) ExecuteWithFinalLogCollection(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	// This method would:
	// 1. Create and start container (like in Execute method)
	// 2. Wait for completion without streaming logs
	// 3. Collect all logs at once using collectFinalLogs
	// 4. Send all log updates followed by completion
	//
	// This approach guarantees 100% log capture but sacrifices real-time updates
	return nil, fmt.Errorf("not implemented - see Execute method for current implementation")
}
*/