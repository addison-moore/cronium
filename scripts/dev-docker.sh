#!/bin/bash

# Load environment variables from .env file, ignoring shell variables
set -a
source .env
set +a

# Run docker compose with the .env values
exec docker compose -f docker-compose.dev.yml "$@"
