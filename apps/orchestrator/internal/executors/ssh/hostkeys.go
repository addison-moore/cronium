package ssh

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// Host key policies. "accept-new" mirrors OpenSSH's StrictHostKeyChecking=accept-new:
// unknown hosts are recorded on first connection, but a changed key is always fatal.
const (
	HostKeyPolicyStrict    = "strict"
	HostKeyPolicyAcceptNew = "accept-new"
	HostKeyPolicyInsecure  = "insecure"
)

// HostKeyVerifier verifies SSH host keys against a known_hosts file
// according to the configured policy.
type HostKeyVerifier struct {
	policy string
	path   string
	log    *logrus.Logger

	// Serializes known_hosts reads/appends so concurrent connections
	// cannot race on first-seen hosts.
	mu sync.Mutex
}

// NewHostKeyVerifier creates a verifier from the SSH security config.
func NewHostKeyVerifier(cfg config.SSHSecurityConfig, log *logrus.Logger) *HostKeyVerifier {
	policy := cfg.HostKeyPolicy
	switch policy {
	case HostKeyPolicyStrict, HostKeyPolicyAcceptNew, HostKeyPolicyInsecure:
	default:
		if policy != "" {
			log.WithField("hostKeyPolicy", policy).Warn("Unknown host key policy, falling back to accept-new")
		}
		policy = HostKeyPolicyAcceptNew
	}

	// Legacy escape hatch: strictHostKeyChecking=false disables verification.
	if !cfg.StrictHostKeyChecking && policy != HostKeyPolicyInsecure {
		log.Warn("strictHostKeyChecking=false: SSH host key verification is DISABLED; connections are exposed to MITM")
		policy = HostKeyPolicyInsecure
	}

	return &HostKeyVerifier{
		policy: policy,
		path:   cfg.KnownHostsFile,
		log:    log,
	}
}

// Callback returns the ssh.HostKeyCallback implementing the policy.
func (v *HostKeyVerifier) Callback() ssh.HostKeyCallback {
	if v.policy == HostKeyPolicyInsecure {
		return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			v.log.WithField("host", hostname).Warn("Skipping SSH host key verification (insecure policy)")
			return nil
		}
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		v.mu.Lock()
		defer v.mu.Unlock()

		if err := v.ensureKnownHostsFile(); err != nil {
			return fmt.Errorf("failed to prepare known_hosts file %s: %w", v.path, err)
		}

		check, err := knownhosts.New(v.path)
		if err != nil {
			return fmt.Errorf("failed to load known_hosts file %s: %w", v.path, err)
		}

		err = check(hostname, remote, key)
		if err == nil {
			return nil
		}

		var keyErr *knownhosts.KeyError
		if !errors.As(err, &keyErr) {
			return err
		}

		if len(keyErr.Want) > 0 {
			// The host presented a key different from the recorded one.
			return fmt.Errorf(
				"host key mismatch for %s: the server's %s key does not match the entry in %s; "+
					"if the server was legitimately reinstalled, remove the stale entry and reconnect",
				hostname, key.Type(), v.path,
			)
		}

		// Unknown host.
		if v.policy == HostKeyPolicyStrict {
			return fmt.Errorf(
				"unknown host %s: no entry in %s (host key policy is strict; add the host key or use accept-new)",
				hostname, v.path,
			)
		}

		if err := v.appendHostKey(hostname, remote, key); err != nil {
			return fmt.Errorf("failed to record host key for %s: %w", hostname, err)
		}
		v.log.WithFields(logrus.Fields{
			"host":        hostname,
			"keyType":     key.Type(),
			"fingerprint": ssh.FingerprintSHA256(key),
		}).Info("Recorded new SSH host key (accept-new policy)")
		return nil
	}
}

// ensureKnownHostsFile creates the known_hosts file (and parent directory) if missing.
func (v *HostKeyVerifier) ensureKnownHostsFile() error {
	if _, err := os.Stat(v.path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(v.path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(v.path, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	return f.Close()
}

// appendHostKey records a host key in the known_hosts file.
func (v *HostKeyVerifier) appendHostKey(hostname string, remote net.Addr, key ssh.PublicKey) error {
	addresses := []string{knownhosts.Normalize(hostname)}
	if remote != nil {
		remoteAddr := knownhosts.Normalize(remote.String())
		if remoteAddr != addresses[0] {
			addresses = append(addresses, remoteAddr)
		}
	}

	f, err := os.OpenFile(v.path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := fmt.Fprintln(f, knownhosts.Line(addresses, key)); err != nil {
		return err
	}
	return f.Sync()
}
