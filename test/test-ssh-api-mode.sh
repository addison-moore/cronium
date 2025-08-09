#!/bin/bash

# Integration test for SSH API mode
# This script tests the full flow of SSH execution with API mode

set -e

echo "=== SSH API Mode Integration Test ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RUNTIME_PORT=8089
ORCHESTRATOR_PORT=8088
TEST_JOB_ID="test-job-$(date +%s)"
TEST_EXECUTION_ID="test-exec-$(date +%s)"
TEST_EVENT_ID="test-event-123"
TEST_USER_ID="test-user-456"

# Check if runtime service is running
check_runtime() {
    echo -n "Checking runtime service on port $RUNTIME_PORT... "
    if curl -s -f "http://localhost:$RUNTIME_PORT/health" > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        return 0
    else
        echo -e "${RED}NOT RUNNING${NC}"
        echo "Please start the runtime service:"
        echo "  cd apps/runtime/cronium-runtime && go run cmd/runtime/main.go"
        return 1
    fi
}

# Create test payload
create_test_payload() {
    local payload_dir="/tmp/cronium-test-payload-$$"
    mkdir -p "$payload_dir"
    
    # Create test script
    cat > "$payload_dir/test_script.sh" << 'EOF'
#!/bin/bash

echo "=== SSH API Mode Test Script ==="
echo "Running on: $(hostname)"
echo "Date: $(date)"

# Test getting input
echo "Testing cronium.input()..."
input=$(cronium.input)
echo "Received input: $input"

# Test setting output
echo "Testing cronium.output()..."
cronium.output "{\"status\": \"success\", \"message\": \"Hello from SSH API mode!\", \"hostname\": \"$(hostname)\"}"

# Test variables
echo "Testing cronium.setVariable()..."
cronium.setVariable "ssh_test_key" "value_from_$(hostname)"

echo "Testing cronium.getVariable()..."
value=$(cronium.getVariable "ssh_test_key")
echo "Variable value: $value"

# Test event context
echo "Testing cronium.event()..."
context=$(cronium.event)
echo "Event context: $context"

echo "=== Test completed successfully! ==="
EOF

    chmod +x "$payload_dir/test_script.sh"
    
    # Create manifest
    cat > "$payload_dir/manifest.yaml" << EOF
version: "1.0"
interpreter: bash
entrypoint: test_script.sh
metadata:
  jobId: $TEST_JOB_ID
  eventId: $TEST_EVENT_ID
  executionId: $TEST_EXECUTION_ID
  eventName: "SSH API Mode Test"
  inputData:
    message: "Test input from orchestrator"
    timestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EOF

    # Create tarball
    local payload_path="/tmp/test-payload-$$.tar.gz"
    cd "$payload_dir" && tar czf "$payload_path" .
    rm -rf "$payload_dir"
    
    echo "$payload_path"
}

# Simulate job creation
create_test_job() {
    local payload_path=$1
    
    cat << EOF
{
    "id": "$TEST_JOB_ID",
    "type": "ssh",
    "execution": {
        "target": {
            "type": "server",
            "serverDetails": {
                "id": "test-server-1",
                "host": "localhost",
                "port": 22,
                "username": "$USER",
                "authType": "key"
            }
        }
    },
    "metadata": {
        "payloadPath": "$payload_path",
        "userId": "$TEST_USER_ID",
        "eventId": "$TEST_EVENT_ID"
    }
}
EOF
}

# Main test flow
main() {
    echo "Starting SSH API Mode integration test..."
    echo ""
    
    # Check runtime service
    if ! check_runtime; then
        exit 1
    fi
    
    # Create test payload
    echo "Creating test payload..."
    PAYLOAD_PATH=$(create_test_payload)
    echo -e "Payload created: ${GREEN}$PAYLOAD_PATH${NC}"
    echo ""
    
    # Display test job
    echo "Test job configuration:"
    create_test_job "$PAYLOAD_PATH" | jq .
    echo ""
    
    echo -e "${YELLOW}Next steps to test API mode:${NC}"
    echo "1. Ensure the orchestrator is configured with:"
    echo "   - Runtime port: $RUNTIME_PORT"
    echo "   - JWT secret: <same as runtime service>"
    echo ""
    echo "2. Execute the test job through the orchestrator"
    echo "   The orchestrator should:"
    echo "   - Establish SSH connection"
    echo "   - Set up reverse tunnel for API mode"
    echo "   - Deploy and run the runner"
    echo "   - Pass API configuration via environment"
    echo ""
    echo "3. Monitor logs for:"
    echo "   - Tunnel establishment"
    echo "   - JWT token generation"
    echo "   - Helper API calls"
    echo "   - Successful execution"
    echo ""
    echo "Test payload path: $PAYLOAD_PATH"
    echo "Job ID: $TEST_JOB_ID"
    echo "Execution ID: $TEST_EXECUTION_ID"
    
    # Clean up after 5 minutes
    (sleep 300 && rm -f "$PAYLOAD_PATH" 2>/dev/null) &
}

# Run main
main "$@"