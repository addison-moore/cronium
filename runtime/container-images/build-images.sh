#!/bin/bash
# Build script for Cronium container images

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_PREFIX="${IMAGE_PREFIX:-cronium}"
TAG="${TAG:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Building Cronium Container Images"
echo "================================="
echo "Image prefix: $IMAGE_PREFIX"
echo "Tag: $TAG"
echo "Platforms: $PLATFORMS"
echo

# Function to build image
build_image() {
    local context="$1"
    local image="$2"
    local dockerfile="${3:-Dockerfile}"
    
    echo -e "${YELLOW}Building $image...${NC}"
    
    if [ "${USE_BUILDX}" = "true" ]; then
        # Multi-platform build with buildx
        docker buildx build \
            --platform "$PLATFORMS" \
            --tag "$image" \
            --file "$context/$dockerfile" \
            --push="${PUSH_IMAGES:-false}" \
            "$context"
    else
        # Standard build
        docker build \
            --tag "$image" \
            --file "$context/$dockerfile" \
            "$context"
    fi
    
    echo -e "${GREEN}✓ Built $image${NC}\n"
}

# Create buildx builder if needed
if [ "${USE_BUILDX}" = "true" ]; then
    if ! docker buildx ls | grep -q cronium-builder; then
        echo "Creating buildx builder..."
        docker buildx create --name cronium-builder --use
        docker buildx inspect --bootstrap
    else
        docker buildx use cronium-builder
    fi
fi

# Build base image
build_image "${SCRIPT_DIR}/base" "${IMAGE_PREFIX}/base:${TAG}"

# Build language-specific images
for lang in python nodejs bash; do
    if [ -d "${SCRIPT_DIR}/${lang}" ]; then
        # Build standard image
        build_image "${SCRIPT_DIR}/${lang}" "${IMAGE_PREFIX}/${lang}:${TAG}"
        
        # Build optimized versions if they exist
        if [ -f "${SCRIPT_DIR}/${lang}/Dockerfile.multistage" ]; then
            build_image "${SCRIPT_DIR}/${lang}" "${IMAGE_PREFIX}/${lang}:${TAG}-slim" "Dockerfile.multistage"
        fi
        
        if [ -f "${SCRIPT_DIR}/${lang}/Dockerfile.minimal" ]; then
            build_image "${SCRIPT_DIR}/${lang}" "${IMAGE_PREFIX}/${lang}:${TAG}-minimal" "Dockerfile.minimal"
        fi
    fi
done

echo -e "${GREEN}All images built successfully!${NC}"

# List built images
echo -e "\nBuilt images:"
docker images "${IMAGE_PREFIX}/*:${TAG}*" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# Scan for vulnerabilities if requested
if [ "${SCAN_IMAGES}" = "true" ]; then
    echo -e "\n${YELLOW}Scanning images for vulnerabilities...${NC}"
    for image in $(docker images "${IMAGE_PREFIX}/*:${TAG}*" --format "{{.Repository}}:{{.Tag}}"); do
        echo -e "\nScanning $image..."
        docker scout quickview "$image" 2>/dev/null || echo "Docker Scout not available"
    done
fi