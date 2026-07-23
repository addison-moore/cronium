package payload

import (
	"crypto"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// VerifyKeyEnvVar carries the base64-encoded Ed25519 public key the
// orchestrator used to sign the payload. When set, signature verification
// is mandatory.
const VerifyKeyEnvVar = "CRONIUM_VERIFY_KEY"

// VerifyChecksum verifies the checksum of a payload file
func VerifyChecksum(payloadPath string, expectedChecksum string) error {
	if expectedChecksum == "" {
		// Skip verification if no checksum provided
		return nil
	}

	file, err := os.Open(payloadPath)
	if err != nil {
		return fmt.Errorf("failed to open payload for verification: %w", err)
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("failed to calculate checksum: %w", err)
	}

	calculatedChecksum := hex.EncodeToString(hash.Sum(nil))
	if calculatedChecksum != expectedChecksum {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedChecksum, calculatedChecksum)
	}

	return nil
}

// VerifySignature verifies the payload's detached Ed25519 signature
// (<payload>.sig, base64-encoded) against the public key provided via
// CRONIUM_VERIFY_KEY.
//
// Signature verification is MANDATORY (HI-15): a missing key, missing
// signature, or mismatch all fail closed. The runner refuses to extract or
// execute an unsigned/unverifiable payload — an attacker who tampers with the
// staged payload, or an orchestrator that fails to sign, cannot get code run.
func VerifySignature(payloadPath string) error {
	keyB64 := os.Getenv(VerifyKeyEnvVar)
	if keyB64 == "" {
		// Fail CLOSED: refuse to run a payload we cannot verify.
		return fmt.Errorf("%s is not set: refusing to execute an unsigned payload (signature verification is mandatory)", VerifyKeyEnvVar)
	}

	keyBytes, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return fmt.Errorf("invalid %s: %w", VerifyKeyEnvVar, err)
	}
	if len(keyBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid %s: expected %d-byte Ed25519 public key, got %d bytes",
			VerifyKeyEnvVar, ed25519.PublicKeySize, len(keyBytes))
	}
	publicKey := ed25519.PublicKey(keyBytes)

	sigPath := payloadPath + ".sig"
	sigData, err := os.ReadFile(sigPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("payload signature %s is missing but a verification key was provided", sigPath)
		}
		return fmt.Errorf("failed to read signature file: %w", err)
	}

	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigData)))
	if err != nil {
		return fmt.Errorf("invalid payload signature encoding: %w", err)
	}

	// Ed25519ph: stream the payload through SHA-512 (bounded so a tampered,
	// oversized archive cannot pin CPU forever) and verify the signature over the
	// 64-byte digest. Nothing but the hash state is held in memory — the whole
	// archive is never buffered (Phase 2.4).
	digest, err := streamDigestBounded(payloadPath, maxSignedPayloadBytes)
	if err != nil {
		return fmt.Errorf("failed to hash payload for verification: %w", err)
	}

	if err := ed25519.VerifyWithOptions(publicKey, digest, signature, &ed25519.Options{Hash: crypto.SHA512}); err != nil {
		return fmt.Errorf("payload signature verification failed: %w", err)
	}

	return nil
}

// maxSignedPayloadBytes caps the archive size verification will hash.
const maxSignedPayloadBytes = 512 * 1024 * 1024 // 512 MiB

// streamDigestBounded streams the file at path through SHA-512, returning its
// digest, and errors if the file exceeds max bytes. Memory use is O(1) in the
// payload size.
func streamDigestBounded(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha512.New()
	n, err := io.Copy(h, io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if n > max {
		return nil, fmt.Errorf("payload exceeds maximum verifiable size (%d bytes)", max)
	}
	return h.Sum(nil), nil
}

// GenerateChecksum calculates the SHA256 checksum of a file
func GenerateChecksum(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("failed to calculate checksum: %w", err)
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

// WriteChecksumFile writes a checksum file for a payload
func WriteChecksumFile(payloadPath string) error {
	checksum, err := GenerateChecksum(payloadPath)
	if err != nil {
		return fmt.Errorf("failed to generate checksum: %w", err)
	}

	checksumPath := payloadPath + ".sha256"
	checksumContent := fmt.Sprintf("%s  %s\n", checksum, filepath.Base(payloadPath))

	if err := os.WriteFile(checksumPath, []byte(checksumContent), 0644); err != nil {
		return fmt.Errorf("failed to write checksum file: %w", err)
	}

	return nil
}
