# Executor Container Dockerfile
FROM debian:12-slim

# Install required packages and latest Node.js and Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Basic utilities
    ca-certificates \
    curl \
    wget \
    git \
    # Build essentials for native modules
    build-essential \
    # Python and pip
    python3 \
    python3-pip \
    python3-venv \
    # Required for some Python packages
    python3-dev \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install common Node.js and Python packages
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    pm2 \
    && pip3 install --no-cache-dir --break-system-packages \
    requests \
    numpy \
    pandas \
    python-dotenv \
    pyyaml

# Create non-root user for execution
RUN groupadd -g 1000 executor && \
    useradd -m -u 1000 -g executor -s /bin/bash executor

# Create working directories
RUN mkdir -p /workspace /tmp/execution && \
    chown -R executor:executor /workspace /tmp/execution

# Copy runtime helpers
COPY --chown=executor:executor runtime-helpers/ /opt/cronium/runtime-helpers/

# Make runtime helpers accessible
RUN chmod +x /opt/cronium/runtime-helpers/*.sh && \
    ln -s /opt/cronium/runtime-helpers/cronium.js /usr/local/lib/node_modules/ && \
    ln -s /opt/cronium/runtime-helpers/cronium.py /usr/local/lib/python3.11/dist-packages/ && \
    ln -s /opt/cronium/runtime-helpers/cronium.sh /usr/local/bin/cronium

# Copy entrypoint script
COPY --chown=executor:executor docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER executor
WORKDIR /workspace

# Set environment
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/cronium/runtime-helpers:${PATH}"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sleep", "infinity"]