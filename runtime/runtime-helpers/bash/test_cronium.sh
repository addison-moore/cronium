#!/bin/bash

# Unit tests for Cronium Bash SDK
#
# This script tests the cronium.sh functions using a mock API server
# Run with: bash test_cronium.sh

set -e

# Test configuration
TEST_DIR=$(dirname "$0")
CRONIUM_SH="$TEST_DIR/cronium.sh"
TEST_PORT=8899
MOCK_SERVER_PID=""

# Set test environment
export CRONIUM_RUNTIME_API="http://localhost:$TEST_PORT"
export CRONIUM_EXECUTION_TOKEN="test-token"
export CRONIUM_EXECUTION_ID="test-execution-id"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0

# Start mock server using netcat
start_mock_server() {
    # Create a simple HTTP server using Python (more reliable than netcat)
    cat > /tmp/mock_server.py << 'EOF'
#!/usr/bin/env python3
import http.server
import json
import sys
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1])

class MockHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        
        if path == "/executions/test-execution-id/input":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "data": {"test": "input"}}).encode())
        elif path == "/executions/test-execution-id/context":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "data": {"id": "event-123", "name": "Test Event"}}).encode())
        elif path.startswith("/executions/test-execution-id/variables/"):
            var_name = path.split('/')[-1]
            if var_name == "existing_var":
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "data": {"key": var_name, "value": "test_value"}}).encode())
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"message": "Variable not found"}).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"success": True}).encode())
    
    def do_PUT(self):
        self.do_POST()
    
    def log_message(self, format, *args):
        pass  # Suppress log output

with http.server.HTTPServer(('', PORT), MockHandler) as httpd:
    httpd.serve_forever()
EOF
    
    python3 /tmp/mock_server.py $TEST_PORT &
    MOCK_SERVER_PID=$!
    
    # Wait for server to start
    sleep 1
}

# Stop mock server
stop_mock_server() {
    if [ -n "$MOCK_SERVER_PID" ]; then
        kill $MOCK_SERVER_PID 2>/dev/null || true
        wait $MOCK_SERVER_PID 2>/dev/null || true
    fi
    rm -f /tmp/mock_server.py
}

# Trap to ensure cleanup
trap stop_mock_server EXIT

# Test assertion function
assert_equals() {
    local expected="$1"
    local actual="$2"
    local test_name="$3"
    
    ((TESTS_TOTAL++))
    
    if [ "$expected" = "$actual" ]; then
        echo -e "${GREEN}✓${NC} $test_name"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $test_name"
        echo -e "  Expected: $expected"
        echo -e "  Actual: $actual"
        ((TESTS_FAILED++))
    fi
}

assert_contains() {
    local needle="$1"
    local haystack="$2"
    local test_name="$3"
    
    ((TESTS_TOTAL++))
    
    if [[ "$haystack" == *"$needle"* ]]; then
        echo -e "${GREEN}✓${NC} $test_name"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $test_name"
        echo -e "  Expected to contain: $needle"
        echo -e "  Actual: $haystack"
        ((TESTS_FAILED++))
    fi
}

assert_success() {
    local exit_code="$1"
    local test_name="$2"
    
    ((TESTS_TOTAL++))
    
    if [ "$exit_code" -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $test_name"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $test_name (exit code: $exit_code)"
        ((TESTS_FAILED++))
    fi
}

# Run tests
run_tests() {
    echo "Starting Cronium Bash SDK tests..."
    echo
    
    # Start mock server
    start_mock_server
    
    # Source the SDK
    source "$CRONIUM_SH"
    
    # Test cronium_input
    echo "Testing cronium_input..."
    result=$(cronium_input)
    assert_contains '"test":"input"' "$result" "cronium_input returns data"
    
    # Test cronium_output
    echo -e "\nTesting cronium_output..."
    cronium_output '{"result": "success"}'
    assert_success $? "cronium_output with JSON data"
    
    cronium_output "plain text"
    assert_success $? "cronium_output with plain text"
    
    # Test cronium_get_variable
    echo -e "\nTesting cronium_get_variable..."
    result=$(cronium_get_variable "existing_var")
    assert_equals "test_value" "$result" "cronium_get_variable for existing variable"
    
    result=$(cronium_get_variable "missing_var" 2>/dev/null || echo "")
    assert_equals "" "$result" "cronium_get_variable for missing variable"
    
    # Test cronium_set_variable
    echo -e "\nTesting cronium_set_variable..."
    cronium_set_variable "new_var" "new_value"
    assert_success $? "cronium_set_variable with string value"
    
    cronium_set_variable "json_var" '{"nested": "object"}'
    assert_success $? "cronium_set_variable with JSON value"
    
    # Test cronium_set_condition
    echo -e "\nTesting cronium_set_condition..."
    cronium_set_condition true
    assert_success $? "cronium_set_condition with true"
    
    cronium_set_condition false
    assert_success $? "cronium_set_condition with false"
    
    cronium_set_condition yes
    assert_success $? "cronium_set_condition with yes"
    
    cronium_set_condition 1
    assert_success $? "cronium_set_condition with 1"
    
    # Test cronium_event
    echo -e "\nTesting cronium_event..."
    result=$(cronium_event)
    assert_contains '"id":"event-123"' "$result" "cronium_event returns context"
    
    # Test cronium_event_field
    echo -e "\nTesting cronium_event_field..."
    result=$(cronium_event_field "name")
    assert_equals "Test Event" "$result" "cronium_event_field returns specific field"
    
    # Test utility functions
    echo -e "\nTesting utility functions..."
    
    # Test cronium_variable_exists
    cronium_variable_exists "existing_var"
    assert_success $? "cronium_variable_exists for existing variable"
    
    ! cronium_variable_exists "missing_var" 2>/dev/null
    assert_success $? "cronium_variable_exists for missing variable"
    
    # Test cronium_info
    echo -e "\nTesting cronium_info..."
    info=$(cronium_info)
    assert_contains "Cronium Bash SDK" "$info" "cronium_info shows SDK version"
    assert_contains "API URL:" "$info" "cronium_info shows API URL"
    
    # Summary
    echo
    echo "================================="
    echo "Test Summary:"
    echo "Total: $TESTS_TOTAL"
    echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
    echo "================================="
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        return 0
    else
        echo -e "${RED}Some tests failed!${NC}"
        return 1
    fi
}

# Run the tests
run_tests