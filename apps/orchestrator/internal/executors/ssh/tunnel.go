package ssh

import (
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"

	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

// TunnelManager manages SSH reverse tunnels for runtime API access
type TunnelManager struct {
	log        *logrus.Logger
	localHost  string
	localPort  int
	remotePort int
	listener   net.Listener
	wg         sync.WaitGroup
	stopCh     chan struct{}
}

// NewTunnelManager creates a new tunnel manager
func NewTunnelManager(localHost string, localPort, remotePort int, log *logrus.Logger) *TunnelManager {
	return &TunnelManager{
		log:        log,
		localHost:  localHost,
		localPort:  localPort,
		remotePort: remotePort,
		stopCh:     make(chan struct{}),
	}
}

// Start starts the reverse tunnel
func (tm *TunnelManager) Start(sshClient *ssh.Client) error {
	// Listen on remote port
	listener, err := sshClient.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", tm.remotePort))
	if err != nil {
		return fmt.Errorf("failed to listen on remote port %d: %w", tm.remotePort, err)
	}
	tm.listener = listener

	tm.log.WithFields(logrus.Fields{
		"localPort":  tm.localPort,
		"remotePort": tm.remotePort,
	}).Info("SSH reverse tunnel established")

	// Start accepting connections
	tm.wg.Add(1)
	go tm.acceptConnections()

	return nil
}

// Stop stops the reverse tunnel
func (tm *TunnelManager) Stop() {
	tm.log.Info("Stopping SSH reverse tunnel")

	close(tm.stopCh)

	if tm.listener != nil {
		tm.listener.Close()
	}

	tm.wg.Wait()

	tm.log.Info("SSH reverse tunnel stopped")
}

// acceptConnections accepts incoming connections from the remote side
func (tm *TunnelManager) acceptConnections() {
	defer tm.wg.Done()

	for {
		select {
		case <-tm.stopCh:
			return
		default:
			// Accept connection from remote
			remoteConn, err := tm.listener.Accept()
			if err != nil {
				select {
				case <-tm.stopCh:
					return
				default:
					tm.log.WithError(err).Warn("Failed to accept connection")
					continue
				}
			}

			// Handle connection in goroutine
			tm.wg.Add(1)
			go tm.handleConnection(remoteConn)
		}
	}
}

// handleConnection handles a single tunneled connection
func (tm *TunnelManager) handleConnection(remoteConn net.Conn) {
	defer tm.wg.Done()
	defer remoteConn.Close()

	// Connect to local service
	localConn, err := net.Dial("tcp", net.JoinHostPort(tm.localHost, strconv.Itoa(tm.localPort)))
	if err != nil {
		tm.log.WithError(err).Error("Failed to connect to local service")
		return
	}
	defer localConn.Close()

	// Copy data in both directions. When one direction ends (its source EOFs),
	// half-close the destination's write side so the peer sees EOF, then wait for
	// the OTHER direction to drain before returning (the defers close both). This
	// avoids truncating an in-flight HTTP response — the previous code returned on
	// the first copy finishing and hard-closed both sides, which the runner's HTTP
	// client would see as an EOF mid-response.
	done := make(chan struct{}, 2)
	pipe := func(dst, src net.Conn) {
		_, err := io.Copy(dst, src)
		if err != nil && err != io.EOF {
			tm.log.WithError(err).Debug("Tunnel copy ended with error")
		}
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
		done <- struct{}{}
	}

	go pipe(localConn, remoteConn)
	go pipe(remoteConn, localConn)

	for i := 0; i < 2; i++ {
		select {
		case <-done:
		case <-tm.stopCh:
			tm.log.Debug("Tunnel connection closed due to shutdown")
			return
		}
	}
}

// GetRemoteEndpoint returns the endpoint URL for the remote side
func (tm *TunnelManager) GetRemoteEndpoint() string {
	return fmt.Sprintf("http://127.0.0.1:%d", tm.remotePort)
}
