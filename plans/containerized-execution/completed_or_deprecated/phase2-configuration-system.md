# Phase 2: Configuration System Design

## Overview

This document defines the configuration system for the Cronium orchestrator, supporting environment variables, configuration files, runtime updates, and secure secret management.

## Configuration Architecture

### Configuration Hierarchy

The configuration system follows a hierarchical approach with the following precedence (highest to lowest):

1. **Runtime flags** (command-line arguments)
2. **Environment variables**
3. **Configuration file** (YAML/JSON)
4. **Default values** (hardcoded)

```go
// ConfigSource defines where a configuration value came from
type ConfigSource string

const (
    ConfigSourceDefault     ConfigSource = "default"
    ConfigSourceFile        ConfigSource = "file"
    ConfigSourceEnv         ConfigSource = "environment"
    ConfigSourceRuntime     ConfigSource = "runtime"
)

// ConfigValue tracks a configuration value and its source
type ConfigValue[T any] struct {
    Value  T
    Source ConfigSource
}
```

## Configuration Structure

### Main Configuration

```go
// Config represents the complete orchestrator configuration
type Config struct {
    // Orchestrator identity
    Orchestrator OrchestratorConfig `yaml:"orchestrator" env:"CRONIUM_ORCHESTRATOR"`

    // API configuration
    API APIConfig `yaml:"api" env:"CRONIUM_API"`

    // Job processing
    Jobs JobsConfig `yaml:"jobs" env:"CRONIUM_JOBS"`

    // Container execution
    Container ContainerConfig `yaml:"container" env:"CRONIUM_CONTAINER"`

    // SSH execution
    SSH SSHConfig `yaml:"ssh" env:"CRONIUM_SSH"`

    // Logging and monitoring
    Logging LoggingConfig `yaml:"logging" env:"CRONIUM_LOGGING"`

    // Monitoring
    Monitoring MonitoringConfig `yaml:"monitoring" env:"CRONIUM_MONITORING"`

    // Security
    Security SecurityConfig `yaml:"security" env:"CRONIUM_SECURITY"`

    // Feature flags
    Features FeatureFlags `yaml:"features" env:"CRONIUM_FEATURES"`
}
```

### Detailed Configuration Types

```go
// OrchestratorConfig defines orchestrator identity and behavior
type OrchestratorConfig struct {
    ID          string        `yaml:"id" env:"ID" default:"generated"`
    Name        string        `yaml:"name" env:"NAME" default:"cronium-orchestrator"`
    Environment string        `yaml:"environment" env:"ENVIRONMENT" default:"production"`
    Region      string        `yaml:"region" env:"REGION" default:"default"`
    Tags        []string      `yaml:"tags" env:"TAGS"`
}

// APIConfig defines backend API settings
type APIConfig struct {
    Endpoint     string        `yaml:"endpoint" env:"ENDPOINT" required:"true"`
    Token        string        `yaml:"token" env:"TOKEN" required:"true" secret:"true"`
    WSEndpoint   string        `yaml:"wsEndpoint" env:"WS_ENDPOINT"`
    Timeout      time.Duration `yaml:"timeout" env:"TIMEOUT" default:"30s"`
    RetryConfig  RetryConfig   `yaml:"retry" env:"RETRY"`
    RateLimit    RateLimitConfig `yaml:"rateLimit" env:"RATE_LIMIT"`
}

// JobsConfig defines job processing settings
type JobsConfig struct {
    PollInterval    time.Duration `yaml:"pollInterval" env:"POLL_INTERVAL" default:"1s"`
    PollBatchSize   int          `yaml:"pollBatchSize" env:"POLL_BATCH_SIZE" default:"10"`
    MaxConcurrent   int          `yaml:"maxConcurrent" env:"MAX_CONCURRENT" default:"5"`
    DefaultTimeout  time.Duration `yaml:"defaultTimeout" env:"DEFAULT_TIMEOUT" default:"3600s"`
    QueueStrategy   string       `yaml:"queueStrategy" env:"QUEUE_STRATEGY" default:"priority"`
    LeaseRenewal    time.Duration `yaml:"leaseRenewal" env:"LEASE_RENEWAL" default:"30s"`
}

// ContainerConfig defines Docker container settings
type ContainerConfig struct {
    Docker       DockerConfig              `yaml:"docker" env:"DOCKER"`
    Images       map[string]string         `yaml:"images" env:"IMAGES"`
    Resources    ResourceConfig            `yaml:"resources" env:"RESOURCES"`
    Security     ContainerSecurityConfig   `yaml:"security" env:"SECURITY"`
    Volumes      VolumeConfig              `yaml:"volumes" env:"VOLUMES"`
    Network      NetworkConfig             `yaml:"network" env:"NETWORK"`
}

// SSHConfig defines SSH execution settings
type SSHConfig struct {
    ConnectionPool ConnectionPoolConfig `yaml:"connectionPool" env:"CONNECTION_POOL"`
    Execution      SSHExecutionConfig   `yaml:"execution" env:"EXECUTION"`
    CircuitBreaker CircuitBreakerConfig `yaml:"circuitBreaker" env:"CIRCUIT_BREAKER"`
    Security       SSHSecurityConfig    `yaml:"security" env:"SECURITY"`
}

// LoggingConfig defines logging settings
type LoggingConfig struct {
    Level       string          `yaml:"level" env:"LEVEL" default:"info"`
    Format      string          `yaml:"format" env:"FORMAT" default:"json"`
    Output      string          `yaml:"output" env:"OUTPUT" default:"stdout"`
    File        FileLogConfig   `yaml:"file" env:"FILE"`
    WebSocket   WSLogConfig     `yaml:"websocket" env:"WEBSOCKET"`
}

// MonitoringConfig defines monitoring settings
type MonitoringConfig struct {
    Enabled     bool            `yaml:"enabled" env:"ENABLED" default:"true"`
    MetricsPort int             `yaml:"metricsPort" env:"METRICS_PORT" default:"9090"`
    HealthPort  int             `yaml:"healthPort" env:"HEALTH_PORT" default:"8080"`
    Tracing     TracingConfig   `yaml:"tracing" env:"TRACING"`
    Profiling   ProfilingConfig `yaml:"profiling" env:"PROFILING"`
}
```

## Configuration File Format

### YAML Configuration Example

```yaml
# cronium-orchestrator.yaml
orchestrator:
  id: ${ORCHESTRATOR_ID:-auto}
  name: production-orchestrator
  environment: production
  region: us-east-1
  tags:
    - production
    - primary

api:
  endpoint: ${CRONIUM_API_URL}
  token: ${CRONIUM_SERVICE_TOKEN}
  wsEndpoint: ${CRONIUM_WS_URL:-ws://localhost:5001/api/socket}
  timeout: 30s
  retry:
    maxAttempts: 3
    backoff: exponential
    initialDelay: 1s
    maxDelay: 30s
  rateLimit:
    enabled: true
    requestsPerSecond: 10

jobs:
  pollInterval: 1s
  pollBatchSize: 10
  maxConcurrent: ${MAX_CONCURRENT:-5}
  defaultTimeout: 1h
  queueStrategy: priority
  leaseRenewal: 30s

container:
  docker:
    endpoint: ${DOCKER_HOST:-unix:///var/run/docker.sock}
    version: "1.41"
    tlsVerify: false
  images:
    bash: cronium/runner:bash-alpine
    python: cronium/runner:python-alpine
    node: cronium/runner:node-alpine
  resources:
    defaults:
      cpu: 0.5
      memory: 512MB
      disk: 1GB
      pids: 100
    limits:
      cpu: 2.0
      memory: 2GB
      disk: 10GB
      pids: 1000
  security:
    user: "1000:1000"
    noNewPrivileges: true
    dropCapabilities:
      - ALL
    readOnlyRootfs: false
    seccompProfile: default
  volumes:
    basePath: /var/lib/cronium/executions
    tempPath: /tmp/cronium
    retention: 24h
  network:
    mode: bridge
    enableICC: false
    dns:
      - 8.8.8.8
      - 8.8.4.4

ssh:
  connectionPool:
    maxPerServer: 5
    minPerServer: 1
    idleTimeout: 5m
    healthCheckInterval: 30s
    connectionTimeout: 10s
  execution:
    defaultShell: /bin/bash
    tempDir: /tmp/cronium
    cleanupAfter: true
    ptyMode: false
  circuitBreaker:
    enabled: true
    failureThreshold: 5
    successThreshold: 2
    timeout: 60s
    halfOpenRequests: 3
  security:
    strictHostKeyChecking: true
    knownHostsFile: /etc/cronium/known_hosts
    allowedCiphers:
      - aes128-ctr
      - aes256-ctr
    allowedKeyExchanges:
      - curve25519-sha256

logging:
  level: ${LOG_LEVEL:-info}
  format: json
  output: stdout
  file:
    enabled: false
    path: /var/log/cronium/orchestrator.log
    maxSize: 100MB
    maxBackups: 10
    maxAge: 30
  websocket:
    enabled: true
    bufferSize: 1000
    flushInterval: 100ms
    batchSize: 50
    compression: true

monitoring:
  enabled: true
  metricsPort: ${METRICS_PORT:-9090}
  healthPort: ${HEALTH_PORT:-8080}
  tracing:
    enabled: ${TRACING_ENABLED:-false}
    provider: opentelemetry
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT}
    samplingRate: 0.1
  profiling:
    enabled: false
    port: 6060

security:
  tls:
    enabled: ${TLS_ENABLED:-false}
    certFile: ${TLS_CERT_FILE}
    keyFile: ${TLS_KEY_FILE}
    caFile: ${TLS_CA_FILE}
  authentication:
    tokenRotation: true
    tokenTTL: 24h
  encryption:
    algorithm: aes-256-gcm
    keyDerivation: pbkdf2

features:
  containerPooling: false
  advancedScheduling: false
  distributedTracing: false
  experimentalSSH: false
```

## Configuration Loading

### Configuration Loader Implementation

```go
// ConfigLoader handles configuration loading from multiple sources
type ConfigLoader struct {
    configPath string
    envPrefix  string
    defaults   *Config
}

// LoadConfig loads configuration from all sources
func (l *ConfigLoader) LoadConfig() (*Config, error) {
    config := &Config{}

    // 1. Apply defaults
    if err := l.applyDefaults(config); err != nil {
        return nil, fmt.Errorf("failed to apply defaults: %w", err)
    }

    // 2. Load from file
    if l.configPath != "" {
        if err := l.loadFromFile(config); err != nil {
            return nil, fmt.Errorf("failed to load config file: %w", err)
        }
    }

    // 3. Apply environment variables
    if err := l.applyEnvironment(config); err != nil {
        return nil, fmt.Errorf("failed to apply environment: %w", err)
    }

    // 4. Validate configuration
    if err := l.validate(config); err != nil {
        return nil, fmt.Errorf("configuration validation failed: %w", err)
    }

    // 5. Process templates and secrets
    if err := l.processTemplates(config); err != nil {
        return nil, fmt.Errorf("failed to process templates: %w", err)
    }

    return config, nil
}

// Load from YAML/JSON file
func (l *ConfigLoader) loadFromFile(config *Config) error {
    data, err := os.ReadFile(l.configPath)
    if err != nil {
        return err
    }

    // Support both YAML and JSON
    ext := filepath.Ext(l.configPath)
    switch ext {
    case ".yaml", ".yml":
        return yaml.Unmarshal(data, config)
    case ".json":
        return json.Unmarshal(data, config)
    default:
        return fmt.Errorf("unsupported config format: %s", ext)
    }
}

// Apply environment variables
func (l *ConfigLoader) applyEnvironment(config *Config) error {
    return envconfig.Process(l.envPrefix, config)
}
```

### Configuration Validation

```go
// ConfigValidator validates configuration values
type ConfigValidator struct {
    rules []ValidationRule
}

// ValidationRule defines a validation check
type ValidationRule struct {
    Path      string
    Validator func(interface{}) error
}

// Validate configuration
func (v *ConfigValidator) Validate(config *Config) error {
    var errors []error

    // Required fields
    if config.API.Endpoint == "" {
        errors = append(errors, fmt.Errorf("api.endpoint is required"))
    }
    if config.API.Token == "" {
        errors = append(errors, fmt.Errorf("api.token is required"))
    }

    // Validate ranges
    if config.Jobs.MaxConcurrent < 1 || config.Jobs.MaxConcurrent > 100 {
        errors = append(errors, fmt.Errorf("jobs.maxConcurrent must be between 1 and 100"))
    }

    // Validate Docker endpoint
    if config.Container.Docker.Endpoint != "" {
        if err := validateDockerEndpoint(config.Container.Docker.Endpoint); err != nil {
            errors = append(errors, fmt.Errorf("invalid docker endpoint: %w", err))
        }
    }

    // Validate resource limits
    if config.Container.Resources.Defaults.CPU > config.Container.Resources.Limits.CPU {
        errors = append(errors, fmt.Errorf("default CPU exceeds limit"))
    }

    if len(errors) > 0 {
        return fmt.Errorf("configuration validation failed: %v", errors)
    }

    return nil
}
```

## Secret Management

### Secret Resolution

```go
// SecretResolver handles secret resolution from various sources
type SecretResolver struct {
    providers []SecretProvider
}

// SecretProvider interface for secret sources
type SecretProvider interface {
    Name() string
    GetSecret(key string) (string, error)
}

// Built-in secret providers
type EnvironmentSecretProvider struct{}
type FileSecretProvider struct {
    basePath string
}
type VaultSecretProvider struct {
    client *vault.Client
    path   string
}

// Resolve secrets in configuration
func (r *SecretResolver) ResolveSecrets(config *Config) error {
    // Resolve API token
    if strings.HasPrefix(config.API.Token, "secret://") {
        secret, err := r.resolveSecret(config.API.Token)
        if err != nil {
            return fmt.Errorf("failed to resolve API token: %w", err)
        }
        config.API.Token = secret
    }

    // Resolve other secrets...

    return nil
}

// Template processing for configuration values
func processTemplate(value string, data map[string]string) (string, error) {
    // Support ${VAR} and ${VAR:-default} syntax
    re := regexp.MustCompile(`\$\{([^}]+)\}`)

    result := re.ReplaceAllStringFunc(value, func(match string) string {
        inner := match[2 : len(match)-1]

        // Handle default values
        parts := strings.SplitN(inner, ":-", 2)
        key := parts[0]
        defaultValue := ""
        if len(parts) > 1 {
            defaultValue = parts[1]
        }

        if val, ok := data[key]; ok {
            return val
        }
        return defaultValue
    })

    return result, nil
}
```

## Runtime Configuration Updates

### Hot Reload Support

```go
// ConfigWatcher watches for configuration changes
type ConfigWatcher struct {
    loader   *ConfigLoader
    notifier chan *Config
    watchers []Watcher
}

// Watcher interface for configuration change notifications
type Watcher interface {
    ConfigChanged(old, new *Config) error
}

// Start watching configuration changes
func (w *ConfigWatcher) Start(ctx context.Context) error {
    // Watch configuration file
    watcher, err := fsnotify.NewWatcher()
    if err != nil {
        return err
    }
    defer watcher.Close()

    if err := watcher.Add(w.loader.configPath); err != nil {
        return err
    }

    // Also watch for SIGHUP for manual reload
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGHUP)

    for {
        select {
        case event := <-watcher.Events:
            if event.Op&fsnotify.Write == fsnotify.Write {
                w.handleConfigChange()
            }
        case <-sigChan:
            w.handleConfigChange()
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}

// Handle configuration change
func (w *ConfigWatcher) handleConfigChange() {
    newConfig, err := w.loader.LoadConfig()
    if err != nil {
        log.Printf("Failed to reload configuration: %v", err)
        return
    }

    // Notify watchers
    for _, watcher := range w.watchers {
        if err := watcher.ConfigChanged(w.currentConfig, newConfig); err != nil {
            log.Printf("Watcher %T failed to handle config change: %v", watcher, err)
        }
    }

    w.currentConfig = newConfig
}
```

### Dynamic Configuration

```go
// DynamicConfig supports runtime configuration updates
type DynamicConfig struct {
    mu     sync.RWMutex
    values map[string]interface{}
}

// Thread-safe configuration access
func (d *DynamicConfig) GetString(key string) string {
    d.mu.RLock()
    defer d.mu.RUnlock()

    if val, ok := d.values[key].(string); ok {
        return val
    }
    return ""
}

// Update configuration value
func (d *DynamicConfig) Set(key string, value interface{}) {
    d.mu.Lock()
    defer d.mu.Unlock()

    d.values[key] = value
}

// Atomic configuration updates
func (d *DynamicConfig) Update(updates map[string]interface{}) {
    d.mu.Lock()
    defer d.mu.Unlock()

    for key, value := range updates {
        d.values[key] = value
    }
}
```

## Environment-Specific Configuration

### Multi-Environment Support

```go
// EnvironmentConfig manages environment-specific settings
type EnvironmentConfig struct {
    Base         Config
    Environments map[string]Config
}

// Load environment-specific configuration
func LoadEnvironmentConfig(env string) (*Config, error) {
    // Load base configuration
    base, err := loadConfig("config/base.yaml")
    if err != nil {
        return nil, err
    }

    // Load environment-specific overrides
    envConfig, err := loadConfig(fmt.Sprintf("config/%s.yaml", env))
    if err != nil && !os.IsNotExist(err) {
        return nil, err
    }

    // Merge configurations
    merged := mergeConfigs(base, envConfig)

    return merged, nil
}

// Configuration profiles
var ConfigProfiles = map[string]func(*Config){
    "development": func(c *Config) {
        c.Logging.Level = "debug"
        c.Container.Security.NoNewPrivileges = false
        c.Monitoring.Profiling.Enabled = true
    },
    "production": func(c *Config) {
        c.Logging.Level = "info"
        c.Security.TLS.Enabled = true
        c.API.RateLimit.Enabled = true
    },
    "testing": func(c *Config) {
        c.Jobs.MaxConcurrent = 1
        c.Container.Resources.Defaults.CPU = 0.1
        c.Logging.Level = "debug"
    },
}
```

## CLI Configuration

### Command-Line Flags

```go
// CLIConfig defines command-line configuration options
type CLIConfig struct {
    ConfigFile   string `flag:"config,c" desc:"Configuration file path"`
    Environment  string `flag:"env,e" desc:"Environment (development/production)"`
    LogLevel     string `flag:"log-level,l" desc:"Log level"`
    APIEndpoint  string `flag:"api-endpoint" desc:"API endpoint override"`
    DryRun       bool   `flag:"dry-run" desc:"Validate config without starting"`
    ShowConfig   bool   `flag:"show-config" desc:"Print effective configuration"`
}

// Parse command-line flags
func ParseFlags() (*CLIConfig, error) {
    cli := &CLIConfig{
        ConfigFile:  "cronium-orchestrator.yaml",
        Environment: "production",
        LogLevel:    "info",
    }

    flag.StringVar(&cli.ConfigFile, "config", cli.ConfigFile, "Configuration file")
    flag.StringVar(&cli.ConfigFile, "c", cli.ConfigFile, "Configuration file (short)")
    flag.StringVar(&cli.Environment, "env", cli.Environment, "Environment")
    flag.StringVar(&cli.Environment, "e", cli.Environment, "Environment (short)")
    flag.StringVar(&cli.LogLevel, "log-level", cli.LogLevel, "Log level")
    flag.StringVar(&cli.LogLevel, "l", cli.LogLevel, "Log level (short)")
    flag.StringVar(&cli.APIEndpoint, "api-endpoint", cli.APIEndpoint, "API endpoint")
    flag.BoolVar(&cli.DryRun, "dry-run", cli.DryRun, "Dry run mode")
    flag.BoolVar(&cli.ShowConfig, "show-config", cli.ShowConfig, "Show configuration")

    flag.Parse()

    return cli, nil
}
```

## Configuration Documentation

### Auto-Generated Documentation

```go
// ConfigDoc generates configuration documentation
type ConfigDoc struct {
    structs map[string]StructDoc
}

type StructDoc struct {
    Name        string
    Description string
    Fields      []FieldDoc
}

type FieldDoc struct {
    Name         string
    Type         string
    Default      string
    Required     bool
    Description  string
    Example      string
    Environment  string
}

// Generate markdown documentation
func (d *ConfigDoc) GenerateMarkdown() string {
    var sb strings.Builder

    sb.WriteString("# Cronium Orchestrator Configuration\n\n")

    for _, structDoc := range d.structs {
        sb.WriteString(fmt.Sprintf("## %s\n\n", structDoc.Name))
        sb.WriteString(fmt.Sprintf("%s\n\n", structDoc.Description))

        sb.WriteString("| Field | Type | Default | Required | Environment | Description |\n")
        sb.WriteString("|-------|------|---------|----------|-------------|-------------|\n")

        for _, field := range structDoc.Fields {
            sb.WriteString(fmt.Sprintf("| %s | %s | %s | %v | %s | %s |\n",
                field.Name,
                field.Type,
                field.Default,
                field.Required,
                field.Environment,
                field.Description,
            ))
        }
        sb.WriteString("\n")
    }

    return sb.String()
}
```

## Configuration Best Practices

### 1. Security

- Never log sensitive configuration values
- Use secret providers for credentials
- Validate all external inputs
- Implement least privilege defaults

### 2. Flexibility

- Support multiple configuration sources
- Allow runtime overrides
- Provide sensible defaults
- Enable feature flags

### 3. Validation

- Validate early and fail fast
- Provide clear error messages
- Check value ranges and formats
- Verify external dependencies

### 4. Documentation

- Document all configuration options
- Provide examples for common scenarios
- Include migration guides
- Auto-generate reference docs

## Summary

This configuration system provides:

1. **Flexibility**: Multiple configuration sources with clear precedence
2. **Security**: Built-in secret management and validation
3. **Usability**: Clear structure with sensible defaults
4. **Maintainability**: Type-safe configuration with validation
5. **Observability**: Configuration change tracking and hot reload

The design ensures easy deployment while supporting complex enterprise requirements.
