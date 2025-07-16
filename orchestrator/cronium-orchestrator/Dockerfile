# Production Dockerfile for Cronium Orchestrator
FROM golang:1.23-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Set working directory
WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o orchestrator ./cmd/orchestrator

# Final stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk --no-cache add ca-certificates tzdata tini

# Create non-root user
RUN addgroup -g 1000 cronium && \
    adduser -u 1000 -G cronium -s /bin/sh -D cronium

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/orchestrator /app/orchestrator

# Copy config directory
COPY --from=builder /build/configs /app/configs

# Create data directory
RUN mkdir -p /app/data && chown -R cronium:cronium /app

# Switch to non-root user
USER cronium

# Expose ports
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Run the application
CMD ["/app/orchestrator"]