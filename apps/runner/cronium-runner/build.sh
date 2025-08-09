#!/bin/bash

# Build script for Cronium Runner
set -e

echo "Building Cronium Runner..."

# Change to script directory
cd "$(dirname "$0")"

# Install dependencies
echo "Installing dependencies..."
go mod download

# Run tests
echo "Running tests..."
go test ./...

# Build for all platforms
echo "Building binaries..."
make build

# Create artifacts directory structure
ARTIFACTS_DIR="../../../artifacts/runners"
mkdir -p "$ARTIFACTS_DIR"

# Store build info
VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "dev")
echo "Built version: $VERSION"

# Copy artifacts
make store-artifacts

echo "Build complete! Artifacts stored in $ARTIFACTS_DIR/$VERSION"

# List built artifacts
echo "Built artifacts:"
ls -la dist/