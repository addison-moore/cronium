#!/bin/bash

# Change to project root
cd "$(dirname "$0")/../.."

# Load environment variables from .env file, ignoring shell variables
set -a
source .env
set +a

# Run docker compose with the .env values
exec docker compose -f infra/docker/docker-compose.dev.yml "$@"
