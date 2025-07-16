#!/bin/bash

# Script to set up .env file for development
# This creates a .env file with secure random values for secrets

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up Cronium development environment...${NC}"

# Check if .env already exists
if [ -f .env ]; then
    echo -e "${YELLOW}Warning: .env file already exists.${NC}"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Setup cancelled.${NC}"
        exit 1
    fi
fi

# Function to generate secure random strings
generate_secret() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

generate_hex_key() {
    openssl rand -hex 32
}

# Generate secure values
AUTH_SECRET=$(generate_secret)
ENCRYPTION_KEY=$(generate_hex_key)
INTERNAL_API_KEY=$(generate_secret)
JWT_SECRET=$(generate_secret)
POSTGRES_PASSWORD=$(generate_secret)

# Create .env file
cat > .env << EOF
# Cronium Development Environment Configuration
# Generated on $(date)

# ============================================
# REQUIRED VARIABLES
# ============================================

# Build Configuration
BUILD_VERSION=latest
NODE_ENV=development
LOG_LEVEL=debug

# Database Configuration (for local development)
DATABASE_URL=postgresql://postgres:localdev123@localhost:5432/cronium_dev
POSTGRES_USER=postgres
POSTGRES_PASSWORD=localdev123
POSTGRES_DB=cronium_dev
POSTGRES_PORT=5432
POSTGRES_MAX_CONNECTIONS=100
DB_SSL_MODE=disable

# Authentication & Security
AUTH_URL=http://localhost:5001
AUTH_SECRET=${AUTH_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Internal Service Authentication
INTERNAL_API_KEY=${INTERNAL_API_KEY}
JWT_SECRET=${JWT_SECRET}

# Service Configuration
ORCHESTRATOR_ID=dev-orchestrator-01
MAX_CONCURRENT_JOBS=10
JOB_POLL_INTERVAL=5s

# Service Ports
APP_PORT=5001
SOCKET_PORT=5002
VALKEY_PORT=6379

# WebSocket Configuration (for client-side)
SOCKET_URL=http://localhost:5002

# Public App URL
PUBLIC_APP_URL=http://localhost:5001

# Valkey/Redis Configuration
VALKEY_MAX_MEMORY=256mb
VALKEY_URL=valkey://localhost:6379

# ============================================
# OPTIONAL VARIABLES
# ============================================

# Email Configuration (optional for development)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=

# AI Configuration (optional)
OPENAI_API_KEY=

# External Monitoring (optional)
PROMETHEUS_URL=
GRAFANA_URL=

# Docker Registry (optional - for private images)
DOCKER_REGISTRY=
DOCKER_USERNAME=
DOCKER_PASSWORD=
EOF

echo -e "${GREEN}✅ .env file created successfully!${NC}"
echo
echo -e "${YELLOW}Important: The following secure values have been generated:${NC}"
echo -e "  AUTH_SECRET: ${AUTH_SECRET:0:10}..."
echo -e "  ENCRYPTION_KEY: ${ENCRYPTION_KEY:0:10}..."
echo -e "  INTERNAL_API_KEY: ${INTERNAL_API_KEY:0:10}..."
echo -e "  JWT_SECRET: ${JWT_SECRET:0:10}..."
echo
echo -e "${GREEN}Next steps:${NC}"
echo "1. Update DATABASE_URL if using a different database"
echo "2. Add your OPENAI_API_KEY if using AI features"
echo "3. Configure SMTP settings if using email features"
echo "4. Run 'docker-compose -f docker-compose.dev.yml up' to start services"