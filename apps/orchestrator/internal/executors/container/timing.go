package container

import (
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
)

// ExecutionTiming tracks phase-based timing for container execution
type ExecutionTiming struct {
	// Overall timing
	TotalStart time.Time
	TotalEnd   time.Time

	// Setup phase (network, sidecar, container creation)
	SetupStart         time.Time
	SetupEnd           time.Time
	NetworkCreateStart time.Time
	NetworkCreateEnd   time.Time
	SidecarCreateStart time.Time
	SidecarCreateEnd   time.Time
	ContainerPullStart time.Time
	ContainerPullEnd   time.Time
	ContainerCreateStart time.Time
	ContainerCreateEnd   time.Time

	// Execution phase (actual script running)
	ExecutionStart time.Time
	ExecutionEnd   time.Time

	// Cleanup phase
	CleanupStart time.Time
	CleanupEnd   time.Time
}

// NewExecutionTiming creates a new timing tracker
func NewExecutionTiming() *ExecutionTiming {
	now := time.Now()
	return &ExecutionTiming{
		TotalStart: now,
		SetupStart: now,
	}
}

// MarkSetupComplete marks the setup phase as complete and starts execution phase
func (t *ExecutionTiming) MarkSetupComplete() {
	now := time.Now()
	t.SetupEnd = now
	t.ExecutionStart = now
}

// MarkExecutionComplete marks the execution phase as complete and starts cleanup phase
func (t *ExecutionTiming) MarkExecutionComplete() {
	now := time.Now()
	t.ExecutionEnd = now
	t.CleanupStart = now
}

// MarkCleanupComplete marks the cleanup phase as complete
func (t *ExecutionTiming) MarkCleanupComplete() {
	now := time.Now()
	t.CleanupEnd = now
	t.TotalEnd = now
}

// GetSetupDuration returns the setup phase duration in milliseconds
func (t *ExecutionTiming) GetSetupDuration() int64 {
	if t.SetupEnd.IsZero() {
		return 0
	}
	return t.SetupEnd.Sub(t.SetupStart).Milliseconds()
}

// GetExecutionDuration returns the execution phase duration in milliseconds
func (t *ExecutionTiming) GetExecutionDuration() int64 {
	if t.ExecutionEnd.IsZero() {
		return 0
	}
	return t.ExecutionEnd.Sub(t.ExecutionStart).Milliseconds()
}

// GetCleanupDuration returns the cleanup phase duration in milliseconds
func (t *ExecutionTiming) GetCleanupDuration() int64 {
	if t.CleanupEnd.IsZero() {
		return 0
	}
	return t.CleanupEnd.Sub(t.CleanupStart).Milliseconds()
}

// GetTotalDuration returns the total duration in milliseconds
func (t *ExecutionTiming) GetTotalDuration() int64 {
	if t.TotalEnd.IsZero() {
		// If not complete, calculate from start to now
		return time.Since(t.TotalStart).Milliseconds()
	}
	return t.TotalEnd.Sub(t.TotalStart).Milliseconds()
}

// ToExecutionStatusUpdate converts timing to API update format
func (t *ExecutionTiming) ToExecutionStatusUpdate() *api.ExecutionStatusUpdate {
	setupDuration := t.GetSetupDuration()
	executionDuration := t.GetExecutionDuration()
	cleanupDuration := t.GetCleanupDuration()
	totalDuration := t.GetTotalDuration()

	update := &api.ExecutionStatusUpdate{
		StartedAt:   &t.TotalStart,
		CompletedAt: &t.TotalEnd,
		// Phase timing
		SetupStartedAt:       &t.SetupStart,
		SetupCompletedAt:     &t.SetupEnd,
		ExecutionStartedAt:   &t.ExecutionStart,
		ExecutionCompletedAt: &t.ExecutionEnd,
		CleanupStartedAt:     &t.CleanupStart,
		CleanupCompletedAt:   &t.CleanupEnd,
		// Durations
		SetupDuration:     &setupDuration,
		ExecutionDuration: &executionDuration,
		CleanupDuration:   &cleanupDuration,
		TotalDuration:     &totalDuration,
		// Metadata with detailed timing breakdown
		ExecutionMetadata: map[string]interface{}{
			"networkCreateTime": t.NetworkCreateEnd.Sub(t.NetworkCreateStart).Milliseconds(),
			"sidecarCreateTime": t.SidecarCreateEnd.Sub(t.SidecarCreateStart).Milliseconds(),
			"containerPullTime": t.ContainerPullEnd.Sub(t.ContainerPullStart).Milliseconds(),
			"containerCreateTime": t.ContainerCreateEnd.Sub(t.ContainerCreateStart).Milliseconds(),
		},
	}

	// Only set completed times if they're not zero
	if t.SetupEnd.IsZero() {
		update.SetupCompletedAt = nil
	}
	if t.ExecutionEnd.IsZero() {
		update.ExecutionCompletedAt = nil
	}
	if t.CleanupEnd.IsZero() {
		update.CleanupCompletedAt = nil
	}
	if t.TotalEnd.IsZero() {
		update.CompletedAt = nil
	}

	return update
}