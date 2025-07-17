#!/bin/bash

# Script for running Valkey and cronium-agent containers while running the app locally
# This allows for faster development by avoiding frequent Docker builds of the main app

# Load environment variables from .env file, ignoring shell variables
set -a
source .env
set +a

# Display helpful information
echo "Starting Valkey and cronium-agent containers..."
echo "Make sure to run 'pnpm dev' in a separate terminal to start the Next.js app locally"
echo ""
echo "The local app should have these environment variables set:"
echo "  VALKEY_URL=redis://localhost:6379"
echo "  ORCHESTRATOR_URL=http://localhost:8080"
echo ""

# Run docker compose with the local app configuration
exec docker compose -f docker-compose.dev.local-app.yml "$@"