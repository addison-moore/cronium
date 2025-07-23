#!/bin/bash

# Cronium Secret Management Setup Script

set -e

echo "🔐 Setting up Cronium secrets..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to generate secure random strings
generate_secret() {
    local length=$1
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to generate hex strings
generate_hex() {
    local length=$1
    openssl rand -hex $((length / 2))
}

# Check if .env exists
if [ -f .env ]; then
    echo -e "${YELLOW}Warning: .env file already exists${NC}"
    read -p "Do you want to backup and regenerate secrets? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
        echo -e "${GREEN}Backup created${NC}"
    else
        echo "Exiting without changes"
        exit 0
    fi
fi

# Copy from example if .env doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}Created .env from .env.example${NC}"
    else
        echo -e "${RED}Error: .env.example not found${NC}"
        exit 1
    fi
fi

echo "🎲 Generating secure secrets..."

# Generate secrets
AUTH_SECRET=$(generate_secret 32)
ENCRYPTION_KEY=$(generate_hex 32)
JWT_SECRET=$(generate_secret 32)
INTERNAL_API_KEY=$(generate_secret 32)
POSTGRES_PASSWORD=$(generate_secret 24)

# Update .env file
echo "📝 Updating .env file..."

# Function to update or add environment variable
update_env() {
    local key=$1
    local value=$2

    if grep -q "^${key}=" .env; then
        # Use | as delimiter to avoid issues with / in base64
        sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
    else
        echo "${key}=${value}" >>.env
    fi
}

# Update secrets in .env
update_env "AUTH_SECRET" "$AUTH_SECRET"
update_env "ENCRYPTION_KEY" "$ENCRYPTION_KEY"
update_env "JWT_SECRET" "$JWT_SECRET"
update_env "INTERNAL_API_KEY" "$INTERNAL_API_KEY"
update_env "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"

# Remove backup files
rm -f .env.bak

echo -e "${GREEN}✅ Secrets generated and saved to .env${NC}"

# Create secrets directory for Docker secrets (optional)
mkdir -p secrets

# Save secrets as Docker secret files (optional)
echo "$AUTH_SECRET" >secrets/AUTH_SECRET
echo "$ENCRYPTION_KEY" >secrets/encryption_key
echo "$JWT_SECRET" >secrets/jwt_secret
echo "$INTERNAL_API_KEY" >secrets/internal_api_key
echo "$POSTGRES_PASSWORD" >secrets/postgres_password

chmod 600 secrets/*

echo -e "${GREEN}✅ Docker secret files created in ./secrets/${NC}"

# Display summary
echo
echo "📊 Secret Generation Summary:"
echo "=============================="
echo "AUTH_SECRET: ${#AUTH_SECRET} characters"
echo "ENCRYPTION_KEY: ${#ENCRYPTION_KEY} characters"
echo "JWT_SECRET: ${#JWT_SECRET} characters"
echo "INTERNAL_API_KEY: ${#INTERNAL_API_KEY} characters"
echo "POSTGRES_PASSWORD: ${#POSTGRES_PASSWORD} characters"
echo
echo -e "${YELLOW}⚠️  Important Security Notes:${NC}"
echo "1. Never commit .env or secrets/ to version control"
echo "2. Add .env and secrets/ to .gitignore"
echo "3. Use different secrets for each environment"
echo "4. Rotate secrets regularly"
echo "5. Consider using a secrets management tool in production"
echo
echo -e "${GREEN}✅ Setup complete!${NC}"
