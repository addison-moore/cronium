#!/bin/bash

# Script for running Valkey and cronium-agent containers while running the app locally
# This allows for faster development by avoiding frequent Docker builds of the main app

# Change to project root
cd "$(dirname "$0")/../.."

# Load environment variables from env/.env.local file if it exists
if [ -f env/.env.local ]; then
    set -a
    source env/.env.local
    set +a
elif [ -f env/.env ]; then
    set -a
    source env/.env
    set +a
else
    echo "Warning: No env/.env.local or env/.env file found. Some environment variables may be missing."
fi

# Display helpful information
echo "Starting Valkey and cronium-agent containers..."
echo "Make sure to run 'pnpm dev' in a separate terminal to start the Next.js app locally"
echo ""
echo "The local app should have these environment variables set:"
echo "  VALKEY_URL=redis://localhost:6379"
echo "  ORCHESTRATOR_URL=http://localhost:8080"
echo ""

# Run docker compose with the local app configuration
# If no arguments provided, default to "up"
if [ $# -eq 0 ]; then
    exec docker compose -f infra/docker/docker-compose.dev.local-app.yml up
else
    exec docker compose -f infra/docker/docker-compose.dev.local-app.yml "$@" --build
fi