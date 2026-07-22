package ssh

import (
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"golang.org/x/crypto/ssh"
)

func hasAlgo(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestApplyAlgorithmPolicy_HardenedByDefault(t *testing.T) {
	cfg := &ssh.ClientConfig{}
	applyAlgorithmPolicy(cfg, config.SSHSecurityConfig{})

	// SHA-1 MACs and CBC ciphers must not be offered.
	if hasAlgo(cfg.MACs, "hmac-sha1") {
		t.Fatal("hmac-sha1 must not be in the hardened MAC list")
	}
	for _, c := range cfg.Ciphers {
		if c == "aes128-cbc" || c == "aes256-cbc" || c == "3des-cbc" {
			t.Fatalf("CBC cipher %q must not be in the hardened cipher list", c)
		}
	}
	// SHA-1 key exchanges must not be offered.
	if hasAlgo(cfg.KeyExchanges, "diffie-hellman-group1-sha1") ||
		hasAlgo(cfg.KeyExchanges, "diffie-hellman-group14-sha1") {
		t.Fatal("SHA-1 KEX must not be in the hardened list")
	}
	// Strong algorithms are present.
	if !hasAlgo(cfg.Ciphers, "chacha20-poly1305@openssh.com") {
		t.Fatal("expected a modern AEAD cipher")
	}
}

func TestApplyAlgorithmPolicy_LegacyOptOut(t *testing.T) {
	cfg := &ssh.ClientConfig{}
	applyAlgorithmPolicy(cfg, config.SSHSecurityConfig{AllowLegacyAlgorithms: true})
	// Left to Go defaults — no explicit restriction applied.
	if cfg.Ciphers != nil || cfg.KeyExchanges != nil || cfg.MACs != nil {
		t.Fatal("AllowLegacyAlgorithms should leave algorithms to Go defaults")
	}
}

func TestApplyAlgorithmPolicy_ConfigOverride(t *testing.T) {
	cfg := &ssh.ClientConfig{}
	applyAlgorithmPolicy(cfg, config.SSHSecurityConfig{
		AllowedCiphers: []string{"aes256-gcm@openssh.com"},
	})
	if len(cfg.Ciphers) != 1 || cfg.Ciphers[0] != "aes256-gcm@openssh.com" {
		t.Fatalf("operator cipher override not honored: %v", cfg.Ciphers)
	}
}
