# Production Dockerfile for Cronium App
# Multi-stage build for security and optimization

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files for all workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./
COPY apps/cronium-app/package.json ./apps/cronium-app/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config-typescript/package.json ./packages/config-typescript/
COPY packages/config-eslint/package.json ./packages/config-eslint/
COPY packages/config-tailwind/package.json ./packages/config-tailwind/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

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

# Build the application
RUN pnpm build --filter @cronium/app

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache libc6-compat tini && \
    addgroup -g 1001 nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/.next/static ./apps/cronium-app/.next/static

# Copy package.json for version info
COPY --from=builder --chown=nextjs:nodejs /app/apps/cronium-app/package.json ./package.json

# Create necessary directories
RUN mkdir -p /app/logs /app/uploads /app/tmp && \
    chown -R nextjs:nodejs /app/logs /app/uploads /app/tmp

# Switch to non-root user
USER nextjs

# Expose ports
EXPOSE 3000 5002

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) process.exit(1)})" || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "apps/cronium-app/server.js"]