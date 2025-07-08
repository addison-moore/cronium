#!/bin/bash

# Pre-commit check hook for Claude Code
# This hook runs before file modifications to ensure code quality

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the file being modified
FILE_PATH="${TOOL_PARAM_file_path}"

# Function to check if file is TypeScript/JavaScript
is_ts_js_file() {
    [[ "$1" =~ \.(ts|tsx|js|jsx)$ ]]
}

# Function to check if file is in test directory
is_test_file() {
    [[ "$1" =~ (__tests__|\.test\.|\.spec\.) ]]
}

# Main checks
if is_ts_js_file "$FILE_PATH"; then
    echo -e "${YELLOW}📋 Running pre-modification checks for: $FILE_PATH${NC}"
    
    # Check if there are existing linting errors for this file
    if [ -f "lint.log" ]; then
        if grep -q "^\./$FILE_PATH" lint.log 2>/dev/null; then
            echo -e "${YELLOW}⚠️  Warning: This file has existing linting errors${NC}"
            echo "Consider running: pnpm lint $FILE_PATH"
        fi
    fi
    
    # Check if it's a test file being modified
    if is_test_file "$FILE_PATH"; then
        echo -e "${YELLOW}🧪 Modifying test file - remember to run tests after changes${NC}"
    fi
    
    # Check for package.json modifications
    if [[ "$FILE_PATH" == "package.json" ]]; then
        echo -e "${YELLOW}📦 package.json modification detected${NC}"
        echo "Remember to run: pnpm install"
    fi
fi

# Always allow the modification to proceed
exit 0