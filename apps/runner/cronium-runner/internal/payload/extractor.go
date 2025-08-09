package payload

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Extract extracts a tar.gz payload to a temporary directory
func Extract(payloadPath string) (string, error) {
	// Open the payload file
	file, err := os.Open(payloadPath)
	if err != nil {
		return "", fmt.Errorf("failed to open payload: %w", err)
	}
	defer file.Close()

	// Create a temporary directory for extraction
	tempDir, err := os.MkdirTemp("", "cronium-run-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	// Extract the payload
	if err := extractTarGz(file, tempDir); err != nil {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to extract payload: %w", err)
	}

	return tempDir, nil
}

// extractTarGz extracts a tar.gz archive to a directory
func extractTarGz(r io.Reader, dest string) error {
	// Create gzip reader
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gz.Close()

	// Create tar reader
	tr := tar.NewReader(gz)

	// Extract files
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		// Clean the path
		target := filepath.Join(dest, header.Name)

		// Validate path to prevent directory traversal
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(dest)) {
			return fmt.Errorf("invalid file path: %s", header.Name)
		}

		// Process based on type
		switch header.Typeflag {
		case tar.TypeDir:
			// Create directory
			if err := os.MkdirAll(target, os.FileMode(header.Mode)); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", target, err)
			}

		case tar.TypeReg:
			// Create directory for file if needed
			dir := filepath.Dir(target)
			if err := os.MkdirAll(dir, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", dir, err)
			}

			// Create file
			file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return fmt.Errorf("failed to create file %s: %w", target, err)
			}

			// Copy file contents
			if _, err := io.Copy(file, tr); err != nil {
				file.Close()
				return fmt.Errorf("failed to write file %s: %w", target, err)
			}
			file.Close()

		default:
			// Skip other types (symlinks, etc.)
			continue
		}
	}

	return nil
}

// Cleanup removes the extracted payload directory
func Cleanup(dir string) error {
	if dir == "" || !strings.Contains(dir, "cronium-run-") {
		return fmt.Errorf("invalid directory for cleanup: %s", dir)
	}
	return os.RemoveAll(dir)
}

