#!/bin/bash

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

echo "Starting Cronium Agent..."

# Start the agent in the background
CRONIUM_API_ENDPOINT=http://localhost:5001/api/internal CRONIUM_API_TOKEN=test-token ./cronium-agent --config test-config.yaml > agent.log 2>&1 &
PID=$!

# Give it time to start
echo "Waiting for services to start..."
sleep 3

# Test health endpoint
echo -e "\nTesting /health endpoint:"
HEALTH_RESPONSE=$(curl -s localhost:8080/health 2>/dev/null)
if [ -n "$HEALTH_RESPONSE" ]; then
    echo "$HEALTH_RESPONSE" | jq . || echo "$HEALTH_RESPONSE"
else
    echo "Health server not responding"
fi

# Test liveness endpoint
echo -e "\nTesting /live endpoint:"
LIVE_RESPONSE=$(curl -s localhost:8080/live 2>/dev/null)
if [ -n "$LIVE_RESPONSE" ]; then
    echo "$LIVE_RESPONSE" | jq . || echo "$LIVE_RESPONSE"
else
    echo "Liveness endpoint not available"
fi

# Test ready endpoint
echo -e "\nTesting /ready endpoint:"
READY_RESPONSE=$(curl -s localhost:8080/ready 2>/dev/null)
if [ -n "$READY_RESPONSE" ]; then
    echo "$READY_RESPONSE" | jq . || echo "$READY_RESPONSE"
else
    echo "Readiness endpoint not available"
fi

# Check if agent is still running
if kill -0 $PID 2>/dev/null; then
    echo -e "\nAgent is running. Showing last few log lines:"
    tail -n 10 agent.log
else
    echo -e "\nAgent crashed. Full log:"
    cat agent.log
fi

# Clean up
echo -e "\nStopping agent..."
kill $PID 2>/dev/null
wait $PID 2>/dev/null

# Clean up log file
rm -f agent.log

echo "Test complete."