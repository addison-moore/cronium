#!/bin/bash
# Script to build with a specific env file

# Change to project root
cd "$(dirname "$0")/../.."

# Backup existing .env.local if it exists
if [ -f .env.local ]; then
  mv .env.local .env.local.backup
fi

# Copy .env.build to .env.local
if [ -f .env.build ]; then
  cp .env.build .env.local
else
  echo "Warning: .env.build not found, using existing .env.local"
fi

# Run the build for all packages
echo "Building all packages..."
pnpm build

# Build Go services if needed
if [ "${BUILD_GO:-false}" = "true" ]; then
  echo "Building Go services..."
  pnpm build:go
fi

# Restore original .env.local
if [ -f .env.local.backup ]; then
  mv .env.local.backup .env.local
else
  rm -f .env.local
fi

echo "Build complete!"