#!/bin/bash

# Create persistent named volumes for development
echo "Creating persistent Docker volumes for development..."

docker volume create cronium-valkey-dev-data
docker volume create cronium-orchestrator-dev-data

echo "Development volumes created successfully!"
echo "You can now run 'pnpm docker:up' or 'docker-compose -f infra/docker/docker-compose.dev.yml up' without creating new volumes each time."