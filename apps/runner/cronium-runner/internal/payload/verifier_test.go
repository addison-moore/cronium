package payload

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func writeSignedPayload(t *testing.T, content []byte) (string, string) {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	payloadPath := filepath.Join(t.TempDir(), "payload.tar.gz")
	if err := os.WriteFile(payloadPath, content, 0o644); err != nil {
		t.Fatalf("failed to write payload: %v", err)
	}

	sig := ed25519.Sign(priv, content)
	sigEncoded := base64.StdEncoding.EncodeToString(sig) + "\n"
	if err := os.WriteFile(payloadPath+".sig", []byte(sigEncoded), 0o644); err != nil {
		t.Fatalf("failed to write signature: %v", err)
	}

	return payloadPath, base64.StdEncoding.EncodeToString(pub)
}

func TestVerifySignatureValid(t *testing.T) {
	payloadPath, pubKey := writeSignedPayload(t, []byte("payload-bytes"))
	t.Setenv(VerifyKeyEnvVar, pubKey)

	if err := VerifySignature(payloadPath); err != nil {
		t.Fatalf("expected valid signature to verify, got: %v", err)
	}
}

func TestVerifySignatureTamperedPayload(t *testing.T) {
	payloadPath, pubKey := writeSignedPayload(t, []byte("payload-bytes"))
	t.Setenv(VerifyKeyEnvVar, pubKey)

	if err := os.WriteFile(payloadPath, []byte("tampered-bytes"), 0o644); err != nil {
		t.Fatalf("failed to tamper payload: %v", err)
	}

	if err := VerifySignature(payloadPath); err == nil {
		t.Fatal("expected tampered payload to fail verification")
	}
}

func TestVerifySignatureMissingSigWithKey(t *testing.T) {
	payloadPath, pubKey := writeSignedPayload(t, []byte("payload-bytes"))
	t.Setenv(VerifyKeyEnvVar, pubKey)

	if err := os.Remove(payloadPath + ".sig"); err != nil {
		t.Fatalf("failed to remove signature: %v", err)
	}

	if err := VerifySignature(payloadPath); err == nil {
		t.Fatal("expected missing signature to fail when a verification key is provided")
	}
}

func TestVerifySignatureWrongKey(t *testing.T) {
	payloadPath, _ := writeSignedPayload(t, []byte("payload-bytes"))

	otherPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	t.Setenv(VerifyKeyEnvVar, base64.StdEncoding.EncodeToString(otherPub))

	if err := VerifySignature(payloadPath); err == nil {
		t.Fatal("expected verification with the wrong key to fail")
	}
}

func TestVerifySignatureLegacyModeSkips(t *testing.T) {
	payloadPath, _ := writeSignedPayload(t, []byte("payload-bytes"))
	t.Setenv(VerifyKeyEnvVar, "")

	if err := os.Remove(payloadPath + ".sig"); err != nil {
		t.Fatalf("failed to remove signature: %v", err)
	}

	if err := VerifySignature(payloadPath); err != nil {
		t.Fatalf("expected legacy mode (no key) to skip verification, got: %v", err)
	}
}

func TestVerifySignatureInvalidKey(t *testing.T) {
	payloadPath, _ := writeSignedPayload(t, []byte("payload-bytes"))
	t.Setenv(VerifyKeyEnvVar, "not-base64!!!")

	if err := VerifySignature(payloadPath); err == nil {
		t.Fatal("expected invalid verification key to fail")
	}
}
