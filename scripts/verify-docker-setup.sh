#!/bin/bash

# Verify Docker setup for Cronium
set -e

echo "🔍 Verifying Docker setup for Cronium..."
echo ""

# Check Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker daemon is not running"
    exit 1
fi
echo "✅ Docker is installed and running"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi
echo "✅ Docker Compose is available"

# Check required files
echo ""
echo "📁 Checking required files..."

files=(
    "docker-compose.dev.yml"
    "Dockerfile"
    "orchestrator/cronium-orchestrator/Dockerfile"
    "orchestrator/cronium-orchestrator/Dockerfile.dev"
    "orchestrator/cronium-orchestrator/.air.toml"
    "orchestrator/cronium-orchestrator/configs/cronium-orchestrator.yaml"
    ".env.local"
)

all_good=true
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ $file (missing)"
        all_good=false
    fi
done

# Check environment variables
echo ""
echo "🔐 Checking environment variables..."

if [ -f ".env.local" ]; then
    required_vars=(
        "DATABASE_URL"
        "AUTH_SECRET"
        "AUTH_URL"
        "ENCRYPTION_KEY"
        "JWT_SECRET"
        "INTERNAL_API_KEY"
    )
    
    for var in "${required_vars[@]}"; do
        if grep -q "^${var}=" .env.local; then
            echo "  ✅ $var is set"
        else
            echo "  ❌ $var is not set"
            all_good=false
        fi
    done
else
    echo "  ❌ .env.local file not found"
    all_good=false
fi

echo ""
if [ "$all_good" = true ]; then
    echo "✅ Everything looks good! You can run:"
    echo "   pnpm dev:docker"
    echo ""
    echo "Or manually:"
    echo "   docker-compose -f docker-compose.dev.yml up"
else
    echo "❌ Some issues need to be fixed before running Docker containers"
    exit 1
fi