package ssh

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/retry"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

// ConnectionPool manages SSH connections
type ConnectionPool struct {
	config config.ConnectionPoolConfig
	log    *logrus.Logger

	mu          sync.RWMutex
	connections map[string]*poolEntry

	// Circuit breaker state
	breakers map[string]*CircuitBreaker
}

// poolEntry represents a pooled connection
type poolEntry struct {
	conn     *ssh.Client
	lastUsed time.Time
	inUse    bool
	healthy  bool
}

// NewConnectionPool creates a new connection pool
func NewConnectionPool(cfg config.ConnectionPoolConfig, log *logrus.Logger) *ConnectionPool {
	pool := &ConnectionPool{
		config:      cfg,
		log:         log,
		connections: make(map[string]*poolEntry),
		breakers:    make(map[string]*CircuitBreaker),
	}

	// Start health check routine
	go pool.healthCheckLoop()

	// Start cleanup routine
	go pool.cleanupLoop()

	return pool
}

// Get retrieves or creates a connection
func (p *ConnectionPool) Get(ctx context.Context, serverKey string, server *types.ServerDetails) (*ssh.Client, error) {
	// Check circuit breaker
	breaker := p.getOrCreateBreaker(serverKey)
	if !breaker.Allow() {
		return nil, fmt.Errorf("circuit breaker open for %s", serverKey)
	}

	// Try to get existing connection
	conn := p.getExistingConnection(serverKey)
	if conn != nil {
		return conn, nil
	}

	// Create new connection
	conn, err := p.createConnection(ctx, server)
	if err != nil {
		breaker.RecordFailure()
		return nil, err
	}

	breaker.RecordSuccess()

	// Add to pool
	p.addConnection(serverKey, conn)

	return conn, nil
}

// Put returns a connection to the pool
func (p *ConnectionPool) Put(serverKey string, conn *ssh.Client, healthy bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if entry, exists := p.connections[serverKey]; exists && entry.conn == conn {
		entry.inUse = false
		entry.lastUsed = time.Now()
		entry.healthy = healthy

		// If unhealthy, close and remove
		if !healthy {
			conn.Close()
			delete(p.connections, serverKey)
		}
	}
}

// getExistingConnection tries to get an existing healthy connection
func (p *ConnectionPool) getExistingConnection(serverKey string) *ssh.Client {
	p.mu.Lock()
	defer p.mu.Unlock()

	if entry, exists := p.connections[serverKey]; exists && !entry.inUse && entry.healthy {
		entry.inUse = true
		entry.lastUsed = time.Now()
		return entry.conn
	}

	return nil
}

// createConnection creates a new SSH connection
func (p *ConnectionPool) createConnection(ctx context.Context, server *types.ServerDetails) (*ssh.Client, error) {
	// Build auth methods based on available credentials
	var authMethods []ssh.AuthMethod

	// Try password authentication if password is provided
	if server.Password != "" {
		authMethods = append(authMethods, ssh.Password(server.Password))
	}

	// Try SSH key authentication if private key is provided
	if server.PrivateKey != "" {
		// Parse private key
		signer, err := ssh.ParsePrivateKey([]byte(server.PrivateKey))
		if err != nil {
			// Try with passphrase if provided
			if server.Passphrase != "" {
				signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(server.PrivateKey), []byte(server.Passphrase))
				if err != nil {
					// Log error but continue if password auth is available
					if server.Password == "" {
						return nil, fmt.Errorf("failed to parse private key: %w", err)
					}
					p.log.WithError(err).Warn("Failed to parse private key, falling back to password auth")
				} else {
					authMethods = append(authMethods, ssh.PublicKeys(signer))
				}
			} else if server.Password == "" {
				// No password and failed to parse key
				return nil, fmt.Errorf("failed to parse private key: %w", err)
			}
		} else {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	}

	// Ensure we have at least one auth method
	if len(authMethods) == 0 {
		return nil, fmt.Errorf("no authentication method available: neither password nor private key provided")
	}

	// SSH client configuration
	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         p.config.ConnectionTimeout,
	}

	// Create connection with context
	addr := fmt.Sprintf("%s:%d", server.Host, server.Port)

	// Configure retry for connection attempts
	retryCfg := retry.Config{
		MaxAttempts:  3,
		InitialDelay: 2 * time.Second,
		MaxDelay:     10 * time.Second,
		Multiplier:   2.0,
	}

	var conn *ssh.Client
	var err error
	logEntry := p.log.WithFields(logrus.Fields{
		"server": server.Name,
		"host":   server.Host,
		"port":   server.Port,
	})

	// Use retry utility for connection attempts
	err = retry.WithRetry(ctx, retryCfg, func() error {
		// Use a goroutine to handle context cancellation
		type result struct {
			conn *ssh.Client
			err  error
		}

		resChan := make(chan result, 1)
		go func() {
			c, e := ssh.Dial("tcp", addr, config)
			resChan <- result{c, e}
		}()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case res := <-resChan:
			if res.err != nil {
				// Create typed SSH error
				sshErr := errors.NewSSHError(
					"CONNECTION_FAILED",
					fmt.Sprintf("SSH connection failed to %s: %v", addr, res.err),
					"Connect",
				)
				sshErr.ServerID = server.ID
				sshErr.Retryable = true // SSH connections are retryable
				return sshErr
			}
			conn = res.conn
			return nil
		}
	}, logEntry)

	if err != nil {
		return nil, err
	}

	return conn, nil
}

// addConnection adds a connection to the pool
func (p *ConnectionPool) addConnection(serverKey string, conn *ssh.Client) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.connections[serverKey] = &poolEntry{
		conn:     conn,
		lastUsed: time.Now(),
		inUse:    true,
		healthy:  true,
	}
}

// getOrCreateBreaker gets or creates a circuit breaker for a server
func (p *ConnectionPool) getOrCreateBreaker(serverKey string) *CircuitBreaker {
	p.mu.Lock()
	defer p.mu.Unlock()

	if breaker, exists := p.breakers[serverKey]; exists {
		return breaker
	}

	breaker := NewCircuitBreaker(5, 2, 60*time.Second)
	p.breakers[serverKey] = breaker
	return breaker
}

// healthCheckLoop periodically checks connection health
func (p *ConnectionPool) healthCheckLoop() {
	ticker := time.NewTicker(p.config.HealthCheckInterval)
	defer ticker.Stop()

	for range ticker.C {
		p.checkAllConnections()
	}
}

// checkAllConnections checks health of all connections
func (p *ConnectionPool) checkAllConnections() {
	p.mu.Lock()
	// Get a snapshot of connections to check
	toCheck := make(map[string]*ssh.Client)
	for key, entry := range p.connections {
		if !entry.inUse && entry.healthy {
			toCheck[key] = entry.conn
		}
	}
	p.mu.Unlock()

	// Check each connection
	for key, conn := range toCheck {
		if !p.checkConnection(conn) {
			p.mu.Lock()
			if entry, exists := p.connections[key]; exists && entry.conn == conn {
				entry.healthy = false
				conn.Close()
				delete(p.connections, key)
			}
			p.mu.Unlock()
		}
	}
}

// checkConnection checks if a connection is still alive
func (p *ConnectionPool) checkConnection(conn *ssh.Client) bool {
	session, err := conn.NewSession()
	if err != nil {
		return false
	}
	session.Close()
	return true
}

// cleanupLoop periodically removes idle connections
func (p *ConnectionPool) cleanupLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		p.cleanupIdleConnections()
	}
}

// cleanupIdleConnections removes connections that have been idle too long
func (p *ConnectionPool) cleanupIdleConnections() {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	for key, entry := range p.connections {
		if !entry.inUse && now.Sub(entry.lastUsed) > p.config.IdleTimeout {
			entry.conn.Close()
			delete(p.connections, key)
			p.log.WithField("server", key).Debug("Closed idle SSH connection")
		}
	}
}

// Close closes all connections in the pool
func (p *ConnectionPool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, entry := range p.connections {
		entry.conn.Close()
	}
	p.connections = make(map[string]*poolEntry)
}
