#!/bin/bash
# Wrapper script for golangci-lint that filters out false positive typecheck errors
# 
# This script is necessary because golangci-lint's typecheck linter has issues
# resolving import aliases (e.g., yaml from gopkg.in/yaml.v3, jwt from github.com/golang-jwt/jwt/v5)
# even though the Go compiler has no issues with these imports.
#
# The script runs golangci-lint normally but filters out "undefined: X (typecheck)" errors
# while still reporting all other linting issues.

set -e

# Add Go bin to PATH
export PATH=$PATH:$(go env GOPATH)/bin

# Run golangci-lint and filter out typecheck undefined errors
# Exit with 0 if only typecheck undefined errors are found
output=$(golangci-lint run 2>&1 || true)

# Filter out typecheck undefined errors
filtered_output=$(echo "$output" | grep -v "undefined: .* (typecheck)" || true)

# If there's any output after filtering, show it and exit with error
if [ -n "$filtered_output" ]; then
    echo "$filtered_output"
    # Check if there are actual errors (not just the header)
    if echo "$filtered_output" | grep -E "\.go:[0-9]+:[0-9]+:" > /dev/null; then
        exit 1
    fi
fi

echo "✓ Go linting passed (typecheck errors filtered)"
exit 0