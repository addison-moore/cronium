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

// Extraction limits guard against decompression bombs and file-count
// exhaustion (HI-15). A payload is a single script plus a small manifest and
// helper set, so these ceilings are generous but bounded.
const (
	maxMembers   = 10000
	maxFileSize  = 256 * 1024 * 1024 // 256 MiB per file
	maxTotalSize = 512 * 1024 * 1024 // 512 MiB expanded total
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

// isWithin reports whether target is contained within dir (not dir itself's
// sibling). It compares the cleaned relative path, so `/x/AAA` is NOT treated
// as containing `/x/AAABBB` (the sibling-prefix bug in the old HasPrefix check).
func isWithin(dir, target string) bool {
	rel, err := filepath.Rel(dir, target)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
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

	cleanDest := filepath.Clean(dest)
	members := 0
	var totalBytes int64

	// Extract files
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		members++
		if members > maxMembers {
			return fmt.Errorf("payload exceeds maximum member count (%d)", maxMembers)
		}

		// Reject absolute paths and parent-directory escapes outright.
		if filepath.IsAbs(header.Name) || strings.Contains(header.Name, "..") {
			return fmt.Errorf("invalid file path in payload: %s", header.Name)
		}

		target := filepath.Join(cleanDest, header.Name)

		// Containment check (fixes sibling-prefix traversal).
		if !isWithin(cleanDest, target) {
			return fmt.Errorf("payload member escapes extraction directory: %s", header.Name)
		}

		// Process based on type
		switch header.Typeflag {
		case tar.TypeDir:
			// Create directory
			if err := os.MkdirAll(target, os.FileMode(header.Mode)&0o777); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", target, err)
			}

		case tar.TypeReg:
			if header.Size < 0 || header.Size > maxFileSize {
				return fmt.Errorf("payload file %s exceeds maximum size", header.Name)
			}
			totalBytes += header.Size
			if totalBytes > maxTotalSize {
				return fmt.Errorf("payload expanded size exceeds maximum (%d bytes)", maxTotalSize)
			}

			// Create directory for file if needed
			dir := filepath.Dir(target)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", dir, err)
			}

			// Create file (no-follow: O_EXCL prevents writing through a
			// pre-existing symlink an earlier member might have created).
			file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(header.Mode)&0o777)
			if err != nil {
				return fmt.Errorf("failed to create file %s: %w", target, err)
			}

			// Copy file contents, bounded by the per-file limit so a lying
			// header.Size cannot be used to write an unbounded stream.
			written, err := io.Copy(file, io.LimitReader(tr, maxFileSize+1))
			file.Close()
			if err != nil {
				return fmt.Errorf("failed to write file %s: %w", target, err)
			}
			if written > maxFileSize {
				return fmt.Errorf("payload file %s exceeds maximum size", header.Name)
			}

		default:
			// Skip other types (symlinks, devices, etc.) — never extracted.
			continue
		}
	}

	return nil
}

// ResolveEntrypoint validates that the manifest entrypoint refers to a regular
// file contained within the extraction directory, returning its absolute path.
// A manifest with a `../` or absolute entrypoint is rejected (HI-15).
func ResolveEntrypoint(workDir, entrypoint string) (string, error) {
	if entrypoint == "" {
		return "", fmt.Errorf("manifest entrypoint is empty")
	}
	if filepath.IsAbs(entrypoint) || strings.Contains(entrypoint, "..") {
		return "", fmt.Errorf("invalid entrypoint path: %s", entrypoint)
	}
	cleanDir := filepath.Clean(workDir)
	target := filepath.Join(cleanDir, entrypoint)
	if !isWithin(cleanDir, target) {
		return "", fmt.Errorf("entrypoint escapes work directory: %s", entrypoint)
	}
	info, err := os.Lstat(target)
	if err != nil {
		return "", fmt.Errorf("entrypoint not found: %s", entrypoint)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("entrypoint is not a regular file: %s", entrypoint)
	}
	return target, nil
}

// Cleanup removes the extracted payload directory
func Cleanup(dir string) error {
	if dir == "" || !strings.Contains(dir, "cronium-run-") {
		return fmt.Errorf("invalid directory for cleanup: %s", dir)
	}
	return os.RemoveAll(dir)
}
