#!/bin/bash
set -e

echo "Creating simple test payload..."

# Create test directory
TEST_DIR="/tmp/cronium-simple-test"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

# Create simple test script
cat > "$TEST_DIR/test.sh" << 'EOF'
#!/bin/bash
echo "Testing runtime helpers..."

# Get event info
echo "Event context:"
cronium.event || echo "Failed to get event context"

# Set and get a variable
echo "Setting variable..."
cronium.setVariable "mykey" "myvalue" || echo "Failed to set variable"

echo "Getting variable..."
value=$(cronium.getVariable "mykey" || echo "Failed")
echo "Got value: $value"

# Set output
echo "Setting output..."
echo '{"status": "success"}' | cronium.output || echo "Failed to set output"

echo "Test complete!"
EOF

# Create manifest
cat > "$TEST_DIR/manifest.yaml" << EOF
version: v1
interpreter: bash
entrypoint: test.sh
metadata:
  eventId: "123"
  eventVersion: 1
  createdAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  eventName: "Simple Test"
EOF

# Create payload
cd "$TEST_DIR"
tar -czf payload.tar.gz test.sh manifest.yaml
cd -

# Run test
echo "Running test..."
/Users/addison/Code/cronium/cronium/apps/runner/cronium-runner/cronium-runner run "$TEST_DIR/payload.tar.gz"

# Check output
echo ""
echo "Checking output files..."
WORK_DIR=$(ls -dt /tmp/cronium-work-* 2>/dev/null | head -1)
if [ -n "$WORK_DIR" ]; then
    echo "Work directory: $WORK_DIR"
    
    if [ -f "$WORK_DIR/.cronium/output.json" ]; then
        echo "Output data:"
        cat "$WORK_DIR/.cronium/output.json"
    fi
    
    if [ -f "$WORK_DIR/.cronium/variables.json" ]; then
        echo "Variables:"
        cat "$WORK_DIR/.cronium/variables.json"
    fi
fi

# Cleanup
rm -rf "$TEST_DIR"