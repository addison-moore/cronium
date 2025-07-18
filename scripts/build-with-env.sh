#!/bin/bash
# Script to build with a specific env file

# Backup existing .env.local if it exists
if [ -f .env.local ]; then
  mv .env.local .env.local.backup
fi

# Copy .env.build to .env.local
cp .env.build .env.local

# Run the build
pnpm build

# Restore original .env.local
if [ -f .env.local.backup ]; then
  mv .env.local.backup .env.local
else
  rm .env.local
fi