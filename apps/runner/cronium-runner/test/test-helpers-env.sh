#!/bin/bash

# Test runtime helpers with environment variables

set -e

echo "=== Testing Runtime Helpers with Environment Variables ==="

# Configuration
export CRONIUM_HELPER_MODE=api
export CRONIUM_API_ENDPOINT=http://localhost:8089
export CRONIUM_API_TOKEN=test-token-123
export CRONIUM_EXECUTION_ID=test-exec-$(date +%s)
export CRONIUM_JOB_ID=test-job-$(date +%s)
export CRONIUM_EVENT_ID=test-event-789

# Create test directory
TEST_DIR="/tmp/cronium-env-test-$$"
mkdir -p "$TEST_DIR/.cronium/bin"

# Build helpers for this machine
echo "Building runtime helpers..."
cd "$(dirname "$0")/.."
for dir in cmd/helpers/*/; do
    go build -tags nohelpers -o "$TEST_DIR/.cronium/bin/cronium.$(basename "$dir")" "./$dir"
done

echo "Setting up test environment..."
cd "$TEST_DIR"

# Add to PATH
export PATH="$TEST_DIR/.cronium/bin:$PATH"

# Create test script
cat > test.sh << 'EOF'
#!/bin/bash

echo "Environment variables:"
env | grep CRONIUM_ | sort

echo ""
echo "Testing helpers..."

# Test input
echo -n "Testing cronium.input... "
if output=$(cronium.input 2>&1); then
    echo "OK"
    echo "Response: $output"
else
    echo "FAILED"
    echo "Error: $output"
fi

# Test output
echo -n "Testing cronium.output... "
if cronium.output '{"test": "data from env mode"}' 2>&1; then
    echo "OK"
else
    echo "FAILED"
fi

# Test setVariable
echo -n "Testing cronium.setVariable... "
if cronium.setVariable "env_test_key" "env_test_value" 2>&1; then
    echo "OK"
else
    echo "FAILED"
fi

# Test getVariable
echo -n "Testing cronium.getVariable... "
if output=$(cronium.getVariable "env_test_key" 2>&1); then
    echo "OK"
    echo "Response: $output"
else
    echo "FAILED"
fi

# Test event
echo -n "Testing cronium.event... "
if output=$(cronium.event 2>&1); then
    echo "OK"
    echo "Response: $output"
else
    echo "FAILED"
fi

echo ""
echo "Test completed!"
EOF

chmod +x test.sh

# Create manifest (minimal, since we're using env vars)
cat > manifest.yaml << EOF
version: "1.0"
interpreter: bash
entrypoint: test.sh
metadata:
  jobId: $CRONIUM_JOB_ID
  eventId: $CRONIUM_EVENT_ID
  executionId: $CRONIUM_EXECUTION_ID
EOF

echo ""
echo "Test setup complete!"
echo "Working directory: $TEST_DIR"
echo ""
echo "To run the test:"
echo "1. Start the runtime service on port 8089"
echo ""
echo "2. Run the test script:"
echo "   cd $TEST_DIR && ./test.sh"
echo ""
echo "The helpers should use the environment variables for API mode configuration."