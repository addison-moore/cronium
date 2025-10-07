#!/bin/bash

# Build all Docker images required for Cronium development
# This script builds and tags all necessary images for containerized execution

set -e

echo "🐳 Building Cronium Docker images..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Change to root directory
cd "$ROOT_DIR"

# Function to build an image
build_image() {
    local service_name=$1
    local description=$2
    
    echo -e "${YELLOW}Building ${description}...${NC}"
    
    if docker-compose -f infra/docker/docker-compose.dev.local-app.yml build --no-cache "$service_name"; then
        echo -e "${GREEN}✓ ${description} built successfully${NC}"
    else
        echo -e "${RED}✗ Failed to build ${description}${NC}"
        exit 1
    fi
}

# Build runtime API (used as sidecar for containerized execution)
build_image "runtime-api" "Runtime API (cronium/runtime-api:latest)"

# Build execution environment images using the build-only profile
echo -e "${YELLOW}Building execution environment images...${NC}"

# Build all execution environments with the build-only profile
if docker-compose -f infra/docker/docker-compose.dev.local-app.yml --profile build-only build bash-executor nodejs-executor python-executor; then
    echo -e "${GREEN}✓ Execution environment images built successfully${NC}"
else
    echo -e "${RED}✗ Failed to build execution environment images${NC}"
    exit 1
fi

# Build the orchestrator image
build_image "cronium-agent" "Orchestrator (cronium-agent)"

# List all built images
echo -e "\n${GREEN}Successfully built images:${NC}"
docker images | grep -E "cronium/(runtime-api|runner)" | head -10

echo -e "\n${GREEN}✓ All Docker images built successfully!${NC}"
echo -e "${YELLOW}You can now run 'pnpm docker:up' to start the services.${NC}"