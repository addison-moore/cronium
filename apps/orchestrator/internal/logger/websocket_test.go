package logger

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const waitTimeout = 5 * time.Second

// wsTestServer is an in-process WebSocket endpoint that records everything the
// client sends. It can reject upgrades (simulating an outage while keeping the
// URL stable) and kill live connections (simulating a dropped link).
type wsTestServer struct {
	t        *testing.T
	srv      *httptest.Server
	upgrader websocket.Upgrader

	mu        sync.Mutex
	rejecting bool
	conns     []*websocket.Conn

	dials  atomic.Int64
	msgs   chan []byte
	closes chan int
	auths  chan string
	connCh chan *websocket.Conn
}

func newWSTestServer(t *testing.T) *wsTestServer {
	s := &wsTestServer{
		t:      t,
		msgs:   make(chan []byte, 4096),
		closes: make(chan int, 16),
		auths:  make(chan string, 16),
		connCh: make(chan *websocket.Conn, 16),
	}
	s.upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	s.srv = httptest.NewServer(http.HandlerFunc(s.handle))
	t.Cleanup(s.close)
	return s
}

func (s *wsTestServer) handle(w http.ResponseWriter, r *http.Request) {
	s.dials.Add(1)
	s.mu.Lock()
	rejecting := s.rejecting
	s.mu.Unlock()
	if rejecting {
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	select {
	case s.auths <- r.Header.Get("Authorization"):
	default:
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.mu.Lock()
	s.conns = append(s.conns, conn)
	s.mu.Unlock()
	select {
	case s.connCh <- conn:
	default:
	}

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			var ce *websocket.CloseError
			if errors.As(err, &ce) {
				select {
				case s.closes <- ce.Code:
				default:
				}
			}
			return
		}
		select {
		case s.msgs <- data:
		default:
		}
	}
}

func (s *wsTestServer) wsURL() string {
	return "ws" + strings.TrimPrefix(s.srv.URL, "http")
}

func (s *wsTestServer) setRejecting(v bool) {
	s.mu.Lock()
	s.rejecting = v
	s.mu.Unlock()
}

// killConnections closes every live server-side connection.
func (s *wsTestServer) killConnections() {
	s.mu.Lock()
	conns := s.conns
	s.conns = nil
	s.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
}

func (s *wsTestServer) close() {
	s.killConnections()
	s.srv.Close()
}

func (s *wsTestServer) waitRawMessage(t *testing.T) []byte {
	t.Helper()
	select {
	case m := <-s.msgs:
		return m
	case <-time.After(waitTimeout):
		t.Fatal("timed out waiting for a message at the server")
		return nil
	}
}

func (s *wsTestServer) waitLogMessage(t *testing.T) LogMessage {
	t.Helper()
	var msg LogMessage
	require.NoError(t, json.Unmarshal(s.waitRawMessage(t), &msg))
	return msg
}

func (s *wsTestServer) waitClose(t *testing.T) int {
	t.Helper()
	select {
	case code := <-s.closes:
		return code
	case <-time.After(waitTimeout):
		t.Fatal("timed out waiting for a close frame at the server")
		return 0
	}
}

// requireNoMoreMessages asserts the server's message queue is empty right now.
func (s *wsTestServer) requireNoMoreMessages(t *testing.T) {
	t.Helper()
	select {
	case m := <-s.msgs:
		t.Fatalf("unexpected extra message at server: %s", m)
	default:
	}
}

func waitCond(t *testing.T, desc string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(waitTimeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("condition not met within %s: %s", waitTimeout, desc)
}

func waitSignal(t *testing.T, ch <-chan struct{}, desc string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(waitTimeout):
		t.Fatalf("timed out waiting for %s", desc)
	}
}

func newTestClient(t *testing.T, url string) (*WebSocketClient, *test.Hook) {
	t.Helper()
	log, hook := test.NewNullLogger()
	log.SetLevel(logrus.DebugLevel)
	c := NewWebSocketClient(url, "test-token", log)
	// Keep reconnection fast in tests; production defaults stay 1s/30s.
	c.initialReconnectDelay = 5 * time.Millisecond
	c.reconnectDelay = 5 * time.Millisecond
	c.maxReconnectDelay = 40 * time.Millisecond
	return c, hook
}

func logEntry(line string, seq int64) *types.LogEntry {
	return &types.LogEntry{
		Stream:    "stdout",
		Line:      line,
		Timestamp: time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC),
		Sequence:  seq,
	}
}

func TestWebSocketClient_ConnectSendsBearerTokenAndPinnedEnvelope(t *testing.T) {
	srv := newWSTestServer(t)
	client, _ := newTestClient(t, srv.wsURL())
	defer client.Disconnect()

	connected := make(chan struct{}, 1)
	client.SetCallbacks(func() { connected <- struct{}{} }, nil)

	require.NoError(t, client.Connect(context.Background()))
	waitSignal(t, connected, "onConnect callback")
	require.True(t, client.IsConnected())

	// Authentication header is a bearer token.
	select {
	case auth := <-srv.auths:
		assert.Equal(t, "Bearer test-token", auth)
	case <-time.After(waitTimeout):
		t.Fatal("server never saw the handshake")
	}

	// Connecting again while connected is a no-op.
	require.NoError(t, client.Connect(context.Background()))
	assert.EqualValues(t, 1, srv.dials.Load())

	client.SendLog("job-42", logEntry("hello world", 7))

	// Pin the exact wire envelope: a flat JSON object with exactly these keys.
	raw := srv.waitRawMessage(t)
	var fields map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &fields))
	for _, key := range []string{"jobId", "timestamp", "stream", "line", "sequence"} {
		assert.Contains(t, fields, key)
	}
	assert.Len(t, fields, 5, "wire envelope gained/lost a field: %s", raw)

	var msg LogMessage
	require.NoError(t, json.Unmarshal(raw, &msg))
	assert.Equal(t, "job-42", msg.JobID)
	assert.Equal(t, "stdout", msg.Stream)
	assert.Equal(t, "hello world", msg.Line)
	assert.EqualValues(t, 7, msg.Sequence)
	assert.True(t, msg.Timestamp.Equal(time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)))
}

func TestWebSocketClient_MessagesArriveInOrder(t *testing.T) {
	srv := newWSTestServer(t)
	client, _ := newTestClient(t, srv.wsURL())
	defer client.Disconnect()

	require.NoError(t, client.Connect(context.Background()))

	const n = 100
	for i := 1; i <= n; i++ {
		client.SendLog("job-1", logEntry("line", int64(i)))
	}
	for i := 1; i <= n; i++ {
		msg := srv.waitLogMessage(t)
		require.EqualValues(t, i, msg.Sequence, "messages must arrive in send order")
	}
}

func TestWebSocketClient_QueuedWhileDisconnectedDeliveredOnConnect(t *testing.T) {
	srv := newWSTestServer(t)
	client, _ := newTestClient(t, srv.wsURL())
	defer client.Disconnect()

	// SendLog before any connection: messages are buffered in the send channel.
	for i := 1; i <= 3; i++ {
		client.SendLog("job-1", logEntry("buffered", int64(i)))
	}
	require.False(t, client.IsConnected())
	require.Len(t, client.send, 3)

	require.NoError(t, client.Connect(context.Background()))
	for i := 1; i <= 3; i++ {
		msg := srv.waitLogMessage(t)
		assert.EqualValues(t, i, msg.Sequence)
		assert.Equal(t, "buffered", msg.Line)
	}
}

func TestWebSocketClient_SendBufferFullDropsMessage(t *testing.T) {
	client, hook := newTestClient(t, "ws://127.0.0.1:1/logs")
	client.send = make(chan LogMessage, 2) // shrink the buffer for the test

	client.SendLog("job-1", logEntry("a", 1))
	client.SendLog("job-1", logEntry("b", 2))
	client.SendLog("job-1", logEntry("c", 3)) // buffer full: dropped, not blocked

	require.Len(t, client.send, 2)
	first := <-client.send
	second := <-client.send
	assert.Equal(t, "a", first.Line)
	assert.Equal(t, "b", second.Line)

	dropped := false
	for _, e := range hook.AllEntries() {
		if strings.Contains(e.Message, "Log message dropped") {
			dropped = true
		}
	}
	assert.True(t, dropped, "expected a dropped-message warning")
}

func TestWebSocketClient_ConnectErrors(t *testing.T) {
	log, _ := test.NewNullLogger()

	// Invalid URL.
	bad := NewWebSocketClient("://not-a-url", "tok", log)
	require.ErrorContains(t, bad.Connect(context.Background()), "invalid WebSocket URL")
	assert.False(t, bad.IsConnected())

	// Unreachable endpoint.
	refused := NewWebSocketClient("ws://127.0.0.1:1/logs", "tok", log)
	require.ErrorContains(t, refused.Connect(context.Background()), "failed to connect to WebSocket")
	assert.False(t, refused.IsConnected())

	// Server refusing the upgrade.
	srv := newWSTestServer(t)
	srv.setRejecting(true)
	rejected, _ := newTestClient(t, srv.wsURL())
	require.Error(t, rejected.Connect(context.Background()))
	assert.False(t, rejected.IsConnected())
}

func TestWebSocketClient_ServerDropTriggersOnDisconnect(t *testing.T) {
	srv := newWSTestServer(t)
	client, _ := newTestClient(t, srv.wsURL())

	disconnected := make(chan error, 4)
	client.SetCallbacks(nil, func(err error) { disconnected <- err })

	require.NoError(t, client.Connect(context.Background()))
	srv.killConnections()

	select {
	case err := <-disconnected:
		require.Error(t, err)
	case <-time.After(waitTimeout):
		t.Fatal("onDisconnect was never called")
	}
	// The client marks itself disconnected before firing the callback.
	assert.False(t, client.IsConnected())
}

func TestWebSocketClient_ReconnectWithBackoffResumesStreaming(t *testing.T) {
	srv := newWSTestServer(t)
	client, _ := newTestClient(t, srv.wsURL())
	defer client.Disconnect()

	disconnected := make(chan error, 4)
	client.SetCallbacks(nil, func(err error) { disconnected <- err })

	require.NoError(t, client.Connect(context.Background()))
	dialsAfterConnect := srv.dials.Load()

	// Take the server "down": reject new upgrades, kill the live connection.
	srv.setRejecting(true)
	srv.killConnections()
	select {
	case <-disconnected:
	case <-time.After(waitTimeout):
		t.Fatal("client never noticed the drop")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go client.Reconnect(ctx)

	// The client must keep retrying (with backoff) while the server is down.
	waitCond(t, "at least 3 failed reconnect attempts", func() bool {
		return srv.dials.Load() >= dialsAfterConnect+3
	})
	assert.False(t, client.IsConnected())

	// Server comes back: the client reconnects and streaming resumes.
	srv.setRejecting(false)
	waitCond(t, "client reconnected", client.IsConnected)

	// Backoff delay is reset after a successful connection.
	client.mu.RLock()
	delay := client.reconnectDelay
	client.mu.RUnlock()
	assert.Equal(t, client.initialReconnectDelay, delay)

	client.SendLog("job-9", logEntry("after reconnect", 1))
	msg := srv.waitLogMessage(t)
	assert.Equal(t, "job-9", msg.JobID)
	assert.Equal(t, "after reconnect", msg.Line)
}

func TestWebSocketClient_ReconnectBackoffGrowsAndCaps(t *testing.T) {
	srv := newWSTestServer(t)
	srv.setRejecting(true) // never comes back

	client, _ := newTestClient(t, srv.wsURL())
	client.reconnectDelay = time.Millisecond
	client.maxReconnectDelay = 8 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		client.Reconnect(ctx)
		close(done)
	}()

	waitCond(t, "at least 5 reconnect attempts", func() bool {
		return srv.dials.Load() >= 5
	})
	cancel()
	waitSignal(t, done, "Reconnect to return after context cancel")

	// After >= 4 failures the doubling backoff must sit exactly at the cap.
	assert.Equal(t, 8*time.Millisecond, client.reconnectDelay)
	assert.False(t, client.IsConnected())
}

func TestWebSocketClient_DisconnectFlushesQueuedLogsAndSendsClose(t *testing.T) {
	srv := newWSTestServer(t)
	client, _ := newTestClient(t, srv.wsURL())

	require.NoError(t, client.Connect(context.Background()))

	// Queue a burst and immediately disconnect: everything queued at shutdown
	// must still reach the server, followed by a normal close frame.
	const n = 10
	for i := 1; i <= n; i++ {
		client.SendLog("job-1", logEntry("tail", int64(i)))
	}
	require.NoError(t, client.Disconnect())

	for i := 1; i <= n; i++ {
		msg := srv.waitLogMessage(t)
		require.EqualValues(t, i, msg.Sequence, "shutdown must not drop or reorder the log tail")
	}
	assert.Equal(t, websocket.CloseNormalClosure, srv.waitClose(t))

	// Disconnecting again is a no-op.
	require.NoError(t, client.Disconnect())
}

func TestWebSocketClient_ReadPumpHandlesServerMessages(t *testing.T) {
	srv := newWSTestServer(t)
	client, hook := newTestClient(t, srv.wsURL())
	defer client.Disconnect()

	require.NoError(t, client.Connect(context.Background()))

	var serverConn *websocket.Conn
	select {
	case serverConn = <-srv.connCh:
	case <-time.After(waitTimeout):
		t.Fatal("server connection not recorded")
	}

	require.NoError(t, serverConn.WriteMessage(websocket.TextMessage, []byte("control-ping")))
	waitCond(t, "client logged the inbound message", func() bool {
		for _, e := range hook.AllEntries() {
			if e.Message == "Received WebSocket message" && e.Data["message"] == "control-ping" {
				return true
			}
		}
		return false
	})
}

func TestWebSocketClient_NoGoroutineLeakAfterDisconnect(t *testing.T) {
	srv := newWSTestServer(t)
	baseline := runtime.NumGoroutine()

	client, _ := newTestClient(t, srv.wsURL())
	require.NoError(t, client.Connect(context.Background()))
	client.SendLog("job-1", logEntry("x", 1))
	srv.waitLogMessage(t)
	require.NoError(t, client.Disconnect())

	// Both pumps must terminate once the client is stopped.
	waitCond(t, "goroutines return to baseline", func() bool {
		return runtime.NumGoroutine() <= baseline
	})
}
