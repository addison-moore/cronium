#!/bin/bash
# Deployment script for Cronium monorepo

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to project root
cd "$(dirname "$0")/../.."

echo -e "${GREEN}🚀 Starting Cronium deployment...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Build all services
echo -e "${YELLOW}📦 Building all services...${NC}"
pnpm build

# Build Go services
echo -e "${YELLOW}🔨 Building Go services...${NC}"
pnpm build:go

# Build Docker images
echo -e "${YELLOW}🐳 Building Docker images...${NC}"
docker-compose -f infra/docker/docker-compose.stack.yml build

# Deploy with Docker Compose
echo -e "${YELLOW}🚀 Deploying services...${NC}"
docker-compose -f infra/docker/docker-compose.stack.yml up -d

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
sleep 10

# Check service status
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Service Status:"
docker-compose -f infra/docker/docker-compose.stack.yml ps

echo ""
echo -e "${GREEN}🌐 Access Points:${NC}"
echo "- Main App: http://localhost:5001"
echo "- WebSocket: ws://localhost:5002"
echo "- Runtime API: http://localhost:8081"
echo "- Orchestrator: http://localhost:8080"
echo ""
echo -e "${YELLOW}📝 View logs:${NC} docker-compose -f infra/docker/docker-compose.stack.yml logs -f"