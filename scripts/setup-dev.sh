#!/bin/bash

# Cronium Development Environment Setup Script

set -e

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

# Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local file..."
    cat >.env.local <<EOF
# Database
DATABASE_URL=postgresql://cronium:cronium@localhost:5432/cronium

# Authentication
AUTH_URL=http://localhost:5001
AUTH_SECRET=your-nextauth-secret-change-in-production

# Encryption
ENCRYPTION_KEY=your-32-character-encryption-key-change-this

# Services
ORCHESTRATOR_URL=http://localhost:8080
RUNTIME_API_URL=http://localhost:8081
INTERNAL_API_KEY=your-internal-api-key-change-in-production
JWT_SECRET=your-jwt-secret-change-in-production

# WebSocket
SOCKET_PORT=5002

# Valkey/Redis
VALKEY_URL=valkey://localhost:6379

# Email (optional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@cronium.local

# AI (optional)
OPENAI_API_KEY=
EOF
    echo "✅ Created .env.local - Please update with your actual values"
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Start infrastructure services
echo "🐳 Starting infrastructure services..."
docker-compose -f docker-compose.stack.yml up -d postgres valkey

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker exec cronium-postgres pg_isready -U cronium &>/dev/null; do
    echo -n "."
    sleep 1
done
echo " Ready!"

# Run database migrations
echo "🗄️ Running database migrations..."
pnpm db:push

# Apply migration scripts
echo "📊 Applying migration scripts..."
for migration in src/db/migrations/*.sql; do
    if [ -f "$migration" ] && [[ ! "$migration" == *"rollback"* ]]; then
        echo "Applying $(basename $migration)..."
        docker exec -i cronium-postgres psql -U cronium -d cronium <"$migration" || true
    fi
done

# Build Runtime API
echo "🔨 Building Runtime API service..."
(cd runtime/cronium-runtime && go mod download && go build -o runtime cmd/runtime/main.go)

# Build Orchestrator
echo "🔨 Building Orchestrator service..."
(cd orchestrator/cronium-orchestrator && go mod download && go build -o orchestrator cmd/cronium-agent/main.go)

# Build container images
echo "🐳 Building container images..."
docker-compose -f docker-compose.stack.yml build runtime-api orchestrator

# Seed database (optional)
read -p "Do you want to seed the database with sample data? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🌱 Seeding database..."
    pnpm tsx src/scripts/seed-all.ts
fi

# Start all services
echo "🚀 Starting all services..."
docker-compose -f docker-compose.stack.yml up -d

# Show service status
echo "
✅ Development environment setup complete!

📊 Service Status:
"
docker-compose -f docker-compose.stack.yml ps

echo "
🌐 Access Points:
- Main App: http://localhost:5001
- WebSocket: ws://localhost:5002
- Runtime API: http://localhost:8081
- Database: postgresql://localhost:5432/cronium
- Valkey/Redis: redis://localhost:6379

📝 Next Steps:
1. Start the Next.js dev server: pnpm dev
2. Start the WebSocket server: pnpm dev:socket
3. View logs: docker-compose -f docker-compose.stack.yml logs -f

🛠️ Useful Commands:
- Stop services: docker-compose -f docker-compose.stack.yml down
- View logs: docker-compose -f docker-compose.stack.yml logs [service-name]
- Restart service: docker-compose -f docker-compose.stack.yml restart [service-name]
- Database studio: pnpm db:studio
"
