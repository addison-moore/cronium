package config

import (
	"os"
	"strconv"
	"time"
)

// TimeoutConfig holds timeout configuration for different execution phases
type TimeoutConfig struct {
	// SetupTimeout is the maximum time allowed for setup phase (container creation, SSH connection, etc.)
	SetupTimeout time.Duration
	
	// CleanupTimeout is the maximum time allowed for cleanup phase
	CleanupTimeout time.Duration
	
	// MaxExecutionTimeout is the maximum time allowed for script execution (caps user-configured timeout)
	MaxExecutionTimeout time.Duration
}

// LoadTimeoutConfig loads timeout configuration from environment variables
func LoadTimeoutConfig() TimeoutConfig {
	return TimeoutConfig{
		SetupTimeout:        getDurationFromEnv("CRONIUM_SETUP_TIMEOUT", 5*time.Minute),
		CleanupTimeout:      getDurationFromEnv("CRONIUM_CLEANUP_TIMEOUT", 1*time.Minute),
		MaxExecutionTimeout: getDurationFromEnv("CRONIUM_MAX_EXECUTION_TIMEOUT", 24*time.Hour),
	}
}

// getDurationFromEnv reads a duration from environment variable (expects seconds)
func getDurationFromEnv(key string, defaultValue time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	
	// Parse as seconds
	seconds, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	
	return time.Duration(seconds) * time.Second
}

// GetDefaultTimeoutConfig returns the default timeout configuration
func GetDefaultTimeoutConfig() TimeoutConfig {
	return TimeoutConfig{
		SetupTimeout:        5 * time.Minute,
		CleanupTimeout:      1 * time.Minute,
		MaxExecutionTimeout: 24 * time.Hour,
	}
}