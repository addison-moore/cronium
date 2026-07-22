package payload

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v2"
)

// PayloadManifest represents the manifest file in a payload
type PayloadManifest struct {
	Version     string                 `yaml:"version"`
	Interpreter string                 `yaml:"interpreter"`
	Entrypoint  string                 `yaml:"entrypoint"`
	Environment map[string]string      `yaml:"environment,omitempty"`
	Metadata    map[string]interface{} `yaml:"metadata"`
}

// PayloadData represents the data needed to create a payload
type PayloadData struct {
	JobID         string                 `json:"jobId"`
	ExecutionID   string                 `json:"executionId"`
	ScriptContent string                 `json:"scriptContent"`
	ScriptType    string                 `json:"scriptType"`
	Environment   map[string]string      `json:"environment"`
	Metadata      map[string]interface{} `json:"metadata"`
}

// Service manages payload creation and storage
type Service struct {
	storageDir string
}

// NewService creates a new payload service
func NewService(storageDir string) *Service {
	if storageDir == "" {
		storageDir = "/app/data/payloads"
	}
	return &Service{
		storageDir: storageDir,
	}
}

// CreatePayload creates a new payload tar.gz file.
//
// Payload files can carry secrets (script content, environment). They are
// written with restrictive modes so other users on the orchestrator host
// cannot read them (HI-13): private directories (0700) and private files
// (0600). The runner reads (does not exec-bit-invoke) the script, so 0600 is
// sufficient.
func (s *Service) CreatePayload(data *PayloadData) (string, error) {
	// Ensure storage directory exists (private)
	if err := os.MkdirAll(s.storageDir, 0o700); err != nil {
		return "", fmt.Errorf("failed to create storage directory: %w", err)
	}

	// Create temp directory for payload contents (private)
	tempDir := filepath.Join(s.storageDir, "temp", fmt.Sprintf("job-%s", data.JobID))
	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir) // Clean up temp dir

	// Write script file (private)
	scriptFilename := s.getScriptFilename(data.ScriptType)
	scriptPath := filepath.Join(tempDir, scriptFilename)
	if err := os.WriteFile(scriptPath, []byte(data.ScriptContent), 0o600); err != nil {
		return "", fmt.Errorf("failed to write script file: %w", err)
	}

	// Create manifest
	manifest := PayloadManifest{
		Version:     "v1",
		Interpreter: s.getInterpreter(data.ScriptType),
		Entrypoint:  scriptFilename,
		Environment: data.Environment,
		Metadata:    data.Metadata,
	}

	// Add job-specific metadata
	if manifest.Metadata == nil {
		manifest.Metadata = make(map[string]interface{})
	}
	manifest.Metadata["jobId"] = data.JobID
	manifest.Metadata["executionId"] = data.ExecutionID
	manifest.Metadata["createdAt"] = time.Now().Format(time.RFC3339)

	// Write manifest
	manifestPath := filepath.Join(tempDir, "manifest.yaml")
	manifestData, err := yaml.Marshal(manifest)
	if err != nil {
		return "", fmt.Errorf("failed to marshal manifest: %w", err)
	}
	if err := os.WriteFile(manifestPath, manifestData, 0o600); err != nil {
		return "", fmt.Errorf("failed to write manifest: %w", err)
	}

	// Create tar.gz archive
	payloadFilename := fmt.Sprintf("job-%s.tar.gz", data.JobID)
	payloadPath := filepath.Join(s.storageDir, payloadFilename)

	if err := s.createTarGz(tempDir, payloadPath); err != nil {
		return "", fmt.Errorf("failed to create archive: %w", err)
	}
	// The archive bundles the (secret-bearing) script + manifest; keep it private.
	if err := os.Chmod(payloadPath, 0o600); err != nil {
		return "", fmt.Errorf("failed to restrict payload permissions: %w", err)
	}

	// Calculate checksum
	checksum, err := s.calculateChecksum(payloadPath)
	if err != nil {
		return "", fmt.Errorf("failed to calculate checksum: %w", err)
	}

	// Write checksum file (private)
	checksumPath := payloadPath + ".sha256"
	checksumData := fmt.Sprintf("%s  %s\n", checksum, filepath.Base(payloadPath))
	if err := os.WriteFile(checksumPath, []byte(checksumData), 0o600); err != nil {
		return "", fmt.Errorf("failed to write checksum: %w", err)
	}

	return payloadPath, nil
}

// GetPayloadPath returns the path to a payload file
func (s *Service) GetPayloadPath(jobID string) string {
	return filepath.Join(s.storageDir, fmt.Sprintf("job-%s.tar.gz", jobID))
}

// CleanupOldPayloads removes payloads older than the specified duration
func (s *Service) CleanupOldPayloads(maxAge time.Duration) error {
	entries, err := os.ReadDir(s.storageDir)
	if err != nil {
		return fmt.Errorf("failed to read storage directory: %w", err)
	}

	cutoff := time.Now().Add(-maxAge)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Only sweep payload archives (and their sidecars); skip the .sha256/.sig
		// sidecars themselves so a payload removed with its sidecars below is not
		// double-handled.
		name := entry.Name()
		if strings.HasSuffix(name, ".sha256") || strings.HasSuffix(name, ".sig") {
			continue
		}
		if info.ModTime().Before(cutoff) {
			path := filepath.Join(s.storageDir, name)
			os.Remove(path)
			os.Remove(path + ".sha256") // checksum sidecar
			os.Remove(path + ".sig")    // signature sidecar (was orphaned before)
		}
	}

	return nil
}

func (s *Service) getScriptFilename(scriptType string) string {
	// Normalize to uppercase for comparison
	upperType := strings.ToUpper(scriptType)
	switch upperType {
	case "PYTHON":
		return "script.py"
	case "NODE_JS", "NODEJS", "NODE":
		return "script.js"
	case "BASH", "SH", "SHELL":
		return "script.sh"
	default:
		return "script.sh"
	}
}

func (s *Service) getInterpreter(scriptType string) string {
	// Normalize to uppercase for comparison
	upperType := strings.ToUpper(scriptType)
	switch upperType {
	case "PYTHON":
		return "PYTHON"
	case "NODE_JS", "NODEJS", "NODE":
		return "NODEJS"
	case "BASH", "SH", "SHELL":
		return "BASH"
	default:
		// Default to BASH for unknown types
		return "BASH"
	}
}

func (s *Service) createTarGz(sourceDir, targetPath string) error {
	file, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzWriter := gzip.NewWriter(file)
	defer gzWriter.Close()

	tarWriter := tar.NewWriter(gzWriter)
	defer tarWriter.Close()

	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip the source directory itself
		if path == sourceDir {
			return nil
		}

		// Create tar header
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}

		// Set the name relative to source directory
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		header.Name = relPath

		// Write header
		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}

		// Write file content if it's a regular file
		if info.Mode().IsRegular() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if _, err := tarWriter.Write(data); err != nil {
				return err
			}
		}

		return nil
	})
}

func (s *Service) calculateChecksum(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}
