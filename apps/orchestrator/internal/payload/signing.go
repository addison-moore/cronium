package payload

import (
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha512"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Signer signs payload archives with an Ed25519 key so runners can verify
// payload authenticity before execution. The public key is passed to the
// runner via the CRONIUM_VERIFY_KEY environment variable.
type Signer struct {
	priv ed25519.PrivateKey
}

// LoadOrCreateSigner loads the Ed25519 signing key from keyPath, generating
// and persisting a new key (0600) on first use.
func LoadOrCreateSigner(keyPath string) (*Signer, error) {
	data, err := os.ReadFile(keyPath)
	if os.IsNotExist(err) {
		return generateSigner(keyPath)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read signing key %s: %w", keyPath, err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in signing key %s", keyPath)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse signing key %s: %w", keyPath, err)
	}
	priv, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("signing key %s is not an Ed25519 key", keyPath)
	}
	return &Signer{priv: priv}, nil
}

// generateSigner creates a new Ed25519 keypair and persists it as PKCS8 PEM.
func generateSigner(keyPath string) (*Signer, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate signing key: %w", err)
	}

	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal signing key: %w", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})

	if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
		return nil, fmt.Errorf("failed to create signing key directory: %w", err)
	}
	if err := os.WriteFile(keyPath, pemBytes, 0o600); err != nil {
		return nil, fmt.Errorf("failed to write signing key %s: %w", keyPath, err)
	}

	return &Signer{priv: priv}, nil
}

// SignFile writes a detached base64-encoded Ed25519ph signature of the file at
// path to path+".sig". Ed25519ph (pre-hashed, RFC 8032) signs the streamed
// SHA-512 digest of the payload, so neither the signer nor the runner's verifier
// buffers the whole archive in memory. The runner must verify with the same
// pre-hash option.
func (s *Signer) SignFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open payload for signing: %w", err)
	}
	defer f.Close()

	h := sha512.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Errorf("failed to hash payload for signing: %w", err)
	}
	digest := h.Sum(nil)

	sig, err := s.priv.Sign(rand.Reader, digest, crypto.SHA512)
	if err != nil {
		return fmt.Errorf("failed to sign payload: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(sig) + "\n"
	if err := os.WriteFile(path+".sig", []byte(encoded), 0o644); err != nil {
		return fmt.Errorf("failed to write payload signature: %w", err)
	}
	return nil
}

// PublicKeyBase64 returns the base64-encoded Ed25519 public key runners use
// to verify signatures.
func (s *Signer) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(s.priv.Public().(ed25519.PublicKey))
}
