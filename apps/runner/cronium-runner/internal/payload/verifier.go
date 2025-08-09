package payload

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

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

// VerifySignature verifies the signature of a payload (placeholder for now)
func VerifySignature(payloadPath string) error {
	// For Phase 1, we'll skip actual signature verification
	// This will be implemented properly when we set up cosign
	sigPath := payloadPath + ".sig"
	if _, err := os.Stat(sigPath); err != nil {
		if os.IsNotExist(err) {
			// No signature file, skip verification
			return nil
		}
		return fmt.Errorf("failed to check signature file: %w", err)
	}

	// TODO: Implement actual cosign verification
	// For now, just check that signature file exists
	return nil
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

