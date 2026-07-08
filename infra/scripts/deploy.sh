#!/bin/bash
# Deployment script for Cronium monorepo
#
# Builds the three Cronium images from source (same Dockerfiles the CI
# publish workflow uses, tagged with the same GHCR names) and starts the
# stack with Docker Compose. For image-pull-only deployments, follow
# docs/DOCKER_DEPLOYMENT.md instead.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to project root
cd "$(dirname "$0")/../.."

REGISTRY_PREFIX="${REGISTRY_PREFIX:-ghcr.io/addison-moore}"
TAG="${TAG:-latest}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

echo -e "${GREEN}🚀 Starting Cronium deployment...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# The compose file is the user's copy of docker-compose.example.yml
if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}❌ No $COMPOSE_FILE found.${NC}"
    echo "Create one from the example first:"
    echo "  cp docker-compose.example.yml docker-compose.yml"
    echo "and create a .env file with the required secrets (see docs/DOCKER_DEPLOYMENT.md)."
    exit 1
fi

if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found. The compose file expects AUTH_SECRET, ENCRYPTION_KEY,${NC}"
    echo -e "${YELLOW}   INTERNAL_API_KEY, JWT_SECRET, AUTH_URL and PUBLIC_APP_URL (see docs/DOCKER_DEPLOYMENT.md).${NC}"
fi

# Build Docker images from source
echo -e "${YELLOW}🐳 Building Docker images...${NC}"
docker build -f apps/cronium-app/Dockerfile -t "$REGISTRY_PREFIX/cronium-app:$TAG" .
docker build -f apps/orchestrator/Dockerfile -t "$REGISTRY_PREFIX/cronium-orchestrator:$TAG" .
docker build -f apps/runtime/cronium-runtime/Dockerfile -t "$REGISTRY_PREFIX/cronium-runtime:$TAG" apps/runtime/cronium-runtime

# Deploy with Docker Compose
echo -e "${YELLOW}🚀 Deploying services...${NC}"
docker compose -f "$COMPOSE_FILE" up -d

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
sleep 10

# Check service status
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Service Status:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo -e "${GREEN}🌐 Access Points:${NC}"
echo "- Main App: http://localhost:3000"
echo "- WebSocket: ws://localhost:5002"
echo "- Runtime API: http://localhost:8081"
echo "- Orchestrator: http://localhost:8080"
echo ""
echo -e "${YELLOW}📝 View logs:${NC} docker compose -f $COMPOSE_FILE logs -f"
