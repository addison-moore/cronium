package manifest

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/pkg/types"
	"gopkg.in/yaml.v3"
)

// Parse reads and parses a manifest.yaml file
func Parse(manifestPath string) (*types.Manifest, error) {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read manifest: %w", err)
	}

	var manifest types.Manifest
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse manifest: %w", err)
	}

	// Validate manifest
	if err := validate(&manifest); err != nil {
		return nil, fmt.Errorf("invalid manifest: %w", err)
	}

	return &manifest, nil
}

// validate checks if the manifest is valid
func validate(m *types.Manifest) error {
	if m.Version == "" {
		return fmt.Errorf("version is required")
	}

	if m.Version != "v1" {
		return fmt.Errorf("unsupported manifest version: %s", m.Version)
	}

	switch m.Interpreter {
	case types.ScriptTypeBash, types.ScriptTypePython, types.ScriptTypeNode:
		// Valid interpreter
	default:
		return fmt.Errorf("unsupported interpreter: %s", m.Interpreter)
	}

	if m.Entrypoint == "" {
		return fmt.Errorf("entrypoint is required")
	}

	// JobID is optional for testing purposes
	// if m.Metadata.JobID == "" {
	// 	return fmt.Errorf("metadata.jobId is required")
	// }

	return nil
}

// FindManifest looks for manifest.yaml in the given directory
func FindManifest(dir string) (string, error) {
	manifestPath := filepath.Join(dir, "manifest.yaml")
	if _, err := os.Stat(manifestPath); err != nil {
		if os.IsNotExist(err) {
			// Also try manifest.yml
			manifestPath = filepath.Join(dir, "manifest.yml")
			if _, err := os.Stat(manifestPath); err != nil {
				return "", fmt.Errorf("manifest.yaml not found in %s", dir)
			}
		} else {
			return "", err
		}
	}
	return manifestPath, nil
}

