#!/bin/bash

# Build optimized, platform-specific runner binaries
# Each binary only includes helpers for its target platform

set -e

VERSION=${VERSION:-dev}
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S')
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

DIST_DIR="dist"
mkdir -p "$DIST_DIR"

# Build flags for optimization
LDFLAGS="-s -w -X main.Version=$VERSION -X main.BuildTime=$BUILD_TIME -X main.GitCommit=$GIT_COMMIT"

echo "Building optimized, platform-specific runners..."

# Build Linux AMD64 runner (only embeds linux_amd64 helpers)
echo "Building linux/amd64 runner..."
GOOS=linux GOARCH=amd64 go build \
    -ldflags "$LDFLAGS" \
    -trimpath \
    -tags "linux_amd64_only" \
    -o "$DIST_DIR/cronium-runner-linux-amd64-optimized" \
    ./cmd/runner

# Build Linux ARM64 runner (only embeds linux_arm64 helpers)  
echo "Building linux/arm64 runner..."
GOOS=linux GOARCH=arm64 go build \
    -ldflags "$LDFLAGS" \
    -trimpath \
    -tags "linux_arm64_only" \
    -o "$DIST_DIR/cronium-runner-linux-arm64-optimized" \
    ./cmd/runner

# Check sizes
echo ""
echo "Binary sizes:"
ls -lah "$DIST_DIR"/cronium-runner-*-optimized

# Optional: Compress with UPX if available
if command -v upx &> /dev/null; then
    echo ""
    echo "Compressing with UPX..."
    for binary in "$DIST_DIR"/cronium-runner-*-optimized; do
        cp "$binary" "$binary.bak"
        upx --best "$binary" || echo "UPX compression failed for $binary"
    done
    echo ""
    echo "Compressed sizes:"
    ls -lah "$DIST_DIR"/cronium-runner-*-optimized
fi

# Copy to project-level artifacts directory
ARTIFACTS_DIR="../../../artifacts/runners"
mkdir -p "$ARTIFACTS_DIR/$VERSION"

echo ""
echo "Copying optimized binaries to project artifacts directory..."
cp "$DIST_DIR/cronium-runner-linux-amd64-optimized" "$ARTIFACTS_DIR/$VERSION/cronium-runner-linux-amd64"
cp "$DIST_DIR/cronium-runner-linux-arm64-optimized" "$ARTIFACTS_DIR/$VERSION/cronium-runner-linux-arm64"

# Generate checksums
(cd "$ARTIFACTS_DIR/$VERSION" && sha256sum cronium-runner-linux-amd64 > cronium-runner-linux-amd64.sha256)
(cd "$ARTIFACTS_DIR/$VERSION" && sha256sum cronium-runner-linux-arm64 > cronium-runner-linux-arm64.sha256)

echo "Artifacts copied to: $ARTIFACTS_DIR/$VERSION/"
ls -lah "$ARTIFACTS_DIR/$VERSION/"

# Copy to orchestrator's artifacts directory (this is what gets mounted in Docker)
ORCHESTRATOR_ARTIFACTS_DIR="../../orchestrator/artifacts/runners"
mkdir -p "$ORCHESTRATOR_ARTIFACTS_DIR/$VERSION"

echo ""
echo "Copying to orchestrator artifacts directory..."
cp "$DIST_DIR/cronium-runner-linux-amd64-optimized" "$ORCHESTRATOR_ARTIFACTS_DIR/$VERSION/cronium-runner-linux-amd64"
cp "$DIST_DIR/cronium-runner-linux-arm64-optimized" "$ORCHESTRATOR_ARTIFACTS_DIR/$VERSION/cronium-runner-linux-arm64"

# Generate checksums
(cd "$ORCHESTRATOR_ARTIFACTS_DIR/$VERSION" && sha256sum cronium-runner-linux-amd64 > cronium-runner-linux-amd64.sha256)
(cd "$ORCHESTRATOR_ARTIFACTS_DIR/$VERSION" && sha256sum cronium-runner-linux-arm64 > cronium-runner-linux-arm64.sha256)

echo "Orchestrator artifacts copied to: $ORCHESTRATOR_ARTIFACTS_DIR/$VERSION/"
ls -lah "$ORCHESTRATOR_ARTIFACTS_DIR/$VERSION/"

# Also copy to orchestrator's embedded location for Docker builds
ORCHESTRATOR_RUNNER_DIR="../../orchestrator/runtime/cronium-runtime"
if [ -d "$ORCHESTRATOR_RUNNER_DIR" ]; then
    echo ""
    echo "Copying to orchestrator runtime directory..."
    cp "$DIST_DIR/cronium-runner-linux-amd64-optimized" "$ORCHESTRATOR_RUNNER_DIR/cronium-runner-linux-amd64"
    cp "$DIST_DIR/cronium-runner-linux-arm64-optimized" "$ORCHESTRATOR_RUNNER_DIR/cronium-runner-linux-arm64"
    echo "Copied to orchestrator runtime directory"
fi

echo ""
echo "Build complete!"