package ssh

import (
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
)

// ExecutionTiming tracks phase-based timing for SSH execution
type ExecutionTiming struct {
	// Overall timing
	TotalStart time.Time
	TotalEnd   time.Time

	// Setup phase (connection, runner deployment, payload transfer)
	SetupStart           time.Time
	SetupEnd             time.Time
	ConnectionStart      time.Time
	ConnectionEnd        time.Time
	RunnerDeployStart    time.Time
	RunnerDeployEnd      time.Time
	RunnerVerifyStart    time.Time
	RunnerVerifyEnd      time.Time
	PayloadCreateStart   time.Time
	PayloadCreateEnd     time.Time
	PayloadTransferStart time.Time
	PayloadTransferEnd   time.Time
	TunnelSetupStart     time.Time // For API mode
	TunnelSetupEnd       time.Time

	// Execution phase (actual script running)
	ExecutionStart time.Time
	ExecutionEnd   time.Time

	// Cleanup phase
	CleanupStart time.Time
	CleanupEnd   time.Time

	// Multi-server specific
	ServerName string
	IsParallel bool
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

// GetConnectionTime returns the SSH connection time in milliseconds
func (t *ExecutionTiming) GetConnectionTime() int64 {
	if t.ConnectionEnd.IsZero() || t.ConnectionStart.IsZero() {
		return 0
	}
	return t.ConnectionEnd.Sub(t.ConnectionStart).Milliseconds()
}

// GetRunnerDeployTime returns the runner deployment time in milliseconds
func (t *ExecutionTiming) GetRunnerDeployTime() int64 {
	if t.RunnerDeployEnd.IsZero() || t.RunnerDeployStart.IsZero() {
		return 0
	}
	return t.RunnerDeployEnd.Sub(t.RunnerDeployStart).Milliseconds()
}

// GetPayloadTransferTime returns the payload transfer time in milliseconds
func (t *ExecutionTiming) GetPayloadTransferTime() int64 {
	if t.PayloadTransferEnd.IsZero() || t.PayloadTransferStart.IsZero() {
		return 0
	}
	return t.PayloadTransferEnd.Sub(t.PayloadTransferStart).Milliseconds()
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
		ExecutionMetadata: t.buildMetadata(),
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

// buildMetadata creates the execution metadata with timing details
func (t *ExecutionTiming) buildMetadata() map[string]interface{} {
	metadata := map[string]interface{}{
		"executionType": "ssh",
	}

	// Add connection time if available
	if !t.ConnectionStart.IsZero() && !t.ConnectionEnd.IsZero() {
		metadata["connectionTime"] = t.GetConnectionTime()
	}

	// Add runner deployment time if available
	if !t.RunnerDeployStart.IsZero() && !t.RunnerDeployEnd.IsZero() {
		metadata["runnerDeployTime"] = t.GetRunnerDeployTime()
	}

	// Add runner verification time if available
	if !t.RunnerVerifyStart.IsZero() && !t.RunnerVerifyEnd.IsZero() {
		metadata["runnerVerifyTime"] = t.RunnerVerifyEnd.Sub(t.RunnerVerifyStart).Milliseconds()
	}

	// Add payload creation time if available
	if !t.PayloadCreateStart.IsZero() && !t.PayloadCreateEnd.IsZero() {
		metadata["payloadCreateTime"] = t.PayloadCreateEnd.Sub(t.PayloadCreateStart).Milliseconds()
	}

	// Add payload transfer time if available
	if !t.PayloadTransferStart.IsZero() && !t.PayloadTransferEnd.IsZero() {
		metadata["payloadTransferTime"] = t.GetPayloadTransferTime()
	}

	// Add tunnel setup time if available (API mode)
	if !t.TunnelSetupStart.IsZero() && !t.TunnelSetupEnd.IsZero() {
		metadata["tunnelSetupTime"] = t.TunnelSetupEnd.Sub(t.TunnelSetupStart).Milliseconds()
	}

	// Add server name if this is for a specific server
	if t.ServerName != "" {
		metadata["serverName"] = t.ServerName
	}

	// Indicate if this was part of parallel execution
	if t.IsParallel {
		metadata["parallelExecution"] = true
	}

	return metadata
}

// Clone creates a copy of the timing for multi-server execution
func (t *ExecutionTiming) Clone() *ExecutionTiming {
	return &ExecutionTiming{
		TotalStart:           t.TotalStart,
		TotalEnd:             t.TotalEnd,
		SetupStart:           t.SetupStart,
		SetupEnd:             t.SetupEnd,
		ConnectionStart:      t.ConnectionStart,
		ConnectionEnd:        t.ConnectionEnd,
		RunnerDeployStart:    t.RunnerDeployStart,
		RunnerDeployEnd:      t.RunnerDeployEnd,
		RunnerVerifyStart:    t.RunnerVerifyStart,
		RunnerVerifyEnd:      t.RunnerVerifyEnd,
		PayloadCreateStart:   t.PayloadCreateStart,
		PayloadCreateEnd:     t.PayloadCreateEnd,
		PayloadTransferStart: t.PayloadTransferStart,
		PayloadTransferEnd:   t.PayloadTransferEnd,
		TunnelSetupStart:     t.TunnelSetupStart,
		TunnelSetupEnd:       t.TunnelSetupEnd,
		ExecutionStart:       t.ExecutionStart,
		ExecutionEnd:         t.ExecutionEnd,
		CleanupStart:         t.CleanupStart,
		CleanupEnd:           t.CleanupEnd,
		ServerName:           t.ServerName,
		IsParallel:           t.IsParallel,
	}
}