#!/bin/bash
set -e

# Build directory for helper binaries
HELPERS_DIR="internal/helpers/binaries"
mkdir -p "$HELPERS_DIR"

# Helper commands to build
HELPERS=(
    "input"
    "output"
    "getVariable"
    "setVariable"
    "event"
)

# Only build for Linux platforms (what we actually need)
PLATFORMS=(
    "linux/amd64"
    "linux/arm64"
)

echo "Building helper binaries..."

for platform in "${PLATFORMS[@]}"; do
    IFS='/' read -r os arch <<< "$platform"
    
    for helper in "${HELPERS[@]}"; do
        echo "Building cronium.$helper for $os/$arch..."
        
        output_name="cronium.$helper"
        output_path="$HELPERS_DIR/${os}_${arch}_${output_name}"
        
        GOOS=$os GOARCH=$arch go build \
            -ldflags="-s -w" \
            -trimpath \
            -o "$output_path" \
            "./cmd/helpers/$helper"
    done
done

echo "Helper binaries built successfully!"
echo "Generating embed.go file..."

# Generate simple embed.go file that includes only Linux binaries
cat > internal/helpers/embed.go << 'EOF'
//go:build !nohelpers
// +build !nohelpers

package helpers

import (
    _ "embed"
    "fmt"
    "os"
    "path/filepath"
    "runtime"
)

// Embedded helper binaries for Linux platforms only
var (
    //go:embed binaries/linux_amd64_cronium.input
    linux_amd64_input []byte

    //go:embed binaries/linux_amd64_cronium.output
    linux_amd64_output []byte

    //go:embed binaries/linux_amd64_cronium.getVariable
    linux_amd64_getVariable []byte

    //go:embed binaries/linux_amd64_cronium.setVariable
    linux_amd64_setVariable []byte

    //go:embed binaries/linux_amd64_cronium.event
    linux_amd64_event []byte

    //go:embed binaries/linux_arm64_cronium.input
    linux_arm64_input []byte

    //go:embed binaries/linux_arm64_cronium.output
    linux_arm64_output []byte

    //go:embed binaries/linux_arm64_cronium.getVariable
    linux_arm64_getVariable []byte

    //go:embed binaries/linux_arm64_cronium.setVariable
    linux_arm64_setVariable []byte

    //go:embed binaries/linux_arm64_cronium.event
    linux_arm64_event []byte
)

// GetHelperBinary returns the embedded helper binary for the current platform
func GetHelperBinary(name string) ([]byte, error) {
    platform := fmt.Sprintf("%s_%s", runtime.GOOS, runtime.GOARCH)
    
    switch platform + "_" + name {
    case "linux_amd64_input":
        return linux_amd64_input, nil
    case "linux_amd64_output":
        return linux_amd64_output, nil
    case "linux_amd64_getVariable":
        return linux_amd64_getVariable, nil
    case "linux_amd64_setVariable":
        return linux_amd64_setVariable, nil
    case "linux_amd64_event":
        return linux_amd64_event, nil
    case "linux_arm64_input":
        return linux_arm64_input, nil
    case "linux_arm64_output":
        return linux_arm64_output, nil
    case "linux_arm64_getVariable":
        return linux_arm64_getVariable, nil
    case "linux_arm64_setVariable":
        return linux_arm64_setVariable, nil
    case "linux_arm64_event":
        return linux_arm64_event, nil
    default:
        return nil, fmt.Errorf("helper binary not found for platform %s: %s", platform, name)
    }
}

// ExtractHelper extracts a helper binary to the filesystem
func ExtractHelper(name, targetPath string) error {
    data, err := GetHelperBinary(name)
    if err != nil {
        return err
    }
    
    // Ensure directory exists
    if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
        return fmt.Errorf("failed to create directory: %w", err)
    }
    
    // Write binary
    if err := os.WriteFile(targetPath, data, 0755); err != nil {
        return fmt.Errorf("failed to write helper binary: %w", err)
    }
    
    return nil
}

// ExtractAllHelpers extracts all helper binaries to a directory
func ExtractAllHelpers(targetDir string) error {
    helpers := []string{"input", "output", "getVariable", "setVariable", "event"}
    
    for _, helper := range helpers {
        targetPath := filepath.Join(targetDir, "cronium."+helper)
        if err := ExtractHelper(helper, targetPath); err != nil {
            return fmt.Errorf("failed to extract %s: %w", helper, err)
        }
    }
    
    return nil
}
EOF

echo "Build complete!"