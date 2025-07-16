# Node.js runtime image for Cronium
FROM node:20-alpine

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Create non-root user and group (use different GID if 1000 is taken)
RUN (addgroup -g 1000 -S cronium || addgroup -S cronium) && \
    (adduser -u 1000 -S cronium -G cronium -h /home/cronium -s /bin/sh || adduser -S cronium -G cronium -h /home/cronium -s /bin/sh)

# Set up working directory
RUN mkdir -p /app /tmp/cronium && \
    chown -R cronium:cronium /app /tmp/cronium /home/cronium

# Install global dependencies as root
RUN npm install -g --no-save axios@1.6.2 && \
    npm cache clean --force

# Copy Cronium SDK files
COPY --chown=cronium:cronium cronium.js /usr/local/lib/
COPY --chown=cronium:cronium cronium.d.ts /usr/local/lib/
COPY --chown=cronium:cronium package.json /usr/local/lib/

# Create health check script
COPY --chown=cronium:cronium healthcheck.js /usr/local/bin/
RUN chmod +x /usr/local/bin/healthcheck.js

# Security hardening
# Remove package managers
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /opt/yarn* \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

# Remove unnecessary packages
RUN apk del --no-cache \
    apk-tools \
    alpine-keys \
    alpine-baselayout-data

# Clear caches
RUN rm -rf /var/cache/apk/* \
    /tmp/* \
    /var/tmp/* \
    /usr/share/man/* \
    /root/.npm \
    /root/.node-gyp

# Disable setuid/setgid binaries
RUN find / -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true

# Environment setup
ENV NODE_ENV=production \
    NODE_PATH=/usr/local/lib \
    HOME=/home/cronium \
    USER=cronium \
    LANG=C.UTF-8 \
    TZ=UTC

# Switch to non-root user
USER cronium
WORKDIR /app

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node /usr/local/bin/healthcheck.js || exit 1