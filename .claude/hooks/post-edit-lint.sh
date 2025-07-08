#!/bin/bash

# Post-edit lint check hook
# Suggests running lint after TypeScript/JavaScript modifications

FILE_PATH="${TOOL_PARAM_file_path}"
TOOL_NAME="${TOOL_NAME}"

# Only run for Edit/MultiEdit/Write tools on TS/JS files
if [[ "$TOOL_NAME" =~ (Edit|MultiEdit|Write) ]] && [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    # Check if file exists and is not empty
    if [ -f "$FILE_PATH" ] && [ -s "$FILE_PATH" ]; then
        # Run a quick syntax check
        if command -v node &> /dev/null; then
            # Use Node.js to parse the file for syntax errors
            node -c "$FILE_PATH" 2>/dev/null || {
                echo "⚠️  Syntax error detected in $FILE_PATH"
                echo "Consider reviewing the changes"
                exit 1
            }
        fi
        
        # Log the suggestion
        echo "✅ File modified successfully: $FILE_PATH"
        
        # If it's a test file, suggest running tests
        if [[ "$FILE_PATH" =~ (__tests__|\.test\.|\.spec\.) ]]; then
            echo "💡 Test file modified - consider running: pnpm test $FILE_PATH"
        fi
    fi
fi

exit 0