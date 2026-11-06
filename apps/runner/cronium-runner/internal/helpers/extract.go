package helpers

import (
	"fmt"
	"os"
	"path/filepath"
)

// HelperNames lists the helper binaries a runner ships, one per cmd/helpers
// directory. The go:embed lists in embed_linux_*.go must name the same set.
var HelperNames = []string{
	"input",
	"output",
	"getVariable",
	"setVariable",
	"setCondition",
	"event",
	"toolAction",
}

// ExtractAllHelpers writes every embedded helper binary to targetDir.
func ExtractAllHelpers(targetDir string) error {
	files := make(map[string][]byte, len(HelperNames))
	for _, name := range HelperNames {
		data, err := GetHelperBinary(name)
		if err != nil {
			return fmt.Errorf("failed to extract %s: %w", name, err)
		}
		files["cronium."+name] = data
	}
	return extractHelperFiles(targetDir, files)
}

// extractHelperFiles extracts helper binaries to the filesystem
func extractHelperFiles(dir string, helpers map[string][]byte) error {
	// Create directory if it doesn't exist
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create helpers directory: %w", err)
	}

	for name, data := range helpers {
		if len(data) == 0 {
			continue // Skip empty helpers
		}

		helperPath := filepath.Join(dir, name)

		// Write helper binary
		if err := os.WriteFile(helperPath, data, 0755); err != nil {
			return fmt.Errorf("failed to write helper %s: %w", name, err)
		}
	}

	return nil
}
