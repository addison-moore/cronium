# Production Dockerfile for Cronium Orchestrator
# Multi-stage build for security and minimal image size

# Build stage
FROM golang:1.23-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /build

# Copy go mod files first for better caching
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build with security flags and version info
ARG BUILD_VERSION=latest
ARG BUILD_TIME
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.Version=${BUILD_VERSION} -X main.BuildTime=${BUILD_TIME}" \
    -a -installsuffix cgo \
    -o orchestrator ./cmd/cronium-orchestrator

# Runtime stage - using distroless for maximum security
FROM gcr.io/distroless/static:nonroot

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder --chown=nonroot:nonroot /build/orchestrator /app/orchestrator

# Copy timezone data
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Expose ports
EXPOSE 8080 9090

# Labels for metadata
LABEL org.opencontainers.image.source="https://github.com/addison-moore/cronium"
LABEL org.opencontainers.image.description="Cronium Orchestrator - Job execution orchestrator"
LABEL org.opencontainers.image.licenses="MIT"

# Run the application (distroless has no shell, so direct execution)
ENTRYPOINT ["/app/orchestrator"]