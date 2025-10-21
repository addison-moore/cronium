# Cronium Deployment Guide

This guide covers deploying Cronium using Docker Compose in various environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Deployment](#development-deployment)
- [Production Deployment](#production-deployment)
- [Configuration](#configuration)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB RAM minimum (8GB recommended)
- 20GB disk space
- Linux/macOS/Windows with WSL2

## Quick Start

1. **Clone the repository**:

   ```bash
   git clone https://github.com/addison-moore/cronium.git
   cd cronium
   ```

2. **Set up environment**:

   ```bash
   # Copy environment template
   cp .env.example .env

   # Generate secure secrets
   ./scripts/setup-secrets.sh
   ```

3. **Start services**:

   ```bash
   # Production mode (includes PostgreSQL)
   docker-compose up -d

   # Development mode (requires external PostgreSQL)
   pnpm dev:docker
   ```

4. **Access Cronium**:
   - Main App: http://localhost:5001
   - Jobs Dashboard: http://localhost:5001/dashboard/jobs
   - WebSocket: ws://localhost:5002

## Development Deployment

### Using Docker Compose

```bash
# Start development services (uses external PostgreSQL)
pnpm dev:docker

# Or manually:
docker-compose -f docker-compose.dev.yml up

# If you need PostgreSQL included:
docker-compose up postgres valkey

# Then run app locally
pnpm install
pnpm dev
```

### Development Features

- Hot reload for all services
- Verbose logging
- Uses external PostgreSQL (configure DATABASE_URL)

### Using the Setup Script

For automated setup:

```bash
./scripts/setup-dev.sh
```

This script will:

- Check prerequisites
- Create `.env.local`
- Install dependencies
- Start infrastructure services
- Run database migrations
- Build container images
- Optionally seed the database

## Production Deployment

### Basic Production Setup

1. **Configure environment**:

   ```bash
   # Generate production secrets
   ./scripts/setup-secrets.sh

   # Edit production values
   vim .env
   ```

2. **Build images**:

   ```bash
   docker-compose build --no-cache
   ```

3. **Start services**:
   ```bash
   docker-compose up -d
   ```

### Using Docker Secrets

For enhanced security:

```bash
# Generate secret files
./scripts/setup-secrets.sh

# Deploy with Docker secrets
docker-compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
```

### Production Checklist

- [ ] Generate strong secrets (32+ characters)
- [ ] Configure proper database credentials
- [ ] Set up SSL/TLS termination
- [ ] Configure firewall rules
- [ ] Enable monitoring
- [ ] Set up backup procedures
- [ ] Configure log rotation
- [ ] Set resource limits

## Configuration

### Service Configuration

Each service can be configured via:

1. **Environment variables** (see [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md))
2. **Configuration files**:
   - `orchestrator/cronium-orchestrator/configs/cronium-orchestrator.yaml`

### Network Configuration

Services communicate via internal Docker network:

- Network: `cronium-network`
- Subnet: `172.20.0.0/16`

### Volume Management

Persistent data volumes:

- `postgres_data`: Database files (production only)
- `valkey_data`: Cache data
- `orchestrator_data`: Job execution data

## Monitoring

### Health Check Endpoints

- Orchestrator: http://localhost:8080/health
- Main App: http://localhost:5001/api/health

## Scaling

### Horizontal Scaling

Scale specific services:

```bash
# Scale orchestrators
docker-compose up -d --scale cronium-orchestrator=3
```

### Load Balancing

Add nginx for load balancing:

```bash
# Enable nginx profile
docker-compose --profile production up -d
```

## Troubleshooting

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f orchestrator

# Last 100 lines
docker-compose logs --tail 100 cronium-app
```

### Common Issues

1. **Database connection errors**:

   ```bash
   # Check database is running
   docker-compose ps postgres

   # Check database logs
   docker-compose logs postgres
   ```

2. **Port conflicts**:

   ```bash
   # Check port usage
   sudo lsof -i :5001

   # Change port in .env
   APP_PORT=5002
   ```

3. **Memory issues**:

   ```bash
   # Check resource usage
   docker stats

   # Increase Docker memory limit
   # Docker Desktop: Preferences > Resources
   ```

4. **Service health checks**:
   ```bash
   # Check service health
   curl http://localhost:8080/health  # Orchestrator
   curl http://localhost:5001/api/health  # Main app
   ```

### Reset Everything

```bash
# Stop all services
docker-compose down

# Remove volumes (WARNING: deletes all data)
docker-compose down -v

# Remove images
docker-compose down --rmi all

# Fresh start
docker-compose up -d
```

## Backup and Restore

### Backup Database

```bash
# Backup
docker exec cronium-postgres pg_dump -U cronium cronium > backup.sql

# Restore
docker exec -i cronium-postgres psql -U cronium cronium < backup.sql
```

### Backup Volumes

```bash
# Backup all volumes
docker run --rm -v cronium_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

## Security Considerations

1. **Change default passwords immediately**
2. **Use Docker secrets in production**
3. **Enable firewall rules**
4. **Regular security updates**
5. **Monitor for vulnerabilities**
6. **Rotate secrets regularly**

## Support

For issues and questions:

- GitHub Issues: https://github.com/your-org/cronium/issues
- Documentation: https://docs.cronium.io
- Community: https://discord.gg/cronium
