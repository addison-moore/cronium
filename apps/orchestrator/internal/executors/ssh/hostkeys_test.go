package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/sirupsen/logrus"
	"golang.org/x/crypto/ssh"
)

func generateHostKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("failed to convert key: %v", err)
	}
	return sshPub
}

func newTestVerifier(t *testing.T, policy string) (*HostKeyVerifier, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "known_hosts")
	cfg := config.SSHSecurityConfig{
		StrictHostKeyChecking: true,
		HostKeyPolicy:         policy,
		KnownHostsFile:        path,
	}
	log := logrus.New()
	log.SetOutput(os.Stderr)
	return NewHostKeyVerifier(cfg, log), path
}

func testAddr(t *testing.T) net.Addr {
	t.Helper()
	addr, err := net.ResolveTCPAddr("tcp", "192.0.2.10:22")
	if err != nil {
		t.Fatalf("failed to resolve addr: %v", err)
	}
	return addr
}

func TestAcceptNewRecordsAndAccepts(t *testing.T) {
	verifier, path := newTestVerifier(t, HostKeyPolicyAcceptNew)
	callback := verifier.Callback()
	key := generateHostKey(t)
	addr := testAddr(t)

	// First connection: unknown host is recorded and accepted.
	if err := callback("example.com:22", addr, key); err != nil {
		t.Fatalf("expected first connection to be accepted, got: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read known_hosts: %v", err)
	}
	if !strings.Contains(string(data), "example.com") {
		t.Fatalf("expected known_hosts to contain example.com, got: %q", string(data))
	}

	// Second connection with the same key succeeds.
	if err := callback("example.com:22", addr, key); err != nil {
		t.Fatalf("expected repeat connection to be accepted, got: %v", err)
	}
}

func TestAcceptNewRejectsChangedKey(t *testing.T) {
	verifier, _ := newTestVerifier(t, HostKeyPolicyAcceptNew)
	callback := verifier.Callback()
	addr := testAddr(t)

	if err := callback("example.com:22", addr, generateHostKey(t)); err != nil {
		t.Fatalf("expected first connection to be accepted, got: %v", err)
	}

	// Same host presents a different key: must be rejected.
	err := callback("example.com:22", addr, generateHostKey(t))
	if err == nil {
		t.Fatal("expected changed host key to be rejected")
	}
	if !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("expected mismatch error, got: %v", err)
	}
}

func TestStrictRejectsUnknownHost(t *testing.T) {
	verifier, _ := newTestVerifier(t, HostKeyPolicyStrict)
	callback := verifier.Callback()

	err := callback("example.com:22", testAddr(t), generateHostKey(t))
	if err == nil {
		t.Fatal("expected unknown host to be rejected under strict policy")
	}
	if !strings.Contains(err.Error(), "unknown host") {
		t.Fatalf("expected unknown host error, got: %v", err)
	}
}

func TestStrictAcceptsKnownHost(t *testing.T) {
	acceptNew, path := newTestVerifier(t, HostKeyPolicyAcceptNew)
	key := generateHostKey(t)
	addr := testAddr(t)
	if err := acceptNew.Callback()("example.com:22", addr, key); err != nil {
		t.Fatalf("failed to record host key: %v", err)
	}

	strict := &HostKeyVerifier{
		policy: HostKeyPolicyStrict,
		path:   path,
		log:    logrus.New(),
	}
	if err := strict.Callback()("example.com:22", addr, key); err != nil {
		t.Fatalf("expected known host to be accepted under strict policy, got: %v", err)
	}
}

func TestInsecureAcceptsAnything(t *testing.T) {
	verifier, _ := newTestVerifier(t, HostKeyPolicyInsecure)
	callback := verifier.Callback()
	addr := testAddr(t)

	if err := callback("example.com:22", addr, generateHostKey(t)); err != nil {
		t.Fatalf("expected insecure policy to accept, got: %v", err)
	}
	// Different key for the same host is also accepted (and never recorded).
	if err := callback("example.com:22", addr, generateHostKey(t)); err != nil {
		t.Fatalf("expected insecure policy to accept changed key, got: %v", err)
	}
}

func TestLegacyStrictFalseDisablesVerification(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	cfg := config.SSHSecurityConfig{
		StrictHostKeyChecking: false,
		HostKeyPolicy:         HostKeyPolicyAcceptNew,
		KnownHostsFile:        path,
	}
	verifier := NewHostKeyVerifier(cfg, logrus.New())
	if verifier.policy != HostKeyPolicyInsecure {
		t.Fatalf("expected strictHostKeyChecking=false to force insecure policy, got: %s", verifier.policy)
	}
}
