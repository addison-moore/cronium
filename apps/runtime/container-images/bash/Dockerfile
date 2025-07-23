# Bash runtime image for Cronium
FROM alpine:3.19

# Install required packages
RUN apk add --no-cache \
    bash \
    curl \
    jq \
    coreutils \
    tini \
    ca-certificates \
    tzdata

# Create non-root user and group
RUN addgroup -g 1000 -S cronium && \
    adduser -u 1000 -S cronium -G cronium -h /home/cronium -s /bin/bash

# Set up working directory
RUN mkdir -p /app /tmp/cronium && \
    chown -R cronium:cronium /app /tmp/cronium /home/cronium

# Copy Cronium SDK
COPY --chown=cronium:cronium cronium.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/cronium.sh

# Create health check script
COPY --chown=cronium:cronium healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/healthcheck.sh

# Security hardening
# Remove package manager
RUN apk del --no-cache \
    apk-tools \
    alpine-keys \
    alpine-baselayout-data

# Clear caches
RUN rm -rf /var/cache/apk/* \
    /tmp/* \
    /var/tmp/* \
    /usr/share/man/* \
    /usr/share/doc/* \
    /etc/apk \
    /lib/apk

# Remove unnecessary binaries and directories
RUN rm -rf /media /mnt /srv /opt

# Disable setuid/setgid binaries except essential ones
RUN find / -perm /6000 -type f \
    -not -path "/bin/su" \
    -not -path "/usr/bin/passwd" \
    -exec chmod a-s {} \; 2>/dev/null || true

# Create bashrc for better shell experience
RUN echo 'source /usr/local/bin/cronium.sh' > /home/cronium/.bashrc && \
    echo 'export PS1="\\u@cronium:\\w\\$ "' >> /home/cronium/.bashrc && \
    chown cronium:cronium /home/cronium/.bashrc

# Environment setup
ENV HOME=/home/cronium \
    USER=cronium \
    LANG=C.UTF-8 \
    TZ=UTC \
    BASH_ENV=/home/cronium/.bashrc

# Switch to non-root user
USER cronium
WORKDIR /app

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["/bin/bash"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh || exit 1