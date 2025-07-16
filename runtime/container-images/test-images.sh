#!/bin/bash
# Test script for Cronium container images

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_PREFIX="${IMAGE_PREFIX:-cronium}"
TAG="${TAG:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Testing Cronium Container Images"
echo "================================"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
test_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((TESTS_PASSED++))
}

test_fail() {
    echo -e "${RED}✗${NC} $1"
    ((TESTS_FAILED++))
}

test_image() {
    local image="$1"
    local test_cmd="$2"
    local expected="$3"
    
    echo -e "\n${YELLOW}Testing $image...${NC}"
    
    # Check if image exists
    if ! docker image inspect "$image" >/dev/null 2>&1; then
        test_fail "$image: Image not found"
        return 1
    fi
    
    # Run basic container test
    if docker run --rm "$image" $test_cmd >/dev/null 2>&1; then
        test_pass "$image: Basic execution"
    else
        test_fail "$image: Basic execution failed"
    fi
    
    # Test as non-root user
    local user=$(docker run --rm "$image" id -u 2>/dev/null || echo "error")
    if [ "$user" = "1000" ]; then
        test_pass "$image: Running as non-root user (UID 1000)"
    else
        test_fail "$image: Not running as non-root user (got UID: $user)"
    fi
    
    # Test health check
    local container_id=$(docker run -d "$image" sleep 30 2>/dev/null)
    if [ -n "$container_id" ]; then
        sleep 2
        if docker exec "$container_id" test -f /usr/local/bin/healthcheck.* 2>/dev/null; then
            test_pass "$image: Health check script exists"
        else
            test_fail "$image: Health check script missing"
        fi
        docker rm -f "$container_id" >/dev/null 2>&1
    fi
}

# Test security features
test_security() {
    local image="$1"
    local lang="$2"
    
    echo -e "\n${YELLOW}Security tests for $image...${NC}"
    
    # Test read-only filesystem
    local container_id=$(docker run -d --read-only --tmpfs /tmp --tmpfs /app "$image" sleep 30 2>/dev/null)
    if [ -n "$container_id" ]; then
        test_pass "$image: Supports read-only filesystem"
        docker rm -f "$container_id" >/dev/null 2>&1
    else
        test_fail "$image: Read-only filesystem failed"
    fi
    
    # Test for package managers (should not exist in production images)
    case "$lang" in
        python)
            if docker run --rm "$image" which pip 2>/dev/null; then
                test_fail "$image: Package manager (pip) found - security risk"
            else
                test_pass "$image: Package manager removed"
            fi
            ;;
        node)
            if docker run --rm "$image" which npm 2>/dev/null; then
                test_fail "$image: Package manager (npm) found - security risk"
            else
                test_pass "$image: Package manager removed"
            fi
            ;;
        bash)
            if docker run --rm "$image" which apk 2>/dev/null; then
                test_fail "$image: Package manager (apk) found - security risk"
            else
                test_pass "$image: Package manager removed"
            fi
            ;;
    esac
    
    # Test for minimal installed packages
    local pkg_count=$(docker run --rm "$image" find /usr/bin -type f 2>/dev/null | wc -l || echo "0")
    if [ "$pkg_count" -lt 100 ]; then
        test_pass "$image: Minimal packages installed ($pkg_count binaries)"
    else
        test_fail "$image: Too many packages ($pkg_count binaries)"
    fi
}

# Test runtime functionality
test_runtime() {
    local image="$1"
    local lang="$2"
    
    echo -e "\n${YELLOW}Runtime tests for $image...${NC}"
    
    # Create test script based on language
    local test_file=""
    case "$lang" in
        python)
            test_file="test_runtime.py"
            cat > "/tmp/$test_file" << 'EOF'
import os
import sys

# Test module import
try:
    import cronium
    print("SUCCESS: cronium module imported")
except Exception as e:
    print(f"FAIL: {e}")
    sys.exit(1)

# Test environment
print(f"Python version: {sys.version}")
print(f"User: {os.environ.get('USER', 'unknown')}")
EOF
            ;;
        node)
            test_file="test_runtime.js"
            cat > "/tmp/$test_file" << 'EOF'
// Test module loading
try {
    const cronium = require('cronium');
    console.log('SUCCESS: cronium module loaded');
} catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exit(1);
}

// Test environment
console.log(`Node version: ${process.version}`);
console.log(`User: ${process.env.USER || 'unknown'}`);
EOF
            ;;
        bash)
            test_file="test_runtime.sh"
            cat > "/tmp/$test_file" << 'EOF'
#!/bin/bash
# Test cronium functions availability
if declare -F cronium_info >/dev/null 2>&1; then
    echo "SUCCESS: cronium functions available"
else
    # Try to source it
    if source /usr/local/bin/cronium.sh 2>/dev/null; then
        echo "SUCCESS: cronium.sh sourced"
    else
        echo "FAIL: cronium functions not available"
        exit 1
    fi
fi

# Test environment
echo "Bash version: $BASH_VERSION"
echo "User: $USER"
EOF
            chmod +x "/tmp/$test_file"
            ;;
    esac
    
    # Run the test script in container
    if docker run --rm -v "/tmp/$test_file:/app/$test_file:ro" "$image" ${lang} "/app/$test_file" 2>&1 | grep -q "SUCCESS"; then
        test_pass "$image: Runtime SDK functional"
    else
        test_fail "$image: Runtime SDK not functional"
    fi
    
    rm -f "/tmp/$test_file"
}

# Build images if requested
if [ "${BUILD_IMAGES}" = "true" ]; then
    echo -e "\n${YELLOW}Building images...${NC}"
    
    # Build base image
    docker build -t "${IMAGE_PREFIX}/base:${TAG}" "${SCRIPT_DIR}/base" || test_fail "Failed to build base image"
    
    # Build language images
    for lang in python nodejs bash; do
        if [ -f "${SCRIPT_DIR}/${lang}/Dockerfile" ]; then
            docker build -t "${IMAGE_PREFIX}/${lang}:${TAG}" "${SCRIPT_DIR}/${lang}" || test_fail "Failed to build $lang image"
        fi
    done
fi

# Test each image
test_image "${IMAGE_PREFIX}/python:${TAG}" "python3 --version" "Python 3"
test_security "${IMAGE_PREFIX}/python:${TAG}" "python"
test_runtime "${IMAGE_PREFIX}/python:${TAG}" "python3"

test_image "${IMAGE_PREFIX}/nodejs:${TAG}" "node --version" "v20"
test_security "${IMAGE_PREFIX}/nodejs:${TAG}" "node"
test_runtime "${IMAGE_PREFIX}/nodejs:${TAG}" "node"

test_image "${IMAGE_PREFIX}/bash:${TAG}" "bash --version" "GNU bash"
test_security "${IMAGE_PREFIX}/bash:${TAG}" "bash"
test_runtime "${IMAGE_PREFIX}/bash:${TAG}" "bash"

# Summary
echo -e "\n================================"
echo "Test Summary:"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo "================================"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi