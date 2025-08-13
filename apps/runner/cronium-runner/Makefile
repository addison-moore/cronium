# Build variables
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME = $(shell date -u '+%Y-%m-%d_%H:%M:%S')
GIT_COMMIT = $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Go build flags
LDFLAGS = -ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME) -X main.GitCommit=$(GIT_COMMIT)"
LDFLAGS_OPTIMIZED = -ldflags "-s -w -X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME) -X main.GitCommit=$(GIT_COMMIT)"

# Output directory
DIST_DIR = dist
ARTIFACTS_DIR = ../../../artifacts/runners

# Binary name
BINARY_NAME = cronium-runner

# Platforms to build
PLATFORMS = linux/amd64 linux/arm64

.PHONY: all build clean test install-tools build-optimized build-helpers

all: clean build

# Build for all platforms
build: $(PLATFORMS)

$(PLATFORMS):
	@echo "Building for $@..."
	@mkdir -p $(DIST_DIR)
	@GOOS=$(word 1,$(subst /, ,$@)) GOARCH=$(word 2,$(subst /, ,$@)) \
		go build $(LDFLAGS) -o $(DIST_DIR)/$(BINARY_NAME)-$(word 1,$(subst /, ,$@))-$(word 2,$(subst /, ,$@)) ./cmd/runner

# Build for current platform
build-local:
	@echo "Building for current platform..."
	@mkdir -p $(DIST_DIR)
	go build $(LDFLAGS) -o $(DIST_DIR)/$(BINARY_NAME) ./cmd/runner

# Build optimized binaries with platform-specific embeds
build-optimized: build-helpers
	@echo "Building optimized binaries..."
	@mkdir -p $(DIST_DIR)
	@for platform in $(PLATFORMS); do \
		os=$$(echo $$platform | cut -d'/' -f1); \
		arch=$$(echo $$platform | cut -d'/' -f2); \
		echo "Building optimized $$os/$$arch..."; \
		GOOS=$$os GOARCH=$$arch go build \
			$(LDFLAGS_OPTIMIZED) \
			-trimpath \
			-o $(DIST_DIR)/$(BINARY_NAME)-$$os-$$arch \
			./cmd/runner; \
	done
	@echo "Copying to artifacts..."
	@mkdir -p ../../orchestrator/artifacts/runners/$(VERSION)
	@mkdir -p ../../orchestrator/artifacts/runners/dev
	@for platform in $(PLATFORMS); do \
		os=$$(echo $$platform | cut -d'/' -f1); \
		arch=$$(echo $$platform | cut -d'/' -f2); \
		cp $(DIST_DIR)/$(BINARY_NAME)-$$os-$$arch ../../orchestrator/artifacts/runners/$(VERSION)/; \
		cp $(DIST_DIR)/$(BINARY_NAME)-$$os-$$arch ../../orchestrator/artifacts/runners/dev/; \
	done
	@echo "Optimized build complete!"

# Build and compress helper binaries
build-helpers:
	@echo "Building helper binaries..."
	@./build-helpers.sh
	@echo "Compressing helper binaries..."
	@for file in internal/helpers/binaries/linux_*.cronium.*; do \
		if [ -f "$$file" ] && [ ! -f "$$file.gz" ]; then \
			gzip -9 -k -f "$$file"; \
		fi \
	done

# Install build dependencies
install-tools:
	@echo "Installing build tools..."
	go install github.com/sigstore/cosign/v2/cmd/cosign@latest

# Sign binaries (requires cosign to be installed)
sign: build
	@echo "Signing binaries..."
	@for platform in $(PLATFORMS); do \
		binary=$(DIST_DIR)/$(BINARY_NAME)-$$(echo $$platform | tr '/' '-'); \
		if [ -f $$binary ]; then \
			echo "Signing $$binary..."; \
			cosign sign-blob --key cosign.key $$binary > $$binary.sig 2>/dev/null || echo "Warning: Signing failed for $$binary"; \
		fi \
	done

# Copy artifacts to storage
store-artifacts: build
	@echo "Storing artifacts..."
	@mkdir -p $(ARTIFACTS_DIR)/$(VERSION)
	@cp $(DIST_DIR)/* $(ARTIFACTS_DIR)/$(VERSION)/
	@echo "Artifacts stored in $(ARTIFACTS_DIR)/$(VERSION)"

# Run tests
test:
	go test ./...

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@rm -rf $(DIST_DIR)

# Generate a test payload
test-payload:
	@echo "Creating test payload..."
	@mkdir -p test/payload
	@echo 'version: v1' > test/payload/manifest.yaml
	@echo 'interpreter: bash' >> test/payload/manifest.yaml
	@echo 'entrypoint: script.sh' >> test/payload/manifest.yaml
	@echo 'metadata:' >> test/payload/manifest.yaml
	@echo '  jobId: test-job-123' >> test/payload/manifest.yaml
	@echo '  eventId: test-event-456' >> test/payload/manifest.yaml
	@echo '  eventVersion: 1' >> test/payload/manifest.yaml
	@echo '  createdAt: $(shell date -u +%Y-%m-%dT%H:%M:%SZ)' >> test/payload/manifest.yaml
	@echo '#!/bin/bash' > test/payload/script.sh
	@echo 'echo "Hello from Cronium Runner!"' >> test/payload/script.sh
	@echo 'echo "Job ID: $$CRONIUM_JOB_ID"' >> test/payload/script.sh
	@echo 'echo "Event ID: $$CRONIUM_EVENT_ID"' >> test/payload/script.sh
	@chmod +x test/payload/script.sh
	@tar -czf test/test-payload.tar.gz -C test/payload .
	@rm -rf test/payload
	@echo "Test payload created at test/test-payload.tar.gz"

# Run the test payload
run-test: build-local test-payload
	$(DIST_DIR)/$(BINARY_NAME) run test/test-payload.tar.gz