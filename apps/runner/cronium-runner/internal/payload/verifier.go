package payload

import (
	"crypto/ed25519"
	"crypto/sha256"
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
// CRONIUM_VERIFY_KEY. When no key is provided (legacy orchestrators or
// deployments without a signing key), verification is skipped.
func VerifySignature(payloadPath string) error {
	keyB64 := os.Getenv(VerifyKeyEnvVar)
	if keyB64 == "" {
		// No verification key provided; run in legacy unverified mode.
		return nil
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

	// Bound the read: refuse to buffer an oversized archive into memory for
	// verification (HI-15 memory-exhaustion guard). The payload is a compressed
	// script bundle; a signed archive larger than this cap is rejected.
	payloadData, err := readFileBounded(payloadPath, maxSignedPayloadBytes)
	if err != nil {
		return fmt.Errorf("failed to read payload for verification: %w", err)
	}

	if !ed25519.Verify(publicKey, payloadData, signature) {
		return fmt.Errorf("payload signature verification failed: payload does not match its signature")
	}

	return nil
}

// maxSignedPayloadBytes caps the archive size verification will buffer.
const maxSignedPayloadBytes = 512 * 1024 * 1024 // 512 MiB

// readFileBounded reads up to max+1 bytes and errors if the file exceeds max.
func readFileBounded(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("payload exceeds maximum verifiable size (%d bytes)", max)
	}
	return data, nil
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
