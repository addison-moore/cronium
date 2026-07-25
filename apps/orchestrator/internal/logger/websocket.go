package logger

import (
	"context"
	"fmt"
	"net/url"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"
)

// WebSocketClient handles log streaming to the backend via WebSocket
type WebSocketClient struct {
	url       string
	token     string
	log       *logrus.Logger
	conn      *websocket.Conn
	mu        sync.RWMutex
	connected bool
	// initialReconnectDelay is what the backoff resets to after a successful
	// connection (1s in production; overridable in tests).
	initialReconnectDelay time.Duration
	reconnectDelay        time.Duration
	maxReconnectDelay     time.Duration

	// writerDone is closed when the current connection's write pump exits, so
	// Disconnect can wait for queued messages to be flushed before returning.
	writerDone chan struct{}

	// Channels
	send chan LogMessage
	done chan struct{}

	// Callbacks
	onConnect    func()
	onDisconnect func(error)
}

// LogMessage represents a log message to be sent
type LogMessage struct {
	JobID     string    `json:"jobId"`
	Timestamp time.Time `json:"timestamp"`
	Stream    string    `json:"stream"`
	Line      string    `json:"line"`
	Sequence  int64     `json:"sequence"`
}

// NewWebSocketClient creates a new WebSocket client
func NewWebSocketClient(wsURL, token string, log *logrus.Logger) *WebSocketClient {
	return &WebSocketClient{
		url:                   wsURL,
		token:                 token,
		log:                   log,
		initialReconnectDelay: time.Second,
		reconnectDelay:        time.Second,
		maxReconnectDelay:     30 * time.Second,
		send:                  make(chan LogMessage, 1000),
		done:                  make(chan struct{}),
	}
}

// Connect establishes the WebSocket connection
func (c *WebSocketClient) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.connected {
		return nil
	}

	// Parse URL and add auth token
	u, err := url.Parse(c.url)
	if err != nil {
		return fmt.Errorf("invalid WebSocket URL: %w", err)
	}

	// Add authentication
	header := make(map[string][]string)
	header["Authorization"] = []string{"Bearer " + c.token}

	// Connect with context
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, u.String(), header)
	if err != nil {
		return fmt.Errorf("failed to connect to WebSocket: %w", err)
	}

	c.conn = conn
	c.connected = true
	c.reconnectDelay = c.initialReconnectDelay // Reset delay on successful connection

	// Call connect callback
	if c.onConnect != nil {
		c.onConnect()
	}

	// Start read and write pumps. Each pump owns this specific connection:
	// connClosed tears the writer down as soon as the reader observes the
	// connection dying, so a stale pump can never close a newer connection or
	// steal messages meant for it.
	connClosed := make(chan struct{})
	writerDone := make(chan struct{})
	c.writerDone = writerDone
	go c.readPump(conn, connClosed)
	go c.writePump(conn, connClosed, writerDone)

	c.log.Info("WebSocket connected for log streaming")
	return nil
}

// Disconnect closes the WebSocket connection
func (c *WebSocketClient) Disconnect() error {
	c.mu.Lock()
	if !c.connected {
		c.mu.Unlock()
		return nil
	}

	c.connected = false
	conn := c.conn
	writerDone := c.writerDone
	close(c.done)
	c.mu.Unlock()

	// Wait for the write pump to flush queued messages and send the close
	// frame (bounded, so shutdown can never hang on a stuck peer). The write
	// pump owns all writes to the connection — writing the close frame here
	// would race its in-flight WriteJSON calls.
	if writerDone != nil {
		select {
		case <-writerDone:
		case <-time.After(5 * time.Second):
			c.log.Warn("Timed out waiting for log flush during disconnect")
		}
	}

	if conn != nil {
		conn.Close()
	}

	c.log.Info("WebSocket disconnected")
	return nil
}

// SendLog sends a log message
func (c *WebSocketClient) SendLog(jobID string, logEntry *types.LogEntry) {
	msg := LogMessage{
		JobID:     jobID,
		Timestamp: logEntry.Timestamp,
		Stream:    logEntry.Stream,
		Line:      logEntry.Line,
		Sequence:  logEntry.Sequence,
	}

	select {
	case c.send <- msg:
	default:
		c.log.Warn("Log message dropped, send buffer full")
	}
}

// IsConnected returns the connection status
func (c *WebSocketClient) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// SetCallbacks sets connection callbacks
func (c *WebSocketClient) SetCallbacks(onConnect func(), onDisconnect func(error)) {
	c.onConnect = onConnect
	c.onDisconnect = onDisconnect
}

// readPump handles incoming messages for one connection.
func (c *WebSocketClient) readPump(conn *websocket.Conn, connClosed chan struct{}) {
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.log.WithError(err).Error("WebSocket read error")
			}
			// Mark this connection dead and stop its writer BEFORE notifying,
			// so a reconnect triggered by the callback never observes stale
			// "connected" state, and the old writer cannot consume messages
			// meant for the next connection.
			c.mu.Lock()
			if c.conn == conn {
				c.connected = false
			}
			c.mu.Unlock()
			close(connClosed)
			if c.onDisconnect != nil {
				c.onDisconnect(err)
			}
			return
		}

		// Handle control messages from server if needed
		c.log.WithField("message", string(message)).Debug("Received WebSocket message")
	}
}

// writePump handles outgoing messages for one connection.
func (c *WebSocketClient) writePump(conn *websocket.Conn, connClosed <-chan struct{}, writerDone chan<- struct{}) {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		conn.Close()
		close(writerDone)
	}()

	for {
		select {
		case message, ok := <-c.send:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Send as JSON
			if err := conn.WriteJSON(message); err != nil {
				c.log.WithError(err).Error("Failed to send log message")
				return
			}

			// Send any buffered messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				msg := <-c.send
				if err := conn.WriteJSON(msg); err != nil {
					c.log.WithError(err).Error("Failed to send buffered log message")
					return
				}
			}

		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-connClosed:
			// The read pump observed this connection dying; a reconnect may
			// already be under way. Stop consuming from the shared send
			// channel so queued messages are delivered by the next connection.
			return

		case <-c.done:
			// Client shutdown: flush whatever is queued, then close cleanly so
			// the tail of a job's logs is not dropped.
			c.drainAndClose(conn)
			return
		}
	}
}

// drainAndClose writes all queued messages, then a normal close frame.
func (c *WebSocketClient) drainAndClose(conn *websocket.Conn) {
	for {
		select {
		case msg := <-c.send:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(msg); err != nil {
				c.log.WithError(err).Error("Failed to flush log message during shutdown")
				return
			}
		default:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			return
		}
	}
}

// Reconnect attempts to reconnect with exponential backoff
func (c *WebSocketClient) Reconnect(ctx context.Context) {
	for {
		c.mu.RLock()
		delay := c.reconnectDelay
		c.mu.RUnlock()

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
			c.log.Info("Attempting to reconnect WebSocket")

			if err := c.Connect(ctx); err != nil {
				c.log.WithError(err).Warn("Failed to reconnect WebSocket")

				// Exponential backoff
				c.mu.Lock()
				c.reconnectDelay *= 2
				if c.reconnectDelay > c.maxReconnectDelay {
					c.reconnectDelay = c.maxReconnectDelay
				}
				c.mu.Unlock()
			} else {
				return // Successfully reconnected
			}
		}
	}
}
