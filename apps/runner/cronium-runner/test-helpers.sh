#!/bin/bash
set -e

echo "Testing Cronium Runner with Helpers..."

# Create test directory
TEST_DIR="/tmp/cronium-test-$(date +%s)"
mkdir -p "$TEST_DIR"

# Create test scripts
cat > "$TEST_DIR/test-bash.sh" << 'EOF'
#!/bin/bash
echo "Testing Bash runtime helpers..."

# Test cronium.event()
echo "Event context:"
cronium.event

# Test cronium.setVariable()
echo "Setting variable..."
cronium.setVariable "test_key" "test_value"

# Test cronium.getVariable()
echo "Getting variable..."
value=$(cronium.getVariable "test_key")
echo "Got value: $value"

# Test cronium.output()
echo "Setting output..."
echo '{"result": "success", "language": "bash"}' | cronium.output

echo "Bash test complete!"
EOF

cat > "$TEST_DIR/test-python.py" << 'EOF'
#!/usr/bin/env python3
print("Testing Python runtime helpers...")

# Test cronium.event()
print("Event context:")
print(cronium.event())

# Test cronium.setVariable()
print("Setting variable...")
cronium.setVariable("py_key", {"type": "python", "value": 42})

# Test cronium.getVariable()
print("Getting variable...")
value = cronium.getVariable("py_key")
print(f"Got value: {value}")

# Test cronium.output()
print("Setting output...")
cronium.output({"result": "success", "language": "python", "data": value})

print("Python test complete!")
EOF

cat > "$TEST_DIR/test-node.js" << 'EOF'
console.log("Testing Node.js runtime helpers...");

// Test cronium.event()
console.log("Event context:");
console.log(cronium.event());

// Test cronium.setVariable()
console.log("Setting variable...");
cronium.setVariable("node_key", {type: "node", value: [1, 2, 3]});

// Test cronium.getVariable()
console.log("Getting variable...");
const value = cronium.getVariable("node_key");
console.log("Got value:", value);

// Test cronium.output()
console.log("Setting output...");
cronium.output({result: "success", language: "node", data: value});

console.log("Node.js test complete!");
EOF

# Create test manifests
cat > "$TEST_DIR/manifest-bash.yaml" << EOF
version: v1
interpreter: bash
entrypoint: test-bash.sh
environment:
  TEST_ENV: "test_value"
metadata:
  eventId: "9999"
  eventVersion: 1
  createdAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  eventName: "Test Bash Event"
  executionId: "test-exec-bash"
  jobId: "test-job-bash"
EOF

cat > "$TEST_DIR/manifest-python.yaml" << EOF
version: v1
interpreter: python
entrypoint: test-python.py
environment:
  PYTHONPATH: "."
metadata:
  eventId: "9998"
  eventVersion: 1
  createdAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  eventName: "Test Python Event"
  executionId: "test-exec-python"
  jobId: "test-job-python"
EOF

cat > "$TEST_DIR/manifest-node.yaml" << EOF
version: v1
interpreter: node
entrypoint: test-node.js
environment:
  NODE_ENV: "test"
metadata:
  eventId: "9997"
  eventVersion: 1
  createdAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  eventName: "Test Node Event"
  executionId: "test-exec-node"
  jobId: "test-job-node"
EOF

# Create payloads
echo "Creating test payloads..."
for lang in bash python node; do
    PAYLOAD_DIR="$TEST_DIR/payload-$lang"
    mkdir -p "$PAYLOAD_DIR"
    
    cp "$TEST_DIR/test-$lang."* "$PAYLOAD_DIR/"
    cp "$TEST_DIR/manifest-$lang.yaml" "$PAYLOAD_DIR/manifest.yaml"
    
    tar -czf "$TEST_DIR/payload-$lang.tar.gz" -C "$PAYLOAD_DIR" .
    echo "Created payload-$lang.tar.gz"
done

# Run tests
echo ""
echo "Running tests..."
echo "================"

# Test Bash
echo ""
echo "Testing Bash..."
./cronium-runner run "$TEST_DIR/payload-bash.tar.gz" || true
echo ""

# Test Python
echo ""
echo "Testing Python..."
./cronium-runner run "$TEST_DIR/payload-python.tar.gz" || true
echo ""

# Test Node.js
echo ""
echo "Testing Node.js..."
./cronium-runner run "$TEST_DIR/payload-node.tar.gz" || true
echo ""

# Check results
echo "================"
echo "Checking results..."
echo ""

for lang in bash python node; do
    WORK_DIR="/tmp/cronium-work-*"
    LATEST_WORK=$(ls -dt $WORK_DIR 2>/dev/null | head -1)
    
    if [ -n "$LATEST_WORK" ]; then
        echo "Results for $lang:"
        
        if [ -f "$LATEST_WORK/.cronium/output.json" ]; then
            echo "Output:"
            cat "$LATEST_WORK/.cronium/output.json" | jq .
        fi
        
        if [ -f "$LATEST_WORK/.cronium/variables.json" ]; then
            echo "Variables:"
            cat "$LATEST_WORK/.cronium/variables.json" | jq .
        fi
        
        echo ""
    fi
done

# Cleanup
echo "Cleaning up test directory..."
rm -rf "$TEST_DIR"

echo "Test complete!"