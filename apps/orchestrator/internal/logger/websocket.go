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
	url               string
	token             string
	log               *logrus.Logger
	conn              *websocket.Conn
	mu                sync.RWMutex
	connected         bool
	reconnectDelay    time.Duration
	maxReconnectDelay time.Duration

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
		url:               wsURL,
		token:             token,
		log:               log,
		reconnectDelay:    time.Second,
		maxReconnectDelay: 30 * time.Second,
		send:              make(chan LogMessage, 1000),
		done:              make(chan struct{}),
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
	c.reconnectDelay = time.Second // Reset delay on successful connection

	// Call connect callback
	if c.onConnect != nil {
		c.onConnect()
	}

	// Start read and write pumps
	go c.readPump()
	go c.writePump()

	c.log.Info("WebSocket connected for log streaming")
	return nil
}

// Disconnect closes the WebSocket connection
func (c *WebSocketClient) Disconnect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected {
		return nil
	}

	c.connected = false
	close(c.done)

	// Send close message
	if c.conn != nil {
		c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		c.conn.Close()
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

// readPump handles incoming messages
func (c *WebSocketClient) readPump() {
	defer func() {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.log.WithError(err).Error("WebSocket read error")
			}
			if c.onDisconnect != nil {
				c.onDisconnect(err)
			}
			return
		}

		// Handle control messages from server if needed
		c.log.WithField("message", string(message)).Debug("Received WebSocket message")
	}
}

// writePump handles outgoing messages
func (c *WebSocketClient) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Send as JSON
			if err := c.conn.WriteJSON(message); err != nil {
				c.log.WithError(err).Error("Failed to send log message")
				return
			}

			// Send any buffered messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				msg := <-c.send
				if err := c.conn.WriteJSON(msg); err != nil {
					c.log.WithError(err).Error("Failed to send buffered log message")
					return
				}
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-c.done:
			return
		}
	}
}

// Reconnect attempts to reconnect with exponential backoff
func (c *WebSocketClient) Reconnect(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(c.reconnectDelay):
			c.log.Info("Attempting to reconnect WebSocket")

			if err := c.Connect(ctx); err != nil {
				c.log.WithError(err).Warn("Failed to reconnect WebSocket")

				// Exponential backoff
				c.reconnectDelay *= 2
				if c.reconnectDelay > c.maxReconnectDelay {
					c.reconnectDelay = c.maxReconnectDelay
				}
			} else {
				return // Successfully reconnected
			}
		}
	}
}
