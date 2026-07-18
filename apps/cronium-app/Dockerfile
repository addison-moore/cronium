# Production Dockerfile for Cronium App
# Multi-stage build for security and optimization

# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate

# Copy package files for all workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY turbo.json ./
COPY apps/cronium-app/package.json ./apps/cronium-app/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config-typescript/package.json ./packages/config-typescript/
COPY packages/config-eslint/package.json ./packages/config-eslint/
COPY packages/config-tailwind/package.json ./packages/config-tailwind/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate

# Copy entire workspace with dependencies from deps
COPY --from=deps /app ./

# Copy all source files
COPY . .

# Set build-time environment variables
ARG BUILD_VERSION=latest
ENV BUILD_VERSION=${BUILD_VERSION}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=true

# Set placeholder values for required environment variables during build
# These will be overridden at runtime with actual values
ENV AUTH_SECRET=build-placeholder
ENV AUTH_URL=http://localhost:3000
ENV DATABASE_URL=postgresql://user:pass@localhost:5432/db
ENV PUBLIC_APP_URL=http://localhost:3000
ENV ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# Build the application
# First build dependencies, then the app
RUN pnpm --filter @cronium/ui build
# Use next build directly to avoid dotenv dependency on missing .env.local file  
WORKDIR /app/apps/cronium-app
RUN pnpm exec next build
WORKDIR /app

# Stage 3: Runtime
FROM node:22-alpine AS runner
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache libc6-compat tini && \
    addgroup -g 1001 nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Copy built application assets (ensure public available at both root and app paths)
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/public ./apps/cronium-app/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/.next/static ./apps/cronium-app/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/drizzle ./apps/cronium-app/drizzle
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/scripts ./apps/cronium-app/scripts
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/drizzle.config.ts ./apps/cronium-app/drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/src/shared ./apps/cronium-app/src/shared
# Provide runtime dependencies required for migration/bootstrap scripts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
# Provide workspace-level dependencies for scripts that rely on the monorepo install
COPY --from=deps --chown=nextjs:nodejs /app/apps/cronium-app/node_modules ./apps/cronium-app/node_modules

# Copy package.json for version info
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/package.json ./package.json

# Install runtime dependencies for Cronium app (ensures migrations have access to drizzle-orm, etc.)
# Create necessary directories
RUN mkdir -p /app/logs /app/uploads /app/tmp && \
    chown -R nextjs:nodejs /app/logs /app/uploads /app/tmp && \
    chmod +x /app/apps/cronium-app/scripts/start.sh

# Switch to non-root user
USER nextjs

# Expose ports
EXPOSE 3000 5002

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_PATH=/app/node_modules

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) process.exit(1)})" || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application bootstrap (runs migrations + servers)
CMD ["apps/cronium-app/scripts/start.sh"]
