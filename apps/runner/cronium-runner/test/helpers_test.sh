#!/bin/bash
# Test script for runtime helpers functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(dirname "$SCRIPT_DIR")"
RUNNER_BIN="$RUNNER_DIR/cronium-runner"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

echo "=== Cronium Runner Helper Tests ==="
echo "Runner: $RUNNER_BIN"
echo ""

# Function to run a test
run_test() {
    local test_name="$1"
    local test_cmd="$2"
    local expected_output="$3"
    
    echo -n "Testing $test_name... "
    
    # Create temporary directory for test
    TEST_DIR=$(mktemp -d)
    cd "$TEST_DIR"
    
    # Run the test
    if output=$($test_cmd 2>&1); then
        if [[ "$output" == *"$expected_output"* ]]; then
            echo -e "${GREEN}PASSED${NC}"
            ((TESTS_PASSED++))
        else
            echo -e "${RED}FAILED${NC}"
            echo "  Expected: $expected_output"
            echo "  Got: $output"
            ((TESTS_FAILED++))
        fi
    else
        echo -e "${RED}FAILED (command error)${NC}"
        echo "  Error: $output"
        ((TESTS_FAILED++))
    fi
    
    # Cleanup
    cd - > /dev/null
    rm -rf "$TEST_DIR"
}

# Test 1: cronium.input() in bundled mode
create_input_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
input:
  name: "test"
  value: 42
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
name=$(cronium.input name)
value=$(cronium.input value)
echo "Name: $name, Value: $value"
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN"
}

run_test "cronium.input() bundled mode" \
    "$(create_input_test)" \
    "Name: test, Value: 42"

# Test 2: cronium.output() in bundled mode
create_output_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
cronium.output result "success"
cronium.output count 100
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN && cat output.json | jq -r '.result'"
}

run_test "cronium.output() bundled mode" \
    "$(create_output_test)" \
    "success"

# Test 3: cronium.getVariable() in bundled mode
create_getvar_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
variables:
  API_KEY: "secret123"
  DEBUG: "true"
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
api_key=$(cronium.getVariable API_KEY)
debug=$(cronium.getVariable DEBUG)
echo "API_KEY: $api_key, DEBUG: $debug"
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN"
}

run_test "cronium.getVariable() bundled mode" \
    "$(create_getvar_test)" \
    "API_KEY: secret123, DEBUG: true"

# Test 4: cronium.setVariable() in bundled mode
create_setvar_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
cronium.setVariable NEW_VAR "test_value"
cronium.setVariable COUNTER 42
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN && cat variables.json | jq -r '.NEW_VAR'"
}

run_test "cronium.setVariable() bundled mode" \
    "$(create_setvar_test)" \
    "test_value"

# Test 5: cronium.event() metadata access
create_event_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "event-123"
execution_id: "exec-456"
event_name: "Daily Backup"
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
event_id=$(cronium.event id)
event_name=$(cronium.event name)
echo "Event: $event_id - $event_name"
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN"
}

run_test "cronium.event() metadata" \
    "$(create_event_test)" \
    "Event: event-123 - Daily Backup"

# Test 6: Python script with helpers
create_python_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
input:
  items:
    - "apple"
    - "banana"
    - "cherry"
EOF

    cat > script.py << 'EOF'
#!/usr/bin/env python3
import subprocess
import json

# Get input
result = subprocess.run(['cronium.input', 'items'], capture_output=True, text=True)
items = json.loads(result.stdout)

# Process items
processed = [item.upper() for item in items]

# Set output
for i, item in enumerate(processed):
    subprocess.run(['cronium.output', f'item_{i}', item])

print(f"Processed {len(items)} items")
EOF
    chmod +x script.py

    echo "$RUNNER_BIN"
}

run_test "Python script with helpers" \
    "$(create_python_test)" \
    "Processed 3 items"

# Test 7: Error handling
create_error_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
# Try to get non-existent input
result=$(cronium.input nonexistent 2>&1 || true)
echo "$result"
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN"
}

run_test "Error handling for missing input" \
    "$(create_error_test)" \
    "not found"

# Test 8: Complex data types
create_complex_test() {
    cat > manifest.yaml << EOF
version: 1.0
event_id: "test-event"
execution_id: "test-exec"
input:
  config:
    host: "localhost"
    port: 8080
    settings:
      debug: true
      timeout: 30
EOF

    cat > script.sh << 'EOF'
#!/bin/bash
config=$(cronium.input config)
host=$(echo "$config" | jq -r '.host')
port=$(echo "$config" | jq -r '.port')
echo "Connecting to $host:$port"
EOF
    chmod +x script.sh

    echo "$RUNNER_BIN"
}

run_test "Complex data types" \
    "$(create_complex_test)" \
    "Connecting to localhost:8080"

# Summary
echo ""
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}Some tests failed!${NC}"
    exit 1
fi