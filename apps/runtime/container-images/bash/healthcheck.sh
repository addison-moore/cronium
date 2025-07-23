#!/bin/bash
# Health check script for Bash Cronium container

set -e

# Check if cronium.sh exists and is executable
if [ ! -x /usr/local/bin/cronium.sh ]; then
    echo "Error: cronium.sh not found or not executable"
    exit 1
fi

# Check if required commands are available
for cmd in bash curl jq; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "Error: Required command '$cmd' not found"
        exit 1
    fi
done

# Check bash version (should be at least 4.0)
bash_version=$(bash --version | head -n1 | awk '{print $4}' | cut -d. -f1)
if [ "$bash_version" -lt 4 ]; then
    echo "Error: Bash version too old (found: $bash_version, need: 4+)"
    exit 1
fi

# Try to source the cronium script (without env vars it should still load)
if ! source /usr/local/bin/cronium.sh 2>/dev/null; then
    # If it fails due to missing env vars, that's OK for health check
    if [ $? -eq 1 ]; then
        # Check if the error is about missing env vars
        source_output=$(source /usr/local/bin/cronium.sh 2>&1 || true)
        if [[ "$source_output" == *"CRONIUM_EXECUTION_TOKEN"* ]] || [[ "$source_output" == *"CRONIUM_EXECUTION_ID"* ]]; then
            # This is expected in health check context
            true
        else
            echo "Error: Failed to source cronium.sh: $source_output"
            exit 1
        fi
    fi
fi

echo "Health check passed"
exit 0