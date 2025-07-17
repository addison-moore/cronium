#!/bin/bash

# Script to run the index migration with proper environment setup

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "Running event relations index migration..."

# Check if running in Docker
if [ -f /.dockerenv ]; then
    echo "Running in Docker container"
    DATABASE_URL="${DATABASE_URL}"
else
    echo "Running locally"
    # Load environment from .env.local if it exists
    if [ -f .env.local ]; then
        export $(cat .env.local | grep DATABASE_URL | xargs)
    fi
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL is not set${NC}"
    echo "Please set DATABASE_URL environment variable or add it to .env.local"
    exit 1
fi

echo "Database URL: ${DATABASE_URL//:*@/:****@}"

# Run the standalone migration script
npx tsx src/scripts/migrations/add-event-relations-indexes-standalone.ts

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Migration completed successfully${NC}"
else
    echo -e "${RED}❌ Migration failed${NC}"
    exit 1
fi