# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o cronium-runtime \
    cmd/runtime/main.go

# Runtime stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    tini

# Create non-root user
RUN addgroup -g 1000 -S cronium && \
    adduser -u 1000 -S cronium -G cronium -h /home/cronium -s /bin/sh

# Set up working directory
RUN mkdir -p /app && \
    chown -R cronium:cronium /app

WORKDIR /app

# Copy binary from builder
COPY --from=builder --chown=cronium:cronium /app/cronium-runtime /app/

# Copy config file if exists
COPY --chown=cronium:cronium config.yaml* /app/

# Expose port
EXPOSE 8081

# Use non-root user
USER cronium

# Environment variables with defaults
ENV RUNTIME_PORT=8081 \
    RUNTIME_LOG_LEVEL=info \
    HOME=/home/cronium

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8081/health || exit 1

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Run the service
CMD ["/app/cronium-runtime"]