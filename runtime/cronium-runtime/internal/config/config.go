package config

import (
	"fmt"
	"os"
	"time"

	"github.com/kelseyhightower/envconfig"
	"gopkg.in/yaml.v3"
)

// Config represents the runtime service configuration
type Config struct {
	Version string `yaml:"version" envconfig:"VERSION" default:"1.0.0"`
	
	Server   ServerConfig   `yaml:"server"`
	Cache    CacheConfig    `yaml:"cache"`
	Backend  BackendConfig  `yaml:"backend"`
	Auth     AuthConfig     `yaml:"auth"`
	Logging  LoggingConfig  `yaml:"logging"`
	Security SecurityConfig `yaml:"security"`
}

// ServerConfig defines HTTP server settings
type ServerConfig struct {
	Port         int           `yaml:"port" envconfig:"PORT" default:"8081"`
	ReadTimeout  time.Duration `yaml:"readTimeout" envconfig:"READ_TIMEOUT" default:"30s"`
	WriteTimeout time.Duration `yaml:"writeTimeout" envconfig:"WRITE_TIMEOUT" default:"30s"`
	IdleTimeout  time.Duration `yaml:"idleTimeout" envconfig:"IDLE_TIMEOUT" default:"120s"`
}

// CacheConfig defines Valkey cache settings
type CacheConfig struct {
	URL            string        `yaml:"url" envconfig:"VALKEY_URL" default:"valkey://localhost:6379"`
	Password       string        `yaml:"password" envconfig:"VALKEY_PASSWORD"`
	DB             int           `yaml:"db" envconfig:"VALKEY_DB" default:"0"`
	MaxRetries     int           `yaml:"maxRetries" envconfig:"VALKEY_MAX_RETRIES" default:"3"`
	DialTimeout    time.Duration `yaml:"dialTimeout" envconfig:"VALKEY_DIAL_TIMEOUT" default:"5s"`
	ReadTimeout    time.Duration `yaml:"readTimeout" envconfig:"VALKEY_READ_TIMEOUT" default:"3s"`
	WriteTimeout   time.Duration `yaml:"writeTimeout" envconfig:"VALKEY_WRITE_TIMEOUT" default:"3s"`
	PoolSize       int           `yaml:"poolSize" envconfig:"VALKEY_POOL_SIZE" default:"10"`
	MinIdleConns   int           `yaml:"minIdleConns" envconfig:"VALKEY_MIN_IDLE_CONNS" default:"2"`
	MaxConnAge     time.Duration `yaml:"maxConnAge" envconfig:"VALKEY_MAX_CONN_AGE" default:"30m"`
	TTL            time.Duration `yaml:"ttl" envconfig:"CACHE_TTL" default:"5m"`
}

// BackendConfig defines backend API settings
type BackendConfig struct {
	URL          string        `yaml:"url" envconfig:"BACKEND_URL" default:"http://localhost:5001"`
	Token        string        `yaml:"token" envconfig:"BACKEND_TOKEN"`
	Timeout      time.Duration `yaml:"timeout" envconfig:"BACKEND_TIMEOUT" default:"30s"`
	MaxRetries   int           `yaml:"maxRetries" envconfig:"BACKEND_MAX_RETRIES" default:"3"`
	RetryDelay   time.Duration `yaml:"retryDelay" envconfig:"BACKEND_RETRY_DELAY" default:"1s"`
}

// AuthConfig defines authentication settings
type AuthConfig struct {
	JWTSecret         string        `yaml:"jwtSecret" envconfig:"JWT_SECRET" required:"true"`
	TokenExpiration   time.Duration `yaml:"tokenExpiration" envconfig:"TOKEN_EXPIRATION" default:"1h"`
	RefreshExpiration time.Duration `yaml:"refreshExpiration" envconfig:"REFRESH_EXPIRATION" default:"24h"`
}

// LoggingConfig defines logging settings
type LoggingConfig struct {
	Level  string `yaml:"level" envconfig:"LOG_LEVEL" default:"info"`
	Format string `yaml:"format" envconfig:"LOG_FORMAT" default:"json"`
}

// SecurityConfig defines security settings
type SecurityConfig struct {
	EnableCORS      bool     `yaml:"enableCors" envconfig:"ENABLE_CORS" default:"true"`
	AllowedOrigins  []string `yaml:"allowedOrigins" envconfig:"ALLOWED_ORIGINS" default:"*"`
	AllowedMethods  []string `yaml:"allowedMethods" envconfig:"ALLOWED_METHODS" default:"GET,POST,PUT,DELETE,OPTIONS"`
	AllowedHeaders  []string `yaml:"allowedHeaders" envconfig:"ALLOWED_HEADERS" default:"*"`
	RateLimitPerMin int      `yaml:"rateLimitPerMin" envconfig:"RATE_LIMIT_PER_MIN" default:"1000"`
	EnableTLS       bool     `yaml:"enableTls" envconfig:"ENABLE_TLS" default:"false"`
	TLSCert         string   `yaml:"tlsCert" envconfig:"TLS_CERT"`
	TLSKey          string   `yaml:"tlsKey" envconfig:"TLS_KEY"`
}

// Load loads configuration from file and environment variables
func Load() (*Config, error) {
	cfg := &Config{}

	// Try to load from config file first
	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		configFile = "config.yaml"
	}

	if _, err := os.Stat(configFile); err == nil {
		data, err := os.ReadFile(configFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}

		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config file: %w", err)
		}
	}

	// Override with environment variables
	if err := envconfig.Process("RUNTIME", cfg); err != nil {
		return nil, fmt.Errorf("failed to process env vars: %w", err)
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	return cfg, nil
}

// Validate validates the configuration
func (c *Config) Validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("invalid server port: %d", c.Server.Port)
	}

	if c.Auth.JWTSecret == "" {
		return fmt.Errorf("JWT secret is required")
	}

	if c.Backend.URL == "" {
		return fmt.Errorf("backend URL is required")
	}

	return nil
}