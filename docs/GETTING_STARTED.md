# Getting Started with Cronium Development

This guide will help you set up a minimal development environment for Cronium and run the development Docker containers.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Docker Desktop** (version 20.10 or higher)
  - [Download for Mac](https://www.docker.com/products/docker-desktop/)
  - [Download for Windows](https://www.docker.com/products/docker-desktop/)
  - [Download for Linux](https://docs.docker.com/desktop/install/linux-install/)
- **Docker Compose** (usually included with Docker Desktop)
- **Git** for cloning the repository
- **A text editor** (VS Code, Sublime Text, etc.)

### Required System Resources

- At least 4GB of free RAM
- 10GB of free disk space
- Ports 5001, 5002, and 6379 available

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/cronium.git
cd cronium
```

### 2. Set Up Your Development Environment

#### Create the development environment file:

```bash
# Copy the development environment example
cp .env.dev.example .env.dev
```

#### Generate secure secrets:

Run these commands to generate secure values for your environment:

```bash
# Generate AUTH_SECRET
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env.dev

# Generate ENCRYPTION_KEY
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env.dev

# Generate INTERNAL_API_KEY
echo "INTERNAL_API_KEY=$(openssl rand -base64 32)" >> .env.dev

# Generate JWT_SECRET
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env.dev
```

### 3. Configure Your Database

The development environment expects an external PostgreSQL database. You have two options:

#### Option A: Use a Local PostgreSQL Instance

If you have PostgreSQL installed locally, update the `DATABASE_URL` in `.env.dev`:

```bash
DATABASE_URL=postgresql://your_user:your_password@host.docker.internal:5432/cronium_dev
```

Note: `host.docker.internal` allows Docker containers to connect to your host machine.

#### Option B: Use a Cloud PostgreSQL Service

For services like Neon, Supabase, or AWS RDS, use the provided connection string:

```bash
DATABASE_URL=postgresql://user:password@host.neon.tech:5432/cronium_dev?sslmode=require
```

### 4. Configure Optional Services

Edit `.env.dev` to configure optional services:

```bash
# For email functionality (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
SMTP_FROM_EMAIL=noreply@your-domain.com

# For AI features (optional)
OPENAI_API_KEY=sk-your-openai-api-key
```

### 5. Start the Development Environment

```bash
# Start all services in development mode
docker-compose -f docker-compose.dev.yml --env-file .env.dev up -d

# Or use the npm script (if available)
npm run dev:docker
```

This will start:

- **cronium-app-dev**: Next.js application with hot reloading on port 5001
- **cronium-agent-dev**: Orchestrator service with Air (Go hot reloading)
- **valkey**: Redis-compatible cache/queue service

### 6. Verify Services are Running

Check that all services are healthy:

```bash
docker-compose -f docker-compose.dev.yml ps
```

You should see all services with "Up" status.

### 7. Access the Application

- **Web Application**: http://localhost:5001
- **WebSocket Server**: http://localhost:5002
- **Orchestrator Health**: http://localhost:8080/health

## Development Workflow

### Hot Reloading

Both the Next.js app and Go orchestrator support hot reloading:

- **Next.js**: Changes to files in `/src` automatically trigger rebuilds
- **Go Orchestrator**: Air watches for changes in `/orchestrator` and restarts the service

### Viewing Logs

```bash
# View all logs
docker-compose -f docker-compose.dev.yml logs -f

# View specific service logs
docker-compose -f docker-compose.dev.yml logs -f cronium-app-dev
docker-compose -f docker-compose.dev.yml logs -f cronium-agent-dev
```

### Stopping Services

```bash
# Stop all services
docker-compose -f docker-compose.dev.yml down

# Stop and remove volumes (clean slate)
docker-compose -f docker-compose.dev.yml down -v
```

## Common Development Tasks

### Running Database Migrations

```bash
# Execute in the app container
docker-compose -f docker-compose.dev.yml exec cronium-app-dev npm run db:push
```

### Accessing the Database Studio

```bash
# Open Drizzle Studio
docker-compose -f docker-compose.dev.yml exec cronium-app-dev npm run db:studio
```

### Running Tests

```bash
# Run tests in the container
docker-compose -f docker-compose.dev.yml exec cronium-app-dev npm test
```

### Installing New Dependencies

```bash
# Install npm packages
docker-compose -f docker-compose.dev.yml exec cronium-app-dev npm install package-name

# Install Go modules
docker-compose -f docker-compose.dev.yml exec cronium-agent-dev go get package-name
```

## Troubleshooting

### Port Already in Use

If you get a "port already allocated" error:

```bash
# Find what's using port 5001
lsof -i :5001  # On Mac/Linux
netstat -ano | findstr :5001  # On Windows

# Kill the process or change the port in .env.dev
APP_PORT=5003  # Use a different port
```

### Database Connection Issues

1. Verify your database is accessible:

   ```bash
   # Test connection from your host
   psql -h localhost -U your_user -d cronium_dev
   ```

2. For local databases, ensure PostgreSQL is configured to accept connections:
   - Check `postgresql.conf` for `listen_addresses = '*'`
   - Check `pg_hba.conf` for appropriate access rules

### Container Won't Start

1. Check logs for specific errors:

   ```bash
   docker-compose -f docker-compose.dev.yml logs cronium-app-dev
   ```

2. Verify environment variables:

   ```bash
   docker-compose -f docker-compose.dev.yml config
   ```

3. Ensure Docker has enough resources:
   - Docker Desktop → Settings → Resources
   - Allocate at least 4GB RAM

### Hot Reloading Not Working

1. Verify volume mounts are correct:

   ```bash
   docker-compose -f docker-compose.dev.yml exec cronium-app-dev ls -la /app
   ```

2. Check file permissions:
   ```bash
   # Fix permissions if needed
   chmod -R 755 ./src
   chmod -R 755 ./orchestrator
   ```

## Environment Variables Reference

See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) for a complete list of available environment variables.

### Key Development Variables

| Variable           | Purpose                      | Required    |
| ------------------ | ---------------------------- | ----------- |
| `DATABASE_URL`     | PostgreSQL connection string | Yes         |
| `AUTH_SECRET`      | Session encryption           | Yes         |
| `ENCRYPTION_KEY`   | Data encryption              | Yes         |
| `INTERNAL_API_KEY` | Service-to-service auth      | Yes         |
| `JWT_SECRET`       | JWT token signing            | Yes         |
| `NODE_ENV`         | Set to "development"         | Yes         |
| `LOG_LEVEL`        | Set to "debug" for dev       | Recommended |

## Next Steps

1. **Create your first event**: Navigate to http://localhost:5001/dashboard/events
2. **Set up a server**: Add a local or SSH server for running events
3. **Explore the codebase**:
   - `/src` - Next.js application code
   - `/orchestrator` - Go orchestrator service
   - `/docs` - Additional documentation

## Getting Help

- Check the [troubleshooting guide](#troubleshooting) above
- Review logs for error messages
- Consult the [full documentation](./README.md)
- Open an issue on GitHub

## Additional Resources

- [Architecture Overview](./ARCHITECTURE.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [API Documentation](./API.md)
- [Security Considerations](./SECURITY.md)
