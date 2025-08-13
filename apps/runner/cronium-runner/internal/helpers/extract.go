package helpers

import (
    "fmt"
    "os"
    "path/filepath"
)

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