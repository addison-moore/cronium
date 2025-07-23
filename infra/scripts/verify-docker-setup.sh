#!/bin/bash

# Verify Docker setup for Cronium
set -e

# Change to project root
cd "$(dirname "$0")/../.."

echo "🔍 Verifying Docker setup for Cronium monorepo..."
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
    "infra/docker/docker-compose.dev.yml"
    "infra/docker/docker-compose.stack.yml"
    "apps/cronium-app/Dockerfile"
    "apps/orchestrator/Dockerfile"
    "apps/orchestrator/Dockerfile.dev"
    "apps/orchestrator/.air.toml"
    "apps/runtime/cronium-runtime/Dockerfile"
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
        "NEXTAUTH_URL"
        "NEXTAUTH_SECRET"
        "ENCRYPTION_KEY"
        "JWT_SECRET"
        "INTERNAL_API_KEY"
        "ORCHESTRATOR_URL"
        "RUNTIME_API_URL"
        "NEXT_PUBLIC_APP_URL"
        "PUBLIC_APP_URL"
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
    echo "  💡 Run './infra/scripts/setup-env.sh' to create one"
    all_good=false
fi

# Check monorepo structure
echo ""
echo "📂 Checking monorepo structure..."

dirs=(
    "apps/cronium-app"
    "apps/orchestrator"
    "apps/runtime/cronium-runtime"
    "packages/ui"
    "packages/config-typescript"
    "packages/config-eslint"
    "packages/config-tailwind"
    "infra/docker"
    "infra/scripts"
)

for dir in "${dirs[@]}"; do
    if [ -d "$dir" ]; then
        echo "  ✅ $dir"
    else
        echo "  ❌ $dir (missing)"
        all_good=false
    fi
done

echo ""
if [ "$all_good" = true ]; then
    echo "✅ Everything looks good! You can run:"
    echo "   pnpm docker:up"
    echo ""
    echo "Or for development:"
    echo "   pnpm dev"
    echo ""
    echo "Manual Docker commands:"
    echo "   docker-compose -f infra/docker/docker-compose.stack.yml up"
else
    echo "❌ Some issues need to be fixed before running Docker containers"
    exit 1
fi