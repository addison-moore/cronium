package payload

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadOrCreateSignerGeneratesAndReloads(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "keys", "payload_signing.key")

	signer, err := LoadOrCreateSigner(keyPath)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("expected key file to be created: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected key file mode 0600, got %v", info.Mode().Perm())
	}

	// Reloading returns the same key.
	reloaded, err := LoadOrCreateSigner(keyPath)
	if err != nil {
		t.Fatalf("failed to reload signer: %v", err)
	}
	if signer.PublicKeyBase64() != reloaded.PublicKeyBase64() {
		t.Fatal("expected reloaded signer to have the same public key")
	}
}

func TestSignFileProducesVerifiableSignature(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "payload_signing.key")
	payloadPath := filepath.Join(dir, "payload.tar.gz")

	if err := os.WriteFile(payloadPath, []byte("payload-bytes"), 0o644); err != nil {
		t.Fatalf("failed to write payload: %v", err)
	}

	signer, err := LoadOrCreateSigner(keyPath)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}
	if err := signer.SignFile(payloadPath); err != nil {
		t.Fatalf("failed to sign payload: %v", err)
	}

	sigData, err := os.ReadFile(payloadPath + ".sig")
	if err != nil {
		t.Fatalf("expected signature file: %v", err)
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigData)))
	if err != nil {
		t.Fatalf("signature is not valid base64: %v", err)
	}
	publicKey, err := base64.StdEncoding.DecodeString(signer.PublicKeyBase64())
	if err != nil {
		t.Fatalf("public key is not valid base64: %v", err)
	}

	if !ed25519.Verify(ed25519.PublicKey(publicKey), []byte("payload-bytes"), signature) {
		t.Fatal("expected signature to verify against payload")
	}
	if ed25519.Verify(ed25519.PublicKey(publicKey), []byte("tampered-bytes"), signature) {
		t.Fatal("expected signature verification to fail for tampered payload")
	}
}
