#!/bin/bash
set -e

# Executor container entrypoint script

# Function to handle signals
handle_signal() {
    echo "Received signal, cleaning up..."
    # Kill any running processes
    if [ ! -z "$SCRIPT_PID" ]; then
        kill -TERM "$SCRIPT_PID" 2>/dev/null || true
    fi
    exit 0
}

# Set up signal handlers
trap handle_signal SIGTERM SIGINT

# Validate environment
if [ -z "$EXECUTOR_ID" ]; then
    echo "Error: EXECUTOR_ID not set"
    exit 1
fi

echo "Executor container started with ID: $EXECUTOR_ID"
echo "Node.js version: $(node --version)"
echo "Python version: $(python3 --version)"

# If EXECUTE_SCRIPT is provided, run it immediately
if [ ! -z "$EXECUTE_SCRIPT" ]; then
    echo "Executing script: $EXECUTE_SCRIPT"
    
    # Determine script type and execute
    case "$EXECUTE_SCRIPT" in
        *.js)
            node "$EXECUTE_SCRIPT" &
            SCRIPT_PID=$!
            ;;
        *.py)
            python3 "$EXECUTE_SCRIPT" &
            SCRIPT_PID=$!
            ;;
        *.sh)
            bash "$EXECUTE_SCRIPT" &
            SCRIPT_PID=$!
            ;;
        *)
            # Default to bash if no extension
            bash -c "$EXECUTE_SCRIPT" &
            SCRIPT_PID=$!
            ;;
    esac
    
    # Wait for the script to complete
    wait $SCRIPT_PID
    exit_code=$?
    echo "Script completed with exit code: $exit_code"
    exit $exit_code
fi

# If no script provided, run the command passed to docker run
exec "$@"