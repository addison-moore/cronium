#!/bin/bash
# Build and deploy Cronium Runner binaries
set -e

echo "========================================="
echo "Building Cronium Runner"
echo "========================================="

# Change to script directory
cd "$(dirname "$0")"

# Store version info
VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S')
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "Version: $VERSION"
echo "Build Time: $BUILD_TIME"
echo "Git Commit: $GIT_COMMIT"
echo ""

# Step 1: Build helper binaries
echo "Step 1: Building helper binaries..."
./build-helpers-simple.sh
echo ""

# Step 2: Build runner binaries
echo "Step 2: Building runner binaries..."
echo "Building linux/amd64..."
GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w -X main.Version=$VERSION -X main.BuildTime=$BUILD_TIME -X main.GitCommit=$GIT_COMMIT" \
    -trimpath \
    -o dist/cronium-runner-linux-amd64 \
    ./cmd/runner

echo "Building linux/arm64..."
GOOS=linux GOARCH=arm64 go build \
    -ldflags="-s -w -X main.Version=$VERSION -X main.BuildTime=$BUILD_TIME -X main.GitCommit=$GIT_COMMIT" \
    -trimpath \
    -o dist/cronium-runner-linux-arm64 \
    ./cmd/runner

# Step 3: Show sizes
echo ""
echo "Step 3: Binary sizes:"
ls -lh dist/cronium-runner-*

# Step 4: Deploy to artifacts
echo ""
echo "Step 4: Deploying to artifacts..."
ARTIFACTS_DIR="../../orchestrator/artifacts/runners"

# Create directories if they don't exist
mkdir -p "$ARTIFACTS_DIR/dev"
mkdir -p "$ARTIFACTS_DIR/$VERSION"

# Copy to dev directory (for immediate use)
cp dist/cronium-runner-linux-amd64 "$ARTIFACTS_DIR/dev/"
cp dist/cronium-runner-linux-arm64 "$ARTIFACTS_DIR/dev/"
echo "Copied to $ARTIFACTS_DIR/dev/"

# Copy to versioned directory (for history)
cp dist/cronium-runner-linux-amd64 "$ARTIFACTS_DIR/$VERSION/"
cp dist/cronium-runner-linux-arm64 "$ARTIFACTS_DIR/$VERSION/"
echo "Copied to $ARTIFACTS_DIR/$VERSION/"

# Step 5: Final verification
echo ""
echo "========================================="
echo "Build and deployment complete!"
echo "========================================="
echo ""
echo "Deployed binaries:"
ls -lh "$ARTIFACTS_DIR/dev/"
echo ""
echo "Version info:"
"$ARTIFACTS_DIR/dev/cronium-runner-linux-amd64" version 2>/dev/null || echo "  (Cannot run Linux binary on macOS)"