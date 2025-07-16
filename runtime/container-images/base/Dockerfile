# Base Alpine image with security hardening for Cronium
FROM alpine:3.19

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Create non-root user and group
RUN addgroup -g 1000 -S cronium && \
    adduser -u 1000 -S cronium -G cronium -h /home/cronium -s /bin/sh

# Set up working directory structure
RUN mkdir -p /app /tmp/cronium && \
    chown -R cronium:cronium /app /tmp/cronium

# Install base utilities that might be needed by scripts
RUN apk add --no-cache \
    ca-certificates \
    tzdata

# Security hardening
# Remove unnecessary packages and files
RUN rm -rf /var/cache/apk/* \
    /usr/share/man/* \
    /tmp/* \
    /var/tmp/*

# Disable setuid/setgid binaries
RUN find / -perm /6000 -type f -exec chmod a-s {} \; || true

# Set up environment
ENV HOME=/home/cronium \
    USER=cronium \
    PATH=/usr/local/bin:$PATH \
    LANG=C.UTF-8 \
    TZ=UTC

# Use non-root user by default
USER cronium
WORKDIR /app

# Set tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["/bin/sh"]