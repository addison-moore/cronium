package container

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPhaseDurationMs(t *testing.T) {
	base := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)

	// Normal case.
	assert.EqualValues(t, 1500, phaseDurationMs(base, base.Add(1500*time.Millisecond)))

	// Unset endpoints must yield 0, never a ~9.2e12ms garbage value that
	// overflows the app's int4 duration columns.
	assert.EqualValues(t, 0, phaseDurationMs(time.Time{}, base))
	assert.EqualValues(t, 0, phaseDurationMs(base, time.Time{}))
	assert.EqualValues(t, 0, phaseDurationMs(time.Time{}, time.Time{}))

	// Clock skew (negative duration) clamps to 0.
	assert.EqualValues(t, 0, phaseDurationMs(base, base.Add(-time.Second)))
}

func TestExecutionTimingLifecycle(t *testing.T) {
	timing := NewExecutionTiming()
	require.False(t, timing.TotalStart.IsZero())
	assert.Equal(t, timing.TotalStart, timing.SetupStart)

	// In-flight total duration works before completion.
	assert.GreaterOrEqual(t, timing.GetTotalDuration(), int64(0))
	assert.EqualValues(t, 0, timing.GetSetupDuration(), "setup not finished yet")

	timing.MarkSetupComplete()
	assert.False(t, timing.SetupEnd.IsZero())
	assert.Equal(t, timing.SetupEnd, timing.ExecutionStart)

	timing.MarkExecutionComplete()
	assert.Equal(t, timing.ExecutionEnd, timing.CleanupStart)

	timing.MarkCleanupComplete()
	assert.False(t, timing.CleanupEnd.IsZero())
	assert.Equal(t, timing.CleanupEnd, timing.TotalEnd)

	assert.GreaterOrEqual(t, timing.GetSetupDuration(), int64(0))
	assert.GreaterOrEqual(t, timing.GetExecutionDuration(), int64(0))
	assert.GreaterOrEqual(t, timing.GetCleanupDuration(), int64(0))
	assert.GreaterOrEqual(t, timing.GetTotalDuration(), int64(0))
}

func TestGetTotalDuration_ZeroStart(t *testing.T) {
	timing := &ExecutionTiming{}
	assert.EqualValues(t, 0, timing.GetTotalDuration())
}

func TestToExecutionStatusUpdate_UnfinishedPhasesAreNil(t *testing.T) {
	timing := NewExecutionTiming()
	update := timing.ToExecutionStatusUpdate()

	require.NotNil(t, update.StartedAt)
	assert.Equal(t, timing.TotalStart, *update.StartedAt)
	require.NotNil(t, update.SetupStartedAt)

	// Phases that never completed must be nil, not zero timestamps.
	assert.Nil(t, update.CompletedAt)
	assert.Nil(t, update.SetupCompletedAt)
	assert.Nil(t, update.ExecutionCompletedAt)
	assert.Nil(t, update.CleanupCompletedAt)

	require.NotNil(t, update.SetupDuration)
	assert.EqualValues(t, 0, *update.SetupDuration)
}

func TestToExecutionStatusUpdate_CompletedRunIncludesDurationsAndMetadata(t *testing.T) {
	timing := NewExecutionTiming()
	timing.MarkSetupComplete()
	timing.MarkExecutionComplete()
	timing.MarkCleanupComplete()
	timing.ImageRef = "cronium/runner:bash-alpine"
	timing.ImageDigest = "sha256:abc123"

	update := timing.ToExecutionStatusUpdate()

	require.NotNil(t, update.CompletedAt)
	require.NotNil(t, update.SetupCompletedAt)
	require.NotNil(t, update.ExecutionCompletedAt)
	require.NotNil(t, update.CleanupCompletedAt)
	require.NotNil(t, update.TotalDuration)

	require.NotNil(t, update.ExecutionMetadata)
	assert.Equal(t, "cronium/runner:bash-alpine", update.ExecutionMetadata["imageRef"])
	assert.Equal(t, "sha256:abc123", update.ExecutionMetadata["imageDigest"])
	for _, key := range []string{"networkCreateTime", "sidecarCreateTime", "containerPullTime", "containerCreateTime"} {
		assert.Contains(t, update.ExecutionMetadata, key)
	}
}

func TestToExecutionStatusUpdate_NoImageIdentityOmitsMetadataKeys(t *testing.T) {
	timing := NewExecutionTiming()
	update := timing.ToExecutionStatusUpdate()

	assert.NotContains(t, update.ExecutionMetadata, "imageRef")
	assert.NotContains(t, update.ExecutionMetadata, "imageDigest")
}
