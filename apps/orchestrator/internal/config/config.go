package config

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kelseyhightower/envconfig"
	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
)

// Config represents the complete orchestrator configuration
type Config struct {
	Orchestrator OrchestratorConfig `yaml:"orchestrator" envconfig:"ORCHESTRATOR"`
	API          APIConfig          `yaml:"api" envconfig:"API"`
	Jobs         JobsConfig         `yaml:"jobs" envconfig:"JOBS"`
	Container    ContainerConfig    `yaml:"container" envconfig:"CONTAINER"`
	SSH          SSHConfig          `yaml:"ssh" envconfig:"SSH"`
	Logging      LoggingConfig      `yaml:"logging" envconfig:"LOGGING"`
	Monitoring   MonitoringConfig   `yaml:"monitoring" envconfig:"MONITORING"`
	Security     SecurityConfig     `yaml:"security" envconfig:"SECURITY"`
	Features     FeatureFlags       `yaml:"features" envconfig:"FEATURES"`
}

// OrchestratorConfig defines orchestrator identity and behavior
type OrchestratorConfig struct {
	ID          string   `yaml:"id" envconfig:"ID" default:"auto"`
	Name        string   `yaml:"name" envconfig:"NAME" default:"cronium-orchestrator"`
	Environment string   `yaml:"environment" envconfig:"ENVIRONMENT" default:"production"`
	Region      string   `yaml:"region" envconfig:"REGION" default:"default"`
	Tags        []string `yaml:"tags" envconfig:"TAGS"`
}

// APIConfig defines backend API settings
type APIConfig struct {
	Endpoint       string        `yaml:"endpoint" envconfig:"ENDPOINT" required:"true"`
	Token          string        `yaml:"token" envconfig:"TOKEN" required:"true"`
	WSEndpoint     string        `yaml:"wsEndpoint" envconfig:"WS_ENDPOINT"`
	Timeout        time.Duration `yaml:"timeout" envconfig:"TIMEOUT" default:"5m"`
	RetryConfig    RetryConfig   `yaml:"retry" envconfig:"RETRY"`
	RateLimit      RateLimitConfig `yaml:"rateLimit" envconfig:"RATE_LIMIT"`
	OrchestratorID string        `yaml:"-"` // Set from OrchestratorConfig.ID
}

// JobsConfig defines job processing settings
type JobsConfig struct {
	PollInterval   time.Duration `yaml:"pollInterval" envconfig:"POLL_INTERVAL" default:"1s"`
	PollBatchSize  int           `yaml:"pollBatchSize" envconfig:"POLL_BATCH_SIZE" default:"10"`
	MaxConcurrent  int           `yaml:"maxConcurrent" envconfig:"MAX_CONCURRENT" default:"5"`
	DefaultTimeout time.Duration `yaml:"defaultTimeout" envconfig:"DEFAULT_TIMEOUT" default:"3600s"`
	QueueStrategy  string        `yaml:"queueStrategy" envconfig:"QUEUE_STRATEGY" default:"priority"`
	LeaseRenewal   time.Duration `yaml:"leaseRenewal" envconfig:"LEASE_RENEWAL" default:"30s"`
}

// ContainerConfig defines Docker container settings
type ContainerConfig struct {
	Docker    DockerConfig              `yaml:"docker" envconfig:"DOCKER"`
	Images    map[string]string         `yaml:"images" envconfig:"IMAGES"`
	Resources ResourceConfig            `yaml:"resources" envconfig:"RESOURCES"`
	Security  ContainerSecurityConfig   `yaml:"security" envconfig:"SECURITY"`
	Volumes   VolumeConfig              `yaml:"volumes" envconfig:"VOLUMES"`
	Network   NetworkConfig             `yaml:"network" envconfig:"NETWORK"`
	Runtime   RuntimeConfig             `yaml:"runtime" envconfig:"RUNTIME"`
}

// SSHConfig defines SSH execution settings
type SSHConfig struct {
	ConnectionPool ConnectionPoolConfig `yaml:"connectionPool" envconfig:"CONNECTION_POOL"`
	Execution      SSHExecutionConfig   `yaml:"execution" envconfig:"EXECUTION"`
	CircuitBreaker CircuitBreakerConfig `yaml:"circuitBreaker" envconfig:"CIRCUIT_BREAKER"`
	Security       SSHSecurityConfig    `yaml:"security" envconfig:"SECURITY"`
}

// LoggingConfig defines logging settings
type LoggingConfig struct {
	Level     string        `yaml:"level" envconfig:"LEVEL" default:"info"`
	Format    string        `yaml:"format" envconfig:"FORMAT" default:"json"`
	Output    string        `yaml:"output" envconfig:"OUTPUT" default:"stdout"`
	File      FileLogConfig `yaml:"file" envconfig:"FILE"`
	WebSocket WSLogConfig   `yaml:"websocket" envconfig:"WEBSOCKET"`
}

// MonitoringConfig defines monitoring settings
type MonitoringConfig struct {
	Enabled     bool            `yaml:"enabled" envconfig:"ENABLED" default:"true"`
	MetricsPort int             `yaml:"metricsPort" envconfig:"METRICS_PORT" default:"9090"`
	HealthPort  int             `yaml:"healthPort" envconfig:"HEALTH_PORT" default:"8080"`
	Tracing     TracingConfig   `yaml:"tracing" envconfig:"TRACING"`
	Profiling   ProfilingConfig `yaml:"profiling" envconfig:"PROFILING"`
}

// SecurityConfig defines security settings
type SecurityConfig struct {
	TLS            TLSConfig            `yaml:"tls" envconfig:"TLS"`
	Authentication AuthenticationConfig `yaml:"authentication" envconfig:"AUTHENTICATION"`
	Encryption     EncryptionConfig     `yaml:"encryption" envconfig:"ENCRYPTION"`
}

// FeatureFlags defines feature toggles
type FeatureFlags struct {
	ContainerPooling   bool `yaml:"containerPooling" envconfig:"CONTAINER_POOLING" default:"false"`
	AdvancedScheduling bool `yaml:"advancedScheduling" envconfig:"ADVANCED_SCHEDULING" default:"false"`
	DistributedTracing bool `yaml:"distributedTracing" envconfig:"DISTRIBUTED_TRACING" default:"false"`
	ExperimentalSSH    bool `yaml:"experimentalSSH" envconfig:"EXPERIMENTAL_SSH" default:"false"`
}

// Sub-configurations

// RetryConfig defines retry behavior
type RetryConfig struct {
	MaxAttempts  int           `yaml:"maxAttempts" envconfig:"MAX_ATTEMPTS" default:"3"`
	BackoffType  string        `yaml:"backoffType" envconfig:"BACKOFF_TYPE" default:"exponential"`
	InitialDelay time.Duration `yaml:"initialDelay" envconfig:"INITIAL_DELAY" default:"1s"`
	MaxDelay     time.Duration `yaml:"maxDelay" envconfig:"MAX_DELAY" default:"30s"`
}

// RateLimitConfig defines rate limiting
type RateLimitConfig struct {
	Enabled           bool    `yaml:"enabled" envconfig:"ENABLED" default:"true"`
	RequestsPerSecond float64 `yaml:"requestsPerSecond" envconfig:"REQUESTS_PER_SECOND" default:"10"`
}

// DockerConfig defines Docker daemon settings
type DockerConfig struct {
	Endpoint   string `yaml:"endpoint" envconfig:"ENDPOINT" default:"unix:///var/run/docker.sock"`
	Version    string `yaml:"version" envconfig:"VERSION" default:"1.41"`
	TLSVerify  bool   `yaml:"tlsVerify" envconfig:"TLS_VERIFY" default:"false"`
	CertPath   string `yaml:"certPath" envconfig:"CERT_PATH"`
}

// ResourceConfig defines resource limits
type ResourceConfig struct {
	Defaults ResourceLimits `yaml:"defaults" envconfig:"DEFAULTS"`
	Limits   ResourceLimits `yaml:"limits" envconfig:"LIMITS"`
}

// ResourceLimits defines specific resource constraints
type ResourceLimits struct {
	CPU    float64 `yaml:"cpu" envconfig:"CPU" default:"0.5"`
	Memory string  `yaml:"memory" envconfig:"MEMORY" default:"512MB"`
	Disk   string  `yaml:"disk" envconfig:"DISK" default:"1GB"`
	Pids   int64   `yaml:"pids" envconfig:"PIDS" default:"100"`
}

// ContainerSecurityConfig defines container security settings
type ContainerSecurityConfig struct {
	User             string   `yaml:"user" envconfig:"USER" default:"1000:1000"`
	NoNewPrivileges  bool     `yaml:"noNewPrivileges" envconfig:"NO_NEW_PRIVILEGES" default:"true"`
	DropCapabilities []string `yaml:"dropCapabilities" envconfig:"DROP_CAPABILITIES"`
	ReadOnlyRootfs   bool     `yaml:"readOnlyRootfs" envconfig:"READ_ONLY_ROOTFS" default:"false"`
	SeccompProfile   string   `yaml:"seccompProfile" envconfig:"SECCOMP_PROFILE" default:"default"`
}

// VolumeConfig defines volume settings
type VolumeConfig struct {
	BasePath  string        `yaml:"basePath" envconfig:"BASE_PATH" default:"/var/lib/cronium/executions"`
	TempPath  string        `yaml:"tempPath" envconfig:"TEMP_PATH" default:"/tmp/cronium"`
	Retention time.Duration `yaml:"retention" envconfig:"RETENTION" default:"24h"`
}

// NetworkConfig defines network settings
type NetworkConfig struct {
	Mode      string   `yaml:"mode" envconfig:"MODE" default:"bridge"`
	EnableICC bool     `yaml:"enableICC" envconfig:"ENABLE_ICC" default:"false"`
	DNS       []string `yaml:"dns" envconfig:"DNS"`
}

// RuntimeConfig defines runtime API settings
type RuntimeConfig struct {
	Image          string `yaml:"image" envconfig:"IMAGE" default:"cronium/runtime-api:latest"`
	BackendURL     string `yaml:"backendURL" envconfig:"BACKEND_URL"`
	ValkeyURL      string `yaml:"valkeyURL" envconfig:"VALKEY_URL" default:"valkey://valkey:6379"`
	JWTSecret      string `yaml:"jwtSecret" envconfig:"JWT_SECRET"`
	IsolateNetwork bool   `yaml:"isolateNetwork" envconfig:"ISOLATE_NETWORK" default:"true"`
}

// ConnectionPoolConfig defines connection pool settings
type ConnectionPoolConfig struct {
	MaxPerServer        int           `yaml:"maxPerServer" envconfig:"MAX_PER_SERVER" default:"5"`
	MinPerServer        int           `yaml:"minPerServer" envconfig:"MIN_PER_SERVER" default:"1"`
	IdleTimeout         time.Duration `yaml:"idleTimeout" envconfig:"IDLE_TIMEOUT" default:"5m"`
	HealthCheckInterval time.Duration `yaml:"healthCheckInterval" envconfig:"HEALTH_CHECK_INTERVAL" default:"30s"`
	ConnectionTimeout   time.Duration `yaml:"connectionTimeout" envconfig:"CONNECTION_TIMEOUT" default:"10s"`
}

// SSHExecutionConfig defines SSH execution settings
type SSHExecutionConfig struct {
	DefaultShell string `yaml:"defaultShell" envconfig:"DEFAULT_SHELL" default:"/bin/bash"`
	TempDir      string `yaml:"tempDir" envconfig:"TEMP_DIR" default:"/tmp/cronium"`
	CleanupAfter bool   `yaml:"cleanupAfter" envconfig:"CLEANUP_AFTER" default:"true"`
	PTYMode      bool   `yaml:"ptyMode" envconfig:"PTY_MODE" default:"false"`
}

// CircuitBreakerConfig defines circuit breaker settings
type CircuitBreakerConfig struct {
	Enabled          bool          `yaml:"enabled" envconfig:"ENABLED" default:"true"`
	FailureThreshold int           `yaml:"failureThreshold" envconfig:"FAILURE_THRESHOLD" default:"5"`
	SuccessThreshold int           `yaml:"successThreshold" envconfig:"SUCCESS_THRESHOLD" default:"2"`
	Timeout          time.Duration `yaml:"timeout" envconfig:"TIMEOUT" default:"60s"`
	HalfOpenRequests int           `yaml:"halfOpenRequests" envconfig:"HALF_OPEN_REQUESTS" default:"3"`
}

// SSHSecurityConfig defines SSH security settings
type SSHSecurityConfig struct {
	StrictHostKeyChecking bool     `yaml:"strictHostKeyChecking" envconfig:"STRICT_HOST_KEY_CHECKING" default:"true"`
	KnownHostsFile        string   `yaml:"knownHostsFile" envconfig:"KNOWN_HOSTS_FILE" default:"/etc/cronium/known_hosts"`
	AllowedCiphers        []string `yaml:"allowedCiphers" envconfig:"ALLOWED_CIPHERS"`
	AllowedKeyExchanges   []string `yaml:"allowedKeyExchanges" envconfig:"ALLOWED_KEY_EXCHANGES"`
}

// FileLogConfig defines file logging settings
type FileLogConfig struct {
	Enabled    bool   `yaml:"enabled" envconfig:"ENABLED" default:"false"`
	Path       string `yaml:"path" envconfig:"PATH" default:"/var/log/cronium/orchestrator.log"`
	MaxSize    string `yaml:"maxSize" envconfig:"MAX_SIZE" default:"100MB"`
	MaxBackups int    `yaml:"maxBackups" envconfig:"MAX_BACKUPS" default:"10"`
	MaxAge     int    `yaml:"maxAge" envconfig:"MAX_AGE" default:"30"`
}

// WSLogConfig defines WebSocket logging settings
type WSLogConfig struct {
	Enabled       bool          `yaml:"enabled" envconfig:"ENABLED" default:"true"`
	BufferSize    int           `yaml:"bufferSize" envconfig:"BUFFER_SIZE" default:"1000"`
	FlushInterval time.Duration `yaml:"flushInterval" envconfig:"FLUSH_INTERVAL" default:"100ms"`
	BatchSize     int           `yaml:"batchSize" envconfig:"BATCH_SIZE" default:"50"`
	Compression   bool          `yaml:"compression" envconfig:"COMPRESSION" default:"true"`
}

// TracingConfig defines tracing settings
type TracingConfig struct {
	Enabled      bool    `yaml:"enabled" envconfig:"ENABLED" default:"false"`
	Provider     string  `yaml:"provider" envconfig:"PROVIDER" default:"opentelemetry"`
	Endpoint     string  `yaml:"endpoint" envconfig:"ENDPOINT"`
	SamplingRate float64 `yaml:"samplingRate" envconfig:"SAMPLING_RATE" default:"0.1"`
}

// ProfilingConfig defines profiling settings
type ProfilingConfig struct {
	Enabled bool `yaml:"enabled" envconfig:"ENABLED" default:"false"`
	Port    int  `yaml:"port" envconfig:"PORT" default:"6060"`
}

// TLSConfig defines TLS settings
type TLSConfig struct {
	Enabled  bool   `yaml:"enabled" envconfig:"ENABLED" default:"false"`
	CertFile string `yaml:"certFile" envconfig:"CERT_FILE"`
	KeyFile  string `yaml:"keyFile" envconfig:"KEY_FILE"`
	CAFile   string `yaml:"caFile" envconfig:"CA_FILE"`
}

// AuthenticationConfig defines authentication settings
type AuthenticationConfig struct {
	TokenRotation bool          `yaml:"tokenRotation" envconfig:"TOKEN_ROTATION" default:"true"`
	TokenTTL      time.Duration `yaml:"tokenTTL" envconfig:"TOKEN_TTL" default:"24h"`
}

// EncryptionConfig defines encryption settings
type EncryptionConfig struct {
	Algorithm     string `yaml:"algorithm" envconfig:"ALGORITHM" default:"aes-256-gcm"`
	KeyDerivation string `yaml:"keyDerivation" envconfig:"KEY_DERIVATION" default:"pbkdf2"`
}

// Load loads configuration from file and environment
func Load(configPath string) (*Config, error) {
	config := &Config{}
	
	// Set defaults
	setDefaults()
	
	// Load from file if specified
	if configPath != "" {
		viper.SetConfigFile(configPath)
	} else {
		// Search for config file in standard locations
		viper.SetConfigName("cronium-orchestrator")
		viper.SetConfigType("yaml")
		viper.AddConfigPath(".")
		viper.AddConfigPath("/etc/cronium")
		viper.AddConfigPath("$HOME/.cronium")
	}
	
	// Read config file
	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
		// Config file not found is not an error - we'll use defaults and env
	}
	
	// Unmarshal to struct
	if err := viper.Unmarshal(config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}
	
	// Apply environment variables
	if err := envconfig.Process("CRONIUM", config); err != nil {
		return nil, fmt.Errorf("failed to process environment variables: %w", err)
	}
	
	// Process special values
	if err := processConfig(config); err != nil {
		return nil, fmt.Errorf("failed to process config: %w", err)
	}
	
	// Validate configuration
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("configuration validation failed: %w", err)
	}
	
	return config, nil
}

// setDefaults sets default values
func setDefaults() {
	viper.SetDefault("orchestrator.id", "auto")
	viper.SetDefault("orchestrator.name", "cronium-orchestrator")
	viper.SetDefault("orchestrator.environment", "production")
	viper.SetDefault("orchestrator.region", "default")
	
	viper.SetDefault("jobs.pollInterval", "1s")
	viper.SetDefault("jobs.pollBatchSize", 10)
	viper.SetDefault("jobs.maxConcurrent", 5)
	viper.SetDefault("jobs.defaultTimeout", "1h")
	viper.SetDefault("jobs.queueStrategy", "priority")
	viper.SetDefault("jobs.leaseRenewal", "30s")
	
	viper.SetDefault("container.docker.endpoint", "unix:///var/run/docker.sock")
	viper.SetDefault("container.docker.version", "1.41")
	viper.SetDefault("container.resources.defaults.cpu", 0.5)
	viper.SetDefault("container.resources.defaults.memory", "512MB")
	viper.SetDefault("container.resources.defaults.disk", "1GB")
	viper.SetDefault("container.resources.defaults.pids", 100)
	viper.SetDefault("container.security.user", "1000:1000")
	viper.SetDefault("container.security.noNewPrivileges", true)
	viper.SetDefault("container.security.dropCapabilities", []string{"ALL"})
	
	viper.SetDefault("logging.level", "info")
	viper.SetDefault("logging.format", "json")
	viper.SetDefault("logging.output", "stdout")
	
	viper.SetDefault("monitoring.enabled", true)
	viper.SetDefault("monitoring.metricsPort", 9090)
	viper.SetDefault("monitoring.healthPort", 8080)
}

// processConfig processes special configuration values
func processConfig(config *Config) error {
	// Generate orchestrator ID if set to auto
	if config.Orchestrator.ID == "auto" || config.Orchestrator.ID == "" {
		hostname, _ := os.Hostname()
		config.Orchestrator.ID = fmt.Sprintf("orch-%s-%d", hostname, time.Now().Unix())
	}
	
	// Set orchestrator ID in API config
	config.API.OrchestratorID = config.Orchestrator.ID
	
	// Set WebSocket endpoint if not specified
	if config.API.WSEndpoint == "" && config.API.Endpoint != "" {
		wsEndpoint := strings.Replace(config.API.Endpoint, "http://", "ws://", 1)
		wsEndpoint = strings.Replace(wsEndpoint, "https://", "wss://", 1)
		config.API.WSEndpoint = wsEndpoint + "/socket"
	}
	
	// Set default drop capabilities if empty
	if len(config.Container.Security.DropCapabilities) == 0 {
		config.Container.Security.DropCapabilities = []string{"ALL"}
	}
	
	// Set default DNS servers if empty
	if len(config.Container.Network.DNS) == 0 {
		config.Container.Network.DNS = []string{"8.8.8.8", "8.8.4.4"}
	}
	
	// Parse resource sizes
	// TODO: Implement size parsing for memory and disk values
	
	return nil
}

// Validate validates the configuration
func (c *Config) Validate() error {
	var errors []string
	
	// Required fields
	if c.API.Endpoint == "" {
		errors = append(errors, "api.endpoint is required")
	}
	if c.API.Token == "" {
		errors = append(errors, "api.token is required")
	}
	
	// Validate ranges
	if c.Jobs.MaxConcurrent < 1 || c.Jobs.MaxConcurrent > 100 {
		errors = append(errors, "jobs.maxConcurrent must be between 1 and 100")
	}
	if c.Jobs.PollBatchSize < 1 || c.Jobs.PollBatchSize > 50 {
		errors = append(errors, "jobs.pollBatchSize must be between 1 and 50")
	}
	
	// Validate resource limits
	if c.Container.Resources.Defaults.CPU > c.Container.Resources.Limits.CPU {
		errors = append(errors, "container default CPU exceeds limit")
	}
	
	// Validate ports
	if c.Monitoring.MetricsPort < 1 || c.Monitoring.MetricsPort > 65535 {
		errors = append(errors, "monitoring.metricsPort must be a valid port number")
	}
	if c.Monitoring.HealthPort < 1 || c.Monitoring.HealthPort > 65535 {
		errors = append(errors, "monitoring.healthPort must be a valid port number")
	}
	
	if len(errors) > 0 {
		return fmt.Errorf("validation errors: %s", strings.Join(errors, "; "))
	}
	
	return nil
}

// Print prints the configuration (with secrets hidden)
func (c *Config) Print(w io.Writer) error {
	// Create a copy with secrets hidden
	safeCfg := *c
	safeCfg.API.Token = "***hidden***"
	
	// Marshal to YAML
	data, err := yaml.Marshal(&safeCfg)
	if err != nil {
		return err
	}
	
	_, err = w.Write(data)
	return err
}

// GetConfigPath returns the path to the config file
func GetConfigPath() string {
	if path := viper.ConfigFileUsed(); path != "" {
		return path
	}
	
	// Check standard locations
	locations := []string{
		"cronium-orchestrator.yaml",
		"/etc/cronium/cronium-orchestrator.yaml",
		filepath.Join(os.Getenv("HOME"), ".cronium", "cronium-orchestrator.yaml"),
	}
	
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			return loc
		}
	}
	
	return ""
}