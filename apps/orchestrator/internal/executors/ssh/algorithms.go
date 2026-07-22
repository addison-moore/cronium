package ssh

import (
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"golang.org/x/crypto/ssh"
)

// Hardened SSH algorithm allowlists (Phase 3.3). These exclude SHA-1 KEX and
// MACs and CBC ciphers. An operator can override any list via config, or disable
// the allowlist entirely with AllowLegacyAlgorithms.
//
// Host-key algorithms are intentionally NOT force-restricted here: pinning a
// preference (e.g. ed25519-first) re-selects a different key type than the one
// already recorded in known_hosts and would report a spurious host-key mismatch
// on upgrade for every existing server. Excluding ssh-rsa (SHA-1) host keys
// safely requires deriving the acceptable set from the known_hosts entry per
// host (knownhosts.HostKeyAlgorithms) — a follow-up. The transport-level
// hardening below (KEX/cipher/MAC) is where the real SHA-1/CBC weaknesses live.
var (
	hardenedKeyExchanges = []string{
		"curve25519-sha256",
		"curve25519-sha256@libssh.org",
		"ecdh-sha2-nistp256",
		"ecdh-sha2-nistp384",
		"ecdh-sha2-nistp521",
		"diffie-hellman-group14-sha256",
	}
	hardenedCiphers = []string{
		"chacha20-poly1305@openssh.com",
		"aes256-gcm@openssh.com",
		"aes128-gcm@openssh.com",
		"aes256-ctr",
		"aes192-ctr",
		"aes128-ctr",
	}
	hardenedMACs = []string{
		"hmac-sha2-256-etm@openssh.com",
		"hmac-sha2-512-etm@openssh.com",
		"hmac-sha2-256",
		"hmac-sha2-512",
	}
)

// applyHostKeyAlgorithms sets the allowed host-key algorithms on a ClientConfig
// unless legacy algorithms are permitted.
func applyAlgorithmPolicy(cfg *ssh.ClientConfig, sec config.SSHSecurityConfig) {
	if sec.AllowLegacyAlgorithms {
		return // fall back to Go crypto/ssh defaults
	}
	cfg.Ciphers = pick(sec.AllowedCiphers, hardenedCiphers)
	cfg.KeyExchanges = pick(sec.AllowedKeyExchanges, hardenedKeyExchanges)
	cfg.MACs = pick(sec.AllowedMACs, hardenedMACs)
}

func pick(override, fallback []string) []string {
	if len(override) > 0 {
		return override
	}
	return fallback
}
