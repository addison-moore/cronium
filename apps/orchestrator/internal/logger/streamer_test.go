package logger

import (
	"context"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus/hooks/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testWSLogConfig() config.WSLogConfig {
	return config.WSLogConfig{
		Enabled:       true,
		BufferSize:    10,
		FlushInterval: time.Hour, // effectively disable time-based flushing
		BatchSize:     3,
	}
}

// newTestStreamer builds a Streamer against the given server URL with fast
// reconnection, without starting it.
func newTestStreamer(t *testing.T, cfg config.WSLogConfig, url string) *Streamer {
	t.Helper()
	log, _ := test.NewNullLogger()
	s := NewStreamer(cfg, url, "test-token", log)
	if s.wsClient != nil {
		s.wsClient.initialReconnectDelay = 5 * time.Millisecond
		s.wsClient.reconnectDelay = 5 * time.Millisecond
		s.wsClient.maxReconnectDelay = 40 * time.Millisecond
	}
	return s
}

func bufferLen(jl *JobLogger) int {
	jl.bufferMu.Lock()
	defer jl.bufferMu.Unlock()
	return len(jl.buffer)
}

func TestNewStreamer_DisabledHasNoClient(t *testing.T) {
	log, _ := test.NewNullLogger()

	disabled := NewStreamer(config.WSLogConfig{Enabled: false}, "ws://example.invalid", "tok", log)
	assert.Nil(t, disabled.wsClient)

	noURL := NewStreamer(config.WSLogConfig{Enabled: true}, "", "tok", log)
	assert.Nil(t, noURL.wsClient)

	// The disabled streamer is inert but safe to use.
	require.NoError(t, disabled.Start(context.Background()))
	disabled.StreamLog("job-1", types.NewLogEntry("stdout", "dropped", 1))
	jl := disabled.StartJob("job-1")
	jl.AddLog(types.NewLogEntry("stdout", "buffered then dropped", 2))
	disabled.StopJob("job-1")
	require.NoError(t, disabled.Stop())
}

func TestStreamer_JobLifecycle(t *testing.T) {
	s := newTestStreamer(t, testWSLogConfig(), "") // no client needed

	_, exists := s.GetJobLogger("job-1")
	assert.False(t, exists)

	jl := s.StartJob("job-1")
	require.NotNil(t, jl)
	got, exists := s.GetJobLogger("job-1")
	assert.True(t, exists)
	assert.Same(t, jl, got)

	s.StopJob("job-1")
	_, exists = s.GetJobLogger("job-1")
	assert.False(t, exists)

	// Stopping an unknown job is a no-op.
	s.StopJob("nope")
}

func TestStreamer_BatchSizeTriggersFlush(t *testing.T) {
	srv := newWSTestServer(t)
	s := newTestStreamer(t, testWSLogConfig(), srv.wsURL()) // BatchSize=3
	require.NoError(t, s.Start(context.Background()))
	defer s.Stop()

	jl := s.StartJob("job-1")
	jl.AddLog(types.NewLogEntry("stdout", "one", 0))
	jl.AddLog(types.NewLogEntry("stderr", "two", 0))
	// Below the batch size: still buffered, nothing on the wire.
	require.Equal(t, 2, bufferLen(jl))

	jl.AddLog(types.NewLogEntry("stdout", "three", 0))
	require.Equal(t, 0, bufferLen(jl))

	lines := []string{"one", "two", "three"}
	streams := []string{"stdout", "stderr", "stdout"}
	for i := 0; i < 3; i++ {
		msg := srv.waitLogMessage(t)
		assert.Equal(t, "job-1", msg.JobID)
		assert.Equal(t, lines[i], msg.Line)
		assert.Equal(t, streams[i], msg.Stream)
		// The job logger assigns its own monotonically increasing sequence.
		assert.EqualValues(t, i+1, msg.Sequence)
	}
	srv.requireNoMoreMessages(t)
}

func TestStreamer_FlushIntervalTriggersFlush(t *testing.T) {
	srv := newWSTestServer(t)
	cfg := testWSLogConfig()
	cfg.FlushInterval = 10 * time.Millisecond
	cfg.BatchSize = 100 // batch flushing out of the picture
	s := newTestStreamer(t, cfg, srv.wsURL())
	require.NoError(t, s.Start(context.Background()))
	defer s.Stop()

	jl := s.StartJob("job-1")
	jl.AddLog(types.NewLogEntry("stdout", "eventually", 0))

	msg := srv.waitLogMessage(t)
	assert.Equal(t, "eventually", msg.Line)
	assert.EqualValues(t, 1, msg.Sequence)
}

func TestStreamer_DropsBufferedLogsWhileDisconnected(t *testing.T) {
	srv := newWSTestServer(t)
	cfg := testWSLogConfig()
	cfg.BatchSize = 2
	s := newTestStreamer(t, cfg, srv.wsURL())
	// Not started: the client exists but is not connected.

	jl := s.StartJob("job-1")
	jl.AddLog(types.NewLogEntry("stdout", "lost-1", 0))
	jl.AddLog(types.NewLogEntry("stdout", "lost-2", 0))

	// Policy: a flush while disconnected DROPS the batch (it is not queued).
	require.Equal(t, 0, bufferLen(jl))
	require.Len(t, s.wsClient.send, 0)

	// After connecting, new logs flow; the dropped ones never appear, and the
	// per-job sequence keeps counting across the dropped batch.
	require.NoError(t, s.wsClient.Connect(context.Background()))
	defer s.Stop()
	jl.AddLog(types.NewLogEntry("stdout", "kept-1", 0))
	jl.AddLog(types.NewLogEntry("stdout", "kept-2", 0))

	first := srv.waitLogMessage(t)
	second := srv.waitLogMessage(t)
	assert.Equal(t, "kept-1", first.Line)
	assert.EqualValues(t, 3, first.Sequence)
	assert.Equal(t, "kept-2", second.Line)
	assert.EqualValues(t, 4, second.Sequence)
	srv.requireNoMoreMessages(t)
}

func TestStreamer_StreamLogTrackedAndUntracked(t *testing.T) {
	srv := newWSTestServer(t)
	cfg := testWSLogConfig()
	cfg.BatchSize = 1 // tracked logs flush immediately
	s := newTestStreamer(t, cfg, srv.wsURL())
	require.NoError(t, s.Start(context.Background()))
	defer s.Stop()

	s.StartJob("tracked")

	// Tracked job: buffered path, sequence reassigned by the job logger.
	s.StreamLog("tracked", types.NewLogEntry("stdout", "via buffer", 99))
	msg := srv.waitLogMessage(t)
	assert.Equal(t, "tracked", msg.JobID)
	assert.EqualValues(t, 1, msg.Sequence, "tracked logs use the job logger's own sequence")

	// Untracked job: sent directly, original sequence preserved.
	s.StreamLog("untracked", types.NewLogEntry("stderr", "direct", 55))
	msg = srv.waitLogMessage(t)
	assert.Equal(t, "untracked", msg.JobID)
	assert.Equal(t, "direct", msg.Line)
	assert.EqualValues(t, 55, msg.Sequence, "untracked logs keep the caller's sequence")
}

func TestStreamer_StreamLogUntrackedWhileDisconnectedIsDropped(t *testing.T) {
	srv := newWSTestServer(t)
	s := newTestStreamer(t, testWSLogConfig(), srv.wsURL())
	// Never connected.

	s.StreamLog("untracked", types.NewLogEntry("stdout", "nobody home", 1))
	assert.Len(t, s.wsClient.send, 0, "untracked logs while disconnected are dropped, not queued")
}

func TestStreamer_StopFlushesBufferedTailAndDisconnects(t *testing.T) {
	srv := newWSTestServer(t)
	cfg := testWSLogConfig()
	cfg.BatchSize = 100 // keep everything buffered until Stop
	s := newTestStreamer(t, cfg, srv.wsURL())
	require.NoError(t, s.Start(context.Background()))

	jl := s.StartJob("job-1")
	jl.AddLog(types.NewLogEntry("stdout", "tail-1", 0))
	jl.AddLog(types.NewLogEntry("stdout", "tail-2", 0))
	require.Equal(t, 2, bufferLen(jl))

	stopErr := make(chan error, 1)
	go func() { stopErr <- s.Stop() }()
	select {
	case err := <-stopErr:
		require.NoError(t, err)
	case <-time.After(waitTimeout):
		t.Fatal("Streamer.Stop did not return (shutdown deadlock)")
	}

	// Regression: logs still buffered at Stop must be flushed, not dropped
	// (Stop used the interval-gated flush and lost the tail).
	first := srv.waitLogMessage(t)
	second := srv.waitLogMessage(t)
	assert.Equal(t, "tail-1", first.Line)
	assert.Equal(t, "tail-2", second.Line)
	assert.Equal(t, websocket.CloseNormalClosure, srv.waitClose(t))
	assert.False(t, s.wsClient.IsConnected())
}

func TestStreamer_StartConnectFailureRetriesInBackground(t *testing.T) {
	srv := newWSTestServer(t)
	srv.setRejecting(true)

	s := newTestStreamer(t, testWSLogConfig(), srv.wsURL())
	// Start swallows the initial connection failure and retries in background.
	require.NoError(t, s.Start(context.Background()))
	defer s.Stop()
	assert.False(t, s.wsClient.IsConnected())

	srv.setRejecting(false)
	waitCond(t, "streamer reconnected in background", s.wsClient.IsConnected)

	s.StreamLog("job-1", types.NewLogEntry("stdout", "recovered", 1))
	msg := srv.waitLogMessage(t)
	assert.Equal(t, "recovered", msg.Line)
}

func TestJobLogger_LogFromUpdate(t *testing.T) {
	s := newTestStreamer(t, testWSLogConfig(), "")
	jl := s.StartJob("job-1")

	// A log update with the right payload type is buffered.
	jl.LogFromUpdate(types.ExecutionUpdate{
		Type: types.UpdateTypeLog,
		Data: types.NewLogEntry("stdout", "hello", 1),
	})
	assert.Equal(t, 1, bufferLen(jl))

	// Non-log updates are ignored.
	jl.LogFromUpdate(types.ExecutionUpdate{
		Type: types.UpdateTypeStatus,
		Data: types.NewStatusUpdate(types.JobStatusRunning, "running"),
	})
	assert.Equal(t, 1, bufferLen(jl))

	// A log update with the wrong payload type is ignored.
	jl.LogFromUpdate(types.ExecutionUpdate{
		Type: types.UpdateTypeLog,
		Data: "not a log entry",
	})
	assert.Equal(t, 1, bufferLen(jl))
}

func TestJobLogger_FlushIfNeededHonorsInterval(t *testing.T) {
	cfg := testWSLogConfig()
	cfg.FlushInterval = time.Hour
	s := newTestStreamer(t, cfg, "")
	jl := s.StartJob("job-1")

	jl.AddLog(types.NewLogEntry("stdout", "young", 1))
	jl.FlushIfNeeded() // interval not elapsed: keeps buffering
	assert.Equal(t, 1, bufferLen(jl))

	jl.Flush() // forced flush always empties the buffer (drop path: no client)
	assert.Equal(t, 0, bufferLen(jl))

	// Flushing an empty buffer is a no-op.
	jl.Flush()
	assert.Equal(t, 0, bufferLen(jl))
}
