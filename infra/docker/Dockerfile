# Main Cronium Application Dockerfile
FROM debian:12-slim AS base

# Install Node.js and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    openssl \
    python3 \
    make \
    g++ \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cronium-app/package.json ./apps/cronium-app/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config-typescript/package.json ./packages/config-typescript/
COPY packages/config-eslint/package.json ./packages/config-eslint/
COPY packages/config-tailwind/package.json ./packages/config-tailwind/

# Install dependencies
FROM base AS deps
RUN pnpm install --frozen-lockfile

# Development stage - for running dev server
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .
# Don't build in development, just prepare the environment
EXPOSE 5001 5002
CMD ["pnpm", "dev"]

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN pnpm build

# Production stage - minimal debian container
FROM debian:12-slim AS runner
WORKDIR /app

# Install Node.js runtime only
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    openssl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs -s /bin/bash nextjs

# Copy built application and necessary files
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/server ./src/server

# Create required directories
RUN mkdir -p logs && chown -R nextjs:nodejs logs

USER nextjs

# Expose ports
EXPOSE 5001 3001

# Set environment
ENV NODE_ENV=production
ENV PORT=5001
ENV HOSTNAME=0.0.0.0

# Start both Next.js and WebSocket server
CMD ["sh", "-c", "node server.js & node src/server/socket.ts"]