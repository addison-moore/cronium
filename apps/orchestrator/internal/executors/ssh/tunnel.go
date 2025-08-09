package ssh

import (
	"fmt"
	"io"
	"net"
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
	localConn, err := net.Dial("tcp", fmt.Sprintf("%s:%d", tm.localHost, tm.localPort))
	if err != nil {
		tm.log.WithError(err).Error("Failed to connect to local service")
		return
	}
	defer localConn.Close()

	// Copy data in both directions
	errCh := make(chan error, 2)

	go func() {
		_, err := io.Copy(localConn, remoteConn)
		errCh <- err
	}()

	go func() {
		_, err := io.Copy(remoteConn, localConn)
		errCh <- err
	}()

	// Wait for either direction to finish
	select {
	case err := <-errCh:
		if err != nil && err != io.EOF {
			tm.log.WithError(err).Debug("Tunnel connection closed with error")
		}
	case <-tm.stopCh:
		tm.log.Debug("Tunnel connection closed due to shutdown")
	}
}

// GetRemoteEndpoint returns the endpoint URL for the remote side
func (tm *TunnelManager) GetRemoteEndpoint() string {
	return fmt.Sprintf("http://127.0.0.1:%d", tm.remotePort)
}