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

# Build for multiple platforms
PLATFORMS=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
)

echo "Building helper binaries..."

for platform in "${PLATFORMS[@]}"; do
    IFS='/' read -r os arch <<< "$platform"
    
    for helper in "${HELPERS[@]}"; do
        echo "Building cronium.$helper for $os/$arch..."
        
        output_name="cronium.$helper"
        if [ "$os" == "windows" ]; then
            output_name="${output_name}.exe"
        fi
        
        output_path="$HELPERS_DIR/${os}_${arch}_${output_name}"
        
        GOOS=$os GOARCH=$arch go build \
            -ldflags="-s -w" \
            -o "$output_path" \
            "./cmd/helpers/$helper"
    done
done

echo "Helper binaries built successfully!"
echo "Generating embed.go file..."

# Generate embed.go file
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

// Embedded helper binaries
var (
EOF

# Add embed directives for each binary
for platform in "${PLATFORMS[@]}"; do
    IFS='/' read -r os arch <<< "$platform"
    
    for helper in "${HELPERS[@]}"; do
        varname="${os}_${arch}_${helper}"
        filename="${os}_${arch}_cronium.${helper}"
        
        echo "    //go:embed binaries/${filename}" >> internal/helpers/embed.go
        echo "    ${varname} []byte" >> internal/helpers/embed.go
        echo "" >> internal/helpers/embed.go
    done
done

cat >> internal/helpers/embed.go << 'EOF'
)

// GetHelperBinary returns the embedded helper binary for the current platform
func GetHelperBinary(name string) ([]byte, error) {
    platform := fmt.Sprintf("%s_%s", runtime.GOOS, runtime.GOARCH)
    
    switch platform + "_" + name {
EOF

# Add cases for each binary
for platform in "${PLATFORMS[@]}"; do
    IFS='/' read -r os arch <<< "$platform"
    
    for helper in "${HELPERS[@]}"; do
        varname="${os}_${arch}_${helper}"
        echo "    case \"${os}_${arch}_${helper}\":" >> internal/helpers/embed.go
        echo "        return ${varname}, nil" >> internal/helpers/embed.go
    done
done

cat >> internal/helpers/embed.go << 'EOF'
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