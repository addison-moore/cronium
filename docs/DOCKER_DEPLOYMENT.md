# Docker Deployment Guide for Cronium

This guide explains how to deploy Cronium using Docker containers from GitHub Container Registry (ghcr.io), ensuring a secure and production-ready installation.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Security Considerations](#security-considerations)
4. [Image Architecture](#image-architecture)
5. [Configuration](#configuration)
6. [Deployment Steps](#deployment-steps)
7. [Verification](#verification)
8. [Troubleshooting](#troubleshooting)
9. [Maintenance](#maintenance)

## Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- 4GB RAM minimum (8GB recommended)
- 10GB free disk space
- Linux, macOS, or Windows with WSL2
- Access to Docker socket (for container execution)

## Quick Start

1. **Download the example configuration files:**

   ```bash
   # Create a deployment directory
   mkdir cronium-deploy && cd cronium-deploy

   # Download the sample Compose file
   curl -O https://raw.githubusercontent.com/addison-moore/cronium/main/docker-compose.example.yml

   # Copy it into place
   cp docker-compose.example.yml docker-compose.yml
   ```

2. **Generate secure secrets:**

   ```bash
   # Generate secrets (store these values somewhere safe)
   AUTH_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -hex 32)
   INTERNAL_API_KEY=$(openssl rand -base64 32)
   JWT_SECRET=$(openssl rand -hex 32)

   # Save them to .env (you can append additional variables later)
   cat <<ENV > .env
   AUTH_URL=http://localhost:3000
   PUBLIC_APP_URL=http://localhost:3000
   AUTH_SECRET=$AUTH_SECRET
   ENCRYPTION_KEY=$ENCRYPTION_KEY
   INTERNAL_API_KEY=$INTERNAL_API_KEY
   JWT_SECRET=$JWT_SECRET
   ENV
   ```

3. **Update the docker compose.yml file:**
   - Review the image tags (they already point at `ghcr.io/addison-moore/...`)
   - Adjust ports if needed
   - Configure volumes for persistence (leave the `/var/run/docker.sock` mount in place unless you only use SSH runners, because the orchestrator needs access to the host Docker daemon)

4. **Start the services:**

   ```bash
   docker compose up -d  # Uses values from your .env file automatically
   ```

   The Cronium app automatically runs any pending database migrations on startup.
   Leave `AUTO_MIGRATE` at its default (`true`) unless you prefer to manage the
   schema yourself.

5. **Access Cronium:**
   - Web UI: http://localhost:3000
   - WebSocket: ws://localhost:5002

## Security Considerations

### Image Security

Our Docker images are built with security in mind:

1. **Multi-stage builds:** Minimal final images with only runtime dependencies
2. **Non-root users:** All containers run as non-privileged users
3. **No secrets in images:** All sensitive data via environment variables
4. **Signed images:** Images are signed with cosign for verification
5. **Regular scans:** Automated vulnerability scanning with Trivy
6. **Distroless base:** Orchestrator uses distroless for minimal attack surface

### Secrets Management

**NEVER commit these to version control:**

- `.env` files with actual values
- Private keys or certificates
- Database passwords
- API tokens

**Best Practices:**

- Use a secrets management system (Vault, AWS Secrets Manager, etc.)
- Rotate secrets regularly
- Use strong, randomly generated values
- Implement least privilege access

### Network Security

```yaml
# Example: Restrict network access
networks:
  cronium-network:
    driver: bridge
    internal: true # No external access

  frontend:
    driver: bridge # External access for web UI
```

### Volume Security

```yaml
# Example: Read-only Docker socket
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

## Image Architecture

### Cronium App (`ghcr.io/addison-moore/cronium-app`)

**Build Process:**

1. **Stage 1 (deps):** Install dependencies with pnpm
2. **Stage 2 (builder):** Build Next.js application
3. **Stage 3 (runner):** Minimal runtime with Node.js

**Security Features:**

- Runs as user `nextjs` (UID 1001)
- No build tools in final image
- Health checks enabled
- Tini for proper signal handling

### Orchestrator (`ghcr.io/addison-moore/cronium-orchestrator`)

**Build Process:**

1. **Stage 1 (builder):** Compile Go binary
2. **Stage 2 (runner):** Distroless base image

**Security Features:**

- Distroless base (no shell, minimal attack surface)
- Runs as non-root user
- Statically compiled binary
- No package manager

## Configuration

### Required Environment Variables

| Variable           | Description           | How to Generate        |
| ------------------ | --------------------- | ---------------------- |
| `AUTH_SECRET`      | NextAuth.js secret    | `openssl rand -hex 32` |
| `ENCRYPTION_KEY`   | Data encryption key   | `openssl rand -hex 32` |
| `INTERNAL_API_KEY` | Service communication | `openssl rand -hex 32` |
| `JWT_SECRET`       | JWT signing key       | `openssl rand -hex 32` |

### Optional Configuration

| Variable              | Description                           | Default |
| --------------------- | ------------------------------------- | ------- |
| `LOG_LEVEL`           | Logging verbosity                     | `info`  |
| `MAX_CONCURRENT_JOBS` | Parallel job limit                    | `10`    |
| `SMTP_*`              | Email configuration                   | Not set |
| `OPENAI_API_KEY`      | AI features                           | Not set |
| `AUTO_MIGRATE`        | Run database migrations automatically | `true`  |

### Database Configuration

```yaml
environment:
  DATABASE_URL: postgresql://cronium:password@postgres:5432/cronium?sslmode=disable
```

For production, use SSL:

```yaml
DATABASE_URL: postgresql://cronium:password@postgres:5432/cronium?sslmode=require
```

## Deployment Steps

### 1. Prepare the Environment

```bash
# Create deployment directory
mkdir -p /opt/cronium
cd /opt/cronium

# Set proper permissions
chmod 750 /opt/cronium
```

### 2. Configure Reverse Proxy (Optional but Recommended)

**Nginx Example:**

```nginx
server {
    listen 443 ssl http2;
    server_name cronium.yourdomain.com;

    ssl_certificate /etc/ssl/certs/cronium.crt;
    ssl_certificate_key /etc/ssl/private/cronium.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/socketio/ {
        proxy_pass http://localhost:5002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 3. Deploy with Docker Compose

```bash
# Pull latest images
docker compose pull

# Start services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

The Cronium app image already bundles the compiled Next.js server and
WebSocket process; the sample Compose file starts both by running
`node apps/cronium-app/server.js & node server.js`. Do not change that command
unless you are building custom images.

### 4. Initialize the Database

The database is automatically initialized on first start. To manually run migrations:

```bash
# From a local checkout of the Cronium repo
pnpm --filter @cronium/app db:push
```

### 5. Create Admin User

Open your browser to `http://localhost:3000`, choose **Sign Up**, and create the first admin account. Cronium automatically grants admin privileges to the first user.

## Verification

### Health Checks

```bash
# Check application health
curl http://localhost:3000/api/health

# Check orchestrator health
curl http://localhost:8080/health

# Check all services
docker compose ps
```

### Verify Image Signatures

```bash
# Install cosign
brew install cosign  # or your package manager

# Verify app image
cosign verify ghcr.io/addison-moore/cronium-app:latest \
  --certificate-identity-regexp=".*" \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com

# Verify orchestrator image
cosign verify ghcr.io/addison-moore/cronium-orchestrator:latest \
  --certificate-identity-regexp=".*" \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com
```

## Troubleshooting

### Common Issues

**1. Container fails to start:**

```bash
# Check logs
docker compose logs cronium-app
docker compose logs cronium-orchestrator

# Verify environment variables
docker compose config
```

**2. Database connection issues:**

```bash
# Test database connection
docker compose exec postgres psql -U cronium -d cronium -c "SELECT 1;"

# Check database logs
docker compose logs postgres
```

**3. Permission denied on Docker socket:**

```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Log out and back in
```

**4. Port already in use:**

```bash
# Change ports in .env file
APP_PORT=3001
SOCKET_PORT=5003
```

### Debug Mode

Enable debug logging:

```yaml
environment:
  LOG_LEVEL: debug
  NODE_ENV: development
```

## Maintenance

### Updates

```bash
# Pull latest images
docker compose pull

# Recreate containers with new images
docker compose up -d --force-recreate

# Remove old images
docker image prune -a
```

### Backups

**Database Backup:**

```bash
# Backup database
docker compose exec postgres pg_dump -U cronium cronium > backup.sql

# Restore database
docker compose exec -T postgres psql -U cronium cronium < backup.sql
```

**Volume Backup:**

```bash
# Backup all volumes
docker run --rm -v cronium_postgres_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

### Monitoring

**Resource Usage:**

```bash
# Monitor container resources
docker stats

# Check disk usage
docker system df
```

**Logs:**

```bash
# Follow all logs
docker compose logs -f

# Export logs
docker compose logs > cronium.log
```

### Security Updates

1. **Regular Updates:**

   ```bash
   # Update images weekly
   docker compose pull
   docker compose up -d
   ```

2. **Vulnerability Scanning:**

   ```bash
   # Scan images with Trivy
   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     aquasec/trivy image ghcr.io/addison-moore/cronium-app:latest
   ```

3. **Secret Rotation:**
   - Generate new secrets quarterly
   - Update .env file
   - Restart services
   - Update any integrated systems

## Support

For issues or questions:

- GitHub Issues: https://github.com/addison-moore/cronium/issues
- Documentation: https://docs.cronium.io
- Discord: https://discord.gg/cronium
