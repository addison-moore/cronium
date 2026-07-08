#!/bin/bash

# Cronium Development Environment Setup Script

set -e

# Change to project root
cd "$(dirname "$0")/../.."

COMPOSE_FILE="infra/docker/docker-compose.dev.local-app.yml"

echo "🚀 Setting up Cronium development environment..."

# Check prerequisites
check_command() {
    if ! command -v $1 &>/dev/null; then
        echo "❌ $1 is not installed. Please install $1 first."
        exit 1
    fi
}

echo "📋 Checking prerequisites..."
check_command docker
check_command pnpm
check_command node
check_command go

# Create env/.env.local if it doesn't exist
if [ ! -f env/.env.local ]; then
    echo "📝 Creating env/.env.local from env/.env.example..."
    cp env/.env.example env/.env.local
    echo "✅ Created env/.env.local - Please update with your actual values"
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Build shared packages first
echo "📦 Building shared packages..."
pnpm build --filter @cronium/ui --filter @cronium/config-*

# The dev stack expects an existing PostgreSQL (local install, container, or
# hosted e.g. Neon) reachable at DATABASE_URL from env/.env.local.
echo "🗄️ Running database migrations (requires PostgreSQL at DATABASE_URL)..."
if (cd apps/cronium-app && pnpm db:push); then
    echo "✅ Database schema is up to date"
else
    echo "⚠️ Could not push schema. Make sure PostgreSQL is running and"
    echo "   DATABASE_URL in env/.env.local is correct, then re-run:"
    echo "   cd apps/cronium-app && pnpm db:push"
fi

# Build Runtime API
echo "🔨 Building Runtime API service..."
(cd apps/runtime/cronium-runtime && go mod download && go build -o ../runtime ./cmd/runtime)

# Build Orchestrator
echo "🔨 Building Orchestrator service..."
(cd apps/orchestrator && go mod download && go build -o orchestrator ./cmd/cronium-orchestrator)

# Build container images (orchestrator + runtime sidecar + executors)
echo "🐳 Building container images..."
docker compose -f "$COMPOSE_FILE" build runtime-api cronium-orchestrator
docker compose -f "$COMPOSE_FILE" --profile build-only build bash-executor nodejs-executor python-executor

# Seed database (optional)
read -p "Do you want to seed the database with sample data? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🌱 Seeding database..."
    (cd apps/cronium-app && pnpm seed)
fi

# Start supporting services (Valkey, orchestrator, runtime API)
echo "🚀 Starting supporting services..."
docker compose -f "$COMPOSE_FILE" up -d

# Show service status
echo "
✅ Development environment setup complete!

📊 Service Status:
"
docker compose -f "$COMPOSE_FILE" ps

echo "
🌐 Access Points:
- Main App: http://localhost:5001 (run 'pnpm dev' to start it)
- WebSocket: ws://localhost:5002
- Runtime API: http://localhost:8081
- Orchestrator: http://localhost:8080
- Valkey/Redis: redis://localhost:6379

📝 Next Steps:
1. Start the app: pnpm dev
2. Or start individually:
   - Next.js: pnpm dev:app
   - WebSocket: cd apps/cronium-app && pnpm dev:socket
3. View logs: docker compose -f $COMPOSE_FILE logs -f

🛠️ Useful Commands:
- Stop services: docker compose -f $COMPOSE_FILE down (or pnpm dev:docker:down)
- View logs: docker compose -f $COMPOSE_FILE logs [service-name]
- Restart service: docker compose -f $COMPOSE_FILE restart [service-name]
- Database studio: cd apps/cronium-app && pnpm db:studio
"
