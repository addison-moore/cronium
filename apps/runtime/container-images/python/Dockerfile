# Python runtime image for Cronium
FROM python:3.12-slim

# Install tini for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user and group
RUN groupadd -g 1000 cronium && \
    useradd -u 1000 -g cronium -m -d /home/cronium -s /bin/bash cronium

# Set up working directory
RUN mkdir -p /app /tmp/cronium && \
    chown -R cronium:cronium /app /tmp/cronium

# Copy and install Python dependencies
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

# Copy the Cronium SDK
COPY --chown=cronium:cronium cronium.py /usr/local/lib/python3.12/site-packages/

# Create health check script
COPY --chown=cronium:cronium healthcheck.py /usr/local/bin/
RUN chmod +x /usr/local/bin/healthcheck.py

# Security hardening
# Remove pip to prevent package installation at runtime
RUN pip uninstall -y pip setuptools wheel && \
    rm -rf /root/.cache/pip

# Remove unnecessary packages (if they exist)
RUN apt-get purge -y --auto-remove \
    gcc \
    g++ \
    make \
    || true && rm -rf /var/lib/apt/lists/*

# Clear package caches
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* \
    /tmp/* \
    /var/tmp/* \
    /usr/share/man/* \
    /usr/share/doc/*

# Disable setuid/setgid binaries
RUN find / -perm /6000 -type f -exec chmod a-s {} \; || true

# Environment setup
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=random \
    PYTHONPATH=/usr/local/lib/python3.12/site-packages \
    HOME=/home/cronium \
    USER=cronium \
    LANG=C.UTF-8 \
    TZ=UTC

# Switch to non-root user
USER cronium
WORKDIR /app

# Use tini as entrypoint
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command runs Python
CMD ["python3"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python3 /usr/local/bin/healthcheck.py || exit 1