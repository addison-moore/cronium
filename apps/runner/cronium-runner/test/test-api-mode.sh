#!/bin/bash

# Test script to verify API mode functionality

set -e

echo "=== Testing Cronium Runner API Mode ==="

# Set up test environment
export CRONIUM_HELPER_MODE=api
export CRONIUM_API_ENDPOINT=http://localhost:8089
export CRONIUM_API_TOKEN="test-token"
export CRONIUM_EXECUTION_ID="test-exec-123"
export CRONIUM_JOB_ID="test-job-456"
export CRONIUM_EVENT_ID="test-event-789"

# Create test directory
TEST_DIR="/tmp/cronium-api-test"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/.cronium/bin"

# Copy helper binaries (assuming they're built)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(dirname "$SCRIPT_DIR")"

# Extract helpers for testing
cd "$TEST_DIR"

# Create a simple test script
cat > test_script.sh << 'EOF'
#!/bin/bash

echo "Testing Cronium API mode helpers..."

# Test input
echo "Getting input..."
input=$(cronium.input)
echo "Input: $input"

# Test output
echo "Setting output..."
cronium.output "Hello from API mode!"

# Test variables
echo "Setting variable..."
cronium.setVariable "test_key" "test_value"

echo "Getting variable..."
value=$(cronium.getVariable "test_key")
echo "Variable value: $value"

# Test event context
echo "Getting event context..."
context=$(cronium.event)
echo "Event context: $context"

echo "All tests completed!"
EOF

chmod +x test_script.sh

# Create a mock manifest
cat > manifest.yaml << EOF
version: "1.0"
interpreter: bash
entrypoint: test_script.sh
metadata:
  jobId: test-job-456
  eventId: test-event-789
  executionId: test-exec-123
  apiEndpoint: http://localhost:8089
  apiToken: test-token
EOF

echo "Test setup complete. To run the test:"
echo "1. Start the runtime service on port 8089"
echo "2. Run: cd $TEST_DIR && cronium-runner run ."
echo ""
echo "The test will attempt to use the API mode helpers to communicate with the runtime service."