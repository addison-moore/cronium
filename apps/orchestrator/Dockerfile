# Production Dockerfile for Cronium Orchestrator
# Multi-stage build for security and minimal image size

# Build stage.
# Pinned to BUILDPLATFORM so the Go toolchain always runs natively on the
# builder; cross-compilation to TARGETARCH below is free, whereas letting
# buildx run this stage under QEMU for a foreign platform is not.
FROM --platform=$BUILDPLATFORM golang:1.25.12-alpine AS orchestrator-builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /build/orchestrator

# Copy go mod files first for better caching
COPY apps/orchestrator/go.mod apps/orchestrator/go.sum ./

# Download dependencies
RUN go mod download && go mod verify

# Copy source code
COPY apps/orchestrator/ ./

# Build with security flags and version info
ARG BUILD_VERSION=latest
ARG BUILD_TIME
# TARGETARCH is supplied by buildx. Hardcoding amd64 here produced an x86-64
# binary inside the linux/arm64 image, which could never execute.
ARG TARGETARCH
ARG TARGETOS=linux
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags="-w -s -X main.Version=${BUILD_VERSION} -X main.BuildTime=${BUILD_TIME}" \
    -a -installsuffix cgo \
    -o orchestrator ./cmd/cronium-orchestrator

# Build the remote runner from the same tracked source snapshot as the
# orchestrator. The artifacts directory is intentionally gitignored, so an
# image build must never depend on binaries left behind on a developer host.
FROM --platform=$BUILDPLATFORM golang:1.25.12-alpine AS runner-builder

RUN apk add --no-cache ca-certificates

WORKDIR /build/runner

COPY apps/runner/cronium-runner/go.mod apps/runner/cronium-runner/go.sum ./
RUN go mod download && go mod verify
COPY apps/runner/cronium-runner/ ./

ARG BUILD_TIME
ARG RUNNER_VERSION=dev
RUN mkdir -p "/out/${RUNNER_VERSION}" && \
    for arch in amd64 arm64; do \
      output="/out/${RUNNER_VERSION}/cronium-runner-linux-${arch}"; \
      CGO_ENABLED=0 GOOS=linux GOARCH="${arch}" go build \
        -trimpath \
        -ldflags="-w -s -X main.Version=${RUNNER_VERSION} -X main.BuildTime=${BUILD_TIME}" \
        -o "${output}" ./cmd/runner; \
      (cd "/out/${RUNNER_VERSION}" && sha256sum "cronium-runner-linux-${arch}" > "cronium-runner-linux-${arch}.sha256"); \
    done

# Runtime stage - using distroless for maximum security
FROM gcr.io/distroless/static:nonroot

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=orchestrator-builder --chown=nonroot:nonroot /build/orchestrator/orchestrator /app/orchestrator

# SSH execution verifies these root-owned artifacts against their adjacent
# SHA-256 manifests before deployment. Keep them outside the nonroot process's
# write ownership so the digest pinned at startup remains a meaningful anchor.
COPY --from=runner-builder /out /app/artifacts/runners

# Copy timezone data
COPY --from=orchestrator-builder /usr/share/zoneinfo /usr/share/zoneinfo

# Expose ports
EXPOSE 8080 9090

# Distroless has no shell, so the probe is a subcommand of the binary itself
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/app/orchestrator", "healthcheck"]

# Labels for metadata
LABEL org.opencontainers.image.source="https://github.com/addison-moore/cronium"
LABEL org.opencontainers.image.description="Cronium Orchestrator - Job execution orchestrator"
LABEL org.opencontainers.image.licenses="MIT"

# Run the application (distroless has no shell, so direct execution)
ENTRYPOINT ["/app/orchestrator"]
