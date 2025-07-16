# Phase 2: Docker Integration & Container Management Plan

## Overview

This document details the Docker integration strategy for the Cronium orchestrator, focusing on secure container execution, efficient resource management, and runtime helper integration.

## Container Architecture

### Base Images

We'll maintain three minimal Alpine-based images for different script types:

```dockerfile
# Base image for all runners
FROM alpine:3.19
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    tini

# Create non-root user
RUN addgroup -g 1000 cronium && \
    adduser -u 1000 -G cronium -D cronium

# Set up working directory
WORKDIR /workspace
RUN chown -R cronium:cronium /workspace

# Use tini as init process
ENTRYPOINT ["/sbin/tini", "--"]
```

#### Bash Runner

```dockerfile
FROM cronium/base:latest
RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    jq \
    grep \
    sed \
    awk
COPY runtime-helpers/cronium.sh /usr/local/bin/
USER cronium
```

#### Python Runner

```dockerfile
FROM cronium/base:latest
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-requests \
    py3-yaml
COPY runtime-helpers/cronium.py /usr/local/lib/python3.11/site-packages/
USER cronium
```

#### Node.js Runner

```dockerfile
FROM cronium/base:latest
RUN apk add --no-cache \
    nodejs \
    npm
COPY runtime-helpers/cronium.js /usr/local/lib/node_modules/
RUN ln -s /usr/local/lib/node_modules/cronium.js /usr/local/bin/cronium
USER cronium
```

### Image Management Strategy

```go
// ImageManager handles Docker image operations
type ImageManager struct {
    client      *docker.Client
    registry    string
    cache       *ImageCache
    pullPolicy  PullPolicy
}

type PullPolicy string

const (
    PullAlways       PullPolicy = "always"
    PullIfNotPresent PullPolicy = "if-not-present"
    PullNever        PullPolicy = "never"
)

// Image configuration
type ImageConfig struct {
    BaseImages map[ScriptType]string
    Registry   string
    Auth       *RegistryAuth
    Labels     map[string]string
}

// Default image mapping
var DefaultImages = map[ScriptType]string{
    ScriptTypeBash:   "cronium/runner:bash-alpine",
    ScriptTypePython: "cronium/runner:python-alpine",
    ScriptTypeNode:   "cronium/runner:node-alpine",
}
```

## Container Lifecycle Management

### 1. Container Creation

```go
// ContainerConfig defines container creation parameters
type ContainerConfig struct {
    Name            string
    Image           string
    Command         []string
    Environment     map[string]string
    Volumes         []VolumeMount
    Resources       ResourceLimits
    SecurityOptions SecurityConfig
    Labels          map[string]string
}

// Create container with proper configuration
func (e *ContainerExecutor) createContainer(ctx context.Context, config ContainerConfig) (string, error) {
    containerCfg := &container.Config{
        Image:        config.Image,
        Cmd:          config.Command,
        Env:          formatEnvironment(config.Environment),
        User:         "1000:1000", // cronium user
        WorkingDir:   "/workspace",
        AttachStdout: true,
        AttachStderr: true,
        Tty:          false,
        Labels:       config.Labels,
    }

    hostCfg := &container.HostConfig{
        Resources: container.Resources{
            CPUQuota:   calculateCPUQuota(config.Resources.CPU),
            Memory:     config.Resources.Memory,
            MemorySwap: config.Resources.Memory, // Disable swap
            PidsLimit:  &config.Resources.PidsLimit,
        },
        SecurityOpt: config.SecurityOptions.ToDockerSecurityOpt(),
        CapDrop:     []string{"ALL"},
        Binds:       formatVolumes(config.Volumes),
        AutoRemove:  false, // Manual cleanup for data extraction
        LogConfig: container.LogConfig{
            Type: "json-file",
            Config: map[string]string{
                "max-size": "10m",
                "max-file": "3",
            },
        },
    }

    resp, err := e.client.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, config.Name)
    return resp.ID, err
}
```

### 2. Volume Management

```go
// VolumeManager handles temporary volumes for execution
type VolumeManager struct {
    basePath string
    client   *docker.Client
}

// VolumeMount defines a volume mount point
type VolumeMount struct {
    HostPath      string
    ContainerPath string
    ReadOnly      bool
}

// Prepare execution volumes
func (v *VolumeManager) PrepareVolumes(jobID string) (*ExecutionVolumes, error) {
    execDir := filepath.Join(v.basePath, "executions", jobID)

    volumes := &ExecutionVolumes{
        BaseDir:    execDir,
        ScriptDir:  filepath.Join(execDir, "scripts"),
        DataDir:    filepath.Join(execDir, "data"),
        OutputDir:  filepath.Join(execDir, "output"),
        TempDir:    filepath.Join(execDir, "tmp"),
    }

    // Create directory structure
    dirs := []string{
        volumes.ScriptDir,
        volumes.DataDir,
        volumes.OutputDir,
        volumes.TempDir,
    }

    for _, dir := range dirs {
        if err := os.MkdirAll(dir, 0755); err != nil {
            return nil, fmt.Errorf("failed to create directory %s: %w", dir, err)
        }
    }

    // Set permissions for cronium user (1000:1000)
    if err := chownR(execDir, 1000, 1000); err != nil {
        return nil, fmt.Errorf("failed to set permissions: %w", err)
    }

    return volumes, nil
}

// Get volume mounts for container
func (v *ExecutionVolumes) GetMounts() []VolumeMount {
    return []VolumeMount{
        {
            HostPath:      v.ScriptDir,
            ContainerPath: "/workspace/scripts",
            ReadOnly:      true,
        },
        {
            HostPath:      v.DataDir,
            ContainerPath: "/workspace/data",
            ReadOnly:      false,
        },
        {
            HostPath:      v.OutputDir,
            ContainerPath: "/workspace/output",
            ReadOnly:      false,
        },
        {
            HostPath:      v.TempDir,
            ContainerPath: "/tmp",
            ReadOnly:      false,
        },
    }
}
```

### 3. Script Injection

```go
// ScriptPreparer handles script preparation with runtime helpers
type ScriptPreparer struct {
    helperPath string
}

// Prepare script for execution
func (s *ScriptPreparer) PrepareScript(job *Job, volumes *ExecutionVolumes) error {
    // Create main script file
    scriptPath := filepath.Join(volumes.ScriptDir, "main.sh")

    // Build script content with helpers
    var scriptContent strings.Builder

    switch job.Script.Type {
    case ScriptTypeBash:
        scriptContent.WriteString("#!/bin/bash\n")
        scriptContent.WriteString("set -euo pipefail\n")
        scriptContent.WriteString("source /usr/local/bin/cronium.sh\n\n")

    case ScriptTypePython:
        scriptContent.WriteString("#!/usr/bin/env python3\n")
        scriptContent.WriteString("import cronium\n\n")

    case ScriptTypeNode:
        scriptContent.WriteString("#!/usr/bin/env node\n")
        scriptContent.WriteString("const cronium = require('cronium');\n\n")
    }

    // Add environment setup
    scriptContent.WriteString(generateEnvironmentSetup(job))

    // Add the actual script content
    scriptContent.WriteString(job.Script.Content)

    // Write script file
    if err := os.WriteFile(scriptPath, []byte(scriptContent.String()), 0755); err != nil {
        return fmt.Errorf("failed to write script: %w", err)
    }

    // Prepare input data
    if job.InputData != nil {
        inputPath := filepath.Join(volumes.DataDir, "input.json")
        inputJSON, _ := json.Marshal(job.InputData)
        if err := os.WriteFile(inputPath, inputJSON, 0644); err != nil {
            return fmt.Errorf("failed to write input data: %w", err)
        }
    }

    // Prepare variables
    if job.Variables != nil {
        varsPath := filepath.Join(volumes.DataDir, "variables.json")
        varsJSON, _ := json.Marshal(job.Variables)
        if err := os.WriteFile(varsPath, varsJSON, 0644); err != nil {
            return fmt.Errorf("failed to write variables: %w", err)
        }
    }

    return nil
}
```

### 4. Container Execution

```go
// Execute runs the container and streams output
func (e *ContainerExecutor) Execute(ctx context.Context, job *Job) (<-chan ExecutionUpdate, error) {
    updates := make(chan ExecutionUpdate, 100)

    go func() {
        defer close(updates)

        // Send preparing status
        updates <- ExecutionUpdate{
            Type:      UpdateTypeStatus,
            Timestamp: time.Now(),
            Data: StatusUpdate{
                Status:  JobStatusPreparing,
                Message: "Preparing container execution",
            },
        }

        // Prepare volumes
        volumes, err := e.volumeManager.PrepareVolumes(job.ID)
        if err != nil {
            updates <- errorUpdate(err)
            return
        }
        defer e.volumeManager.Cleanup(volumes)

        // Prepare script
        if err := e.scriptPreparer.PrepareScript(job, volumes); err != nil {
            updates <- errorUpdate(err)
            return
        }

        // Create container
        containerID, err := e.createContainer(ctx, ContainerConfig{
            Name:        fmt.Sprintf("cronium-%s", job.ID),
            Image:       e.getImage(job.Script.Type),
            Command:     []string{"/workspace/scripts/main.sh"},
            Environment: job.Environment,
            Volumes:     volumes.GetMounts(),
            Resources:   e.getResourceLimits(job),
            SecurityOptions: SecurityConfig{
                NoNewPrivileges: true,
                SeccompProfile:  "default",
                ReadOnlyRootfs:  false,
            },
            Labels: map[string]string{
                "cronium.job.id":   job.ID,
                "cronium.job.type": string(job.Script.Type),
            },
        })
        if err != nil {
            updates <- errorUpdate(err)
            return
        }

        // Start container
        if err := e.client.ContainerStart(ctx, containerID, types.ContainerStartOptions{}); err != nil {
            updates <- errorUpdate(err)
            return
        }

        // Send running status
        updates <- ExecutionUpdate{
            Type:      UpdateTypeStatus,
            Timestamp: time.Now(),
            Data: StatusUpdate{
                Status:  JobStatusRunning,
                Message: "Container started",
            },
        }

        // Stream logs
        logStream, err := e.client.ContainerLogs(ctx, containerID, types.ContainerLogsOptions{
            ShowStdout: true,
            ShowStderr: true,
            Follow:     true,
            Timestamps: true,
        })
        if err != nil {
            updates <- errorUpdate(err)
            return
        }
        defer logStream.Close()

        // Process log stream
        logsDone := make(chan struct{})
        go e.streamLogs(logStream, updates, logsDone)

        // Wait for container to finish
        statusCh, errCh := e.client.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)

        select {
        case err := <-errCh:
            if err != nil {
                updates <- errorUpdate(err)
                return
            }
        case status := <-statusCh:
            <-logsDone // Wait for logs to finish

            // Extract output data
            outputData, err := e.extractOutputData(volumes)
            if err != nil {
                updates <- errorUpdate(err)
            }

            // Send completion update
            updates <- ExecutionUpdate{
                Type:      UpdateTypeComplete,
                Timestamp: time.Now(),
                Data: StatusUpdate{
                    Status:   JobStatusCompleted,
                    Message:  "Execution completed",
                    ExitCode: &status.StatusCode,
                    Output:   outputData,
                },
            }
        }
    }()

    return updates, nil
}
```

### 5. Resource Management

```go
// ResourceLimits defines container resource constraints
type ResourceLimits struct {
    CPU      float64 // CPU cores (e.g., 0.5, 1.0)
    Memory   int64   // Memory in bytes
    DiskIO   int64   // Disk I/O limit in bytes/sec
    PidsLimit int64  // Maximum number of processes
}

// Default resource limits
var DefaultResourceLimits = ResourceLimits{
    CPU:       0.5,                    // 0.5 CPU cores
    Memory:    512 * 1024 * 1024,      // 512 MB
    DiskIO:    10 * 1024 * 1024,       // 10 MB/s
    PidsLimit: 100,                    // Max 100 processes
}

// Calculate Docker CPU quota from cores
func calculateCPUQuota(cores float64) int64 {
    // Docker uses microseconds per 100ms period
    // 1 core = 100000 microseconds
    return int64(cores * 100000)
}

// Apply resource limits with safety checks
func (e *ContainerExecutor) getResourceLimits(job *Job) ResourceLimits {
    limits := DefaultResourceLimits

    if job.Resources != nil {
        if job.Resources.CPULimit > 0 && job.Resources.CPULimit <= e.config.MaxCPU {
            limits.CPU = job.Resources.CPULimit
        }
        if job.Resources.MemoryLimit > 0 && job.Resources.MemoryLimit <= e.config.MaxMemory {
            limits.Memory = job.Resources.MemoryLimit
        }
    }

    return limits
}
```

## Security Configuration

### 1. Container Security Options

```go
// SecurityConfig defines container security settings
type SecurityConfig struct {
    NoNewPrivileges bool
    SeccompProfile  string
    AppArmorProfile string
    ReadOnlyRootfs  bool
    DropCapabilities []string
    SELinuxOptions  *SELinuxOptions
}

// Convert to Docker security options
func (s SecurityConfig) ToDockerSecurityOpt() []string {
    var opts []string

    if s.NoNewPrivileges {
        opts = append(opts, "no-new-privileges:true")
    }

    if s.SeccompProfile != "" {
        opts = append(opts, fmt.Sprintf("seccomp=%s", s.SeccompProfile))
    }

    if s.AppArmorProfile != "" {
        opts = append(opts, fmt.Sprintf("apparmor=%s", s.AppArmorProfile))
    }

    if s.SELinuxOptions != nil {
        opts = append(opts, fmt.Sprintf("label=%s", s.SELinuxOptions.String()))
    }

    return opts
}

// Default security configuration
var DefaultSecurityConfig = SecurityConfig{
    NoNewPrivileges: true,
    SeccompProfile:  "default",
    ReadOnlyRootfs:  false, // Scripts need to write temp files
    DropCapabilities: []string{"ALL"},
}
```

### 2. Network Isolation

```go
// NetworkConfig defines container network settings
type NetworkConfig struct {
    Mode            string
    DNSServers      []string
    ExtraHosts      []string
    NetworkDisabled bool
}

// Create isolated network for containers
func (e *ContainerExecutor) createNetwork(ctx context.Context) error {
    _, err := e.client.NetworkCreate(ctx, "cronium-execution", types.NetworkCreate{
        Driver: "bridge",
        Options: map[string]string{
            "com.docker.network.bridge.enable_icc": "false", // Disable inter-container communication
        },
        Labels: map[string]string{
            "cronium.network": "execution",
        },
    })
    return err
}
```

## Runtime Helper Integration

### 1. Helper Implementation

```bash
# cronium.sh - Bash runtime helper
#!/bin/bash

CRONIUM_DATA_DIR="${CRONIUM_DATA_DIR:-/workspace/data}"
CRONIUM_OUTPUT_DIR="${CRONIUM_OUTPUT_DIR:-/workspace/output}"

# Get input data
cronium_input() {
    local input_file="$CRONIUM_DATA_DIR/input.json"
    if [[ -f "$input_file" ]]; then
        cat "$input_file"
    else
        echo "{}"
    fi
}

# Set output data
cronium_output() {
    local output_file="$CRONIUM_OUTPUT_DIR/output.json"
    echo "$1" > "$output_file"
}

# Get variable
cronium_get_variable() {
    local key="$1"
    local vars_file="$CRONIUM_DATA_DIR/variables.json"
    if [[ -f "$vars_file" ]]; then
        jq -r ".$key // empty" "$vars_file"
    fi
}

# Set variable
cronium_set_variable() {
    local key="$1"
    local value="$2"
    local vars_file="$CRONIUM_DATA_DIR/variables.json"

    if [[ -f "$vars_file" ]]; then
        jq ". + {\"$key\": \"$value\"}" "$vars_file" > "$vars_file.tmp"
        mv "$vars_file.tmp" "$vars_file"
    else
        echo "{\"$key\": \"$value\"}" > "$vars_file"
    fi
}

# Set workflow condition
cronium_set_condition() {
    local result="$1"
    local condition_file="$CRONIUM_OUTPUT_DIR/condition.json"
    echo "{\"result\": $result}" > "$condition_file"
}

# Get event metadata
cronium_event() {
    echo "$CRONIUM_EVENT_METADATA"
}
```

### 2. Data Persistence

```go
// Extract output data after execution
func (e *ContainerExecutor) extractOutputData(volumes *ExecutionVolumes) (*OutputData, error) {
    output := &OutputData{
        Variables: make(map[string]interface{}),
        Files:     make(map[string][]byte),
    }

    // Read output.json
    outputPath := filepath.Join(volumes.OutputDir, "output.json")
    if data, err := os.ReadFile(outputPath); err == nil {
        json.Unmarshal(data, &output.Data)
    }

    // Read updated variables
    varsPath := filepath.Join(volumes.DataDir, "variables.json")
    if data, err := os.ReadFile(varsPath); err == nil {
        json.Unmarshal(data, &output.Variables)
    }

    // Read condition result
    conditionPath := filepath.Join(volumes.OutputDir, "condition.json")
    if data, err := os.ReadFile(conditionPath); err == nil {
        var condition struct {
            Result bool `json:"result"`
        }
        json.Unmarshal(data, &condition)
        output.Condition = &condition.Result
    }

    // Collect other output files
    files, _ := ioutil.ReadDir(volumes.OutputDir)
    for _, file := range files {
        if file.Name() != "output.json" && file.Name() != "condition.json" {
            if data, err := os.ReadFile(filepath.Join(volumes.OutputDir, file.Name())); err == nil {
                output.Files[file.Name()] = data
            }
        }
    }

    return output, nil
}
```

## Container Cleanup

### 1. Cleanup Strategy

```go
// ContainerCleaner handles container and volume cleanup
type ContainerCleaner struct {
    client        *docker.Client
    volumeManager *VolumeManager
    retentionTime time.Duration
}

// Cleanup after execution
func (c *ContainerCleaner) Cleanup(ctx context.Context, containerID string, volumes *ExecutionVolumes) error {
    // Remove container
    if err := c.client.ContainerRemove(ctx, containerID, types.ContainerRemoveOptions{
        Force: true,
    }); err != nil {
        log.Printf("Failed to remove container %s: %v", containerID, err)
    }

    // Clean up volumes
    if err := c.volumeManager.Cleanup(volumes); err != nil {
        log.Printf("Failed to clean up volumes: %v", err)
    }

    return nil
}

// Periodic cleanup of orphaned resources
func (c *ContainerCleaner) PeriodicCleanup(ctx context.Context) {
    ticker := time.NewTicker(5 * time.Minute)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            c.cleanupOrphaned(ctx)
        case <-ctx.Done():
            return
        }
    }
}

func (c *ContainerCleaner) cleanupOrphaned(ctx context.Context) {
    // List all containers with cronium labels
    containers, err := c.client.ContainerList(ctx, types.ContainerListOptions{
        All: true,
        Filters: filters.NewArgs(
            filters.Arg("label", "cronium.job.id"),
        ),
    })
    if err != nil {
        return
    }

    cutoff := time.Now().Add(-c.retentionTime)

    for _, container := range containers {
        if container.Created < cutoff.Unix() {
            c.client.ContainerRemove(ctx, container.ID, types.ContainerRemoveOptions{
                Force: true,
            })
        }
    }
}
```

## Monitoring & Metrics

### Docker Metrics Collection

```go
// ContainerMetrics collects resource usage metrics
type ContainerMetrics struct {
    CPUUsage    float64
    MemoryUsage int64
    NetworkRx   int64
    NetworkTx   int64
    DiskRead    int64
    DiskWrite   int64
}

// Collect metrics during execution
func (e *ContainerExecutor) collectMetrics(ctx context.Context, containerID string) (*ContainerMetrics, error) {
    stats, err := e.client.ContainerStats(ctx, containerID, false)
    if err != nil {
        return nil, err
    }
    defer stats.Body.Close()

    var statsJSON types.StatsJSON
    if err := json.NewDecoder(stats.Body).Decode(&statsJSON); err != nil {
        return nil, err
    }

    metrics := &ContainerMetrics{
        CPUUsage:    calculateCPUPercent(&statsJSON),
        MemoryUsage: int64(statsJSON.MemoryStats.Usage),
        NetworkRx:   calculateNetworkRx(&statsJSON),
        NetworkTx:   calculateNetworkTx(&statsJSON),
        DiskRead:    calculateDiskRead(&statsJSON),
        DiskWrite:   calculateDiskWrite(&statsJSON),
    }

    return metrics, nil
}
```

## Error Handling

### Docker-Specific Errors

```go
// Docker error types
type DockerError struct {
    Type    DockerErrorType
    Message string
    Details map[string]interface{}
}

type DockerErrorType string

const (
    DockerErrorImagePull      DockerErrorType = "image_pull"
    DockerErrorContainerCreate DockerErrorType = "container_create"
    DockerErrorContainerStart  DockerErrorType = "container_start"
    DockerErrorResourceLimit   DockerErrorType = "resource_limit"
    DockerErrorNetwork         DockerErrorType = "network"
    DockerErrorDaemon          DockerErrorType = "daemon"
)

// Handle Docker-specific errors
func handleDockerError(err error) *DockerError {
    dockerErr := &DockerError{
        Message: err.Error(),
        Details: make(map[string]interface{}),
    }

    // Categorize error
    switch {
    case strings.Contains(err.Error(), "pull access denied"):
        dockerErr.Type = DockerErrorImagePull
    case strings.Contains(err.Error(), "Cannot connect to the Docker daemon"):
        dockerErr.Type = DockerErrorDaemon
    case strings.Contains(err.Error(), "Conflict"):
        dockerErr.Type = DockerErrorContainerCreate
    default:
        dockerErr.Type = DockerErrorContainerStart
    }

    return dockerErr
}
```

## Performance Optimizations

### 1. Image Caching

```go
// ImageCache manages local image cache
type ImageCache struct {
    client *docker.Client
    images map[string]types.ImageSummary
    mu     sync.RWMutex
}

// Ensure image is available locally
func (c *ImageCache) EnsureImage(ctx context.Context, image string) error {
    c.mu.RLock()
    if _, exists := c.images[image]; exists {
        c.mu.RUnlock()
        return nil
    }
    c.mu.RUnlock()

    // Pull image if not present
    reader, err := c.client.ImagePull(ctx, image, types.ImagePullOptions{})
    if err != nil {
        return err
    }
    defer reader.Close()

    // Wait for pull to complete
    io.Copy(io.Discard, reader)

    // Update cache
    c.updateCache(ctx)

    return nil
}
```

### 2. Container Pooling (Future Enhancement)

```go
// ContainerPool manages a pool of pre-created containers
type ContainerPool struct {
    client    *docker.Client
    available map[ScriptType][]*PooledContainer
    inUse     map[string]*PooledContainer
    mu        sync.Mutex
}

type PooledContainer struct {
    ID        string
    ScriptType ScriptType
    Created   time.Time
    LastUsed  time.Time
}

// Future implementation for container reuse
func (p *ContainerPool) GetContainer(ctx context.Context, scriptType ScriptType) (*PooledContainer, error) {
    // Implementation for Phase 2
    return nil, fmt.Errorf("container pooling not yet implemented")
}
```

## Summary

This Docker integration plan provides:

1. **Secure Execution**: Non-root containers with dropped capabilities
2. **Resource Control**: CPU, memory, and I/O limits enforced
3. **Data Management**: Proper volume handling for scripts and output
4. **Runtime Integration**: Seamless helper script support
5. **Performance**: Image caching and efficient resource usage
6. **Monitoring**: Metrics collection and error tracking

The implementation ensures secure, isolated execution while maintaining compatibility with existing runtime helpers and data flow patterns.
