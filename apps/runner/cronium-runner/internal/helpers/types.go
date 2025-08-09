package helpers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Mode represents the helper operation mode
type Mode string

const (
	// BundledMode uses file-based communication for offline execution
	BundledMode Mode = "bundled"
	// APIMode uses HTTP API for online execution
	APIMode Mode = "api"
)

// Config holds the configuration for runtime helpers
type Config struct {
	Mode        Mode   `json:"mode"`
	ExecutionID string `json:"execution_id"`
	JobID       string `json:"job_id"`
	EventID     string `json:"event_id"`
	WorkDir     string `json:"work_dir"`
	APIEndpoint string `json:"api_endpoint,omitempty"`
	APIToken    string `json:"api_token,omitempty"`
}

// InputData represents the input data structure
type InputData struct {
	Data interface{} `json:"data"`
}

// OutputData represents the output data structure
type OutputData struct {
	Data interface{} `json:"data"`
}

// VariableData represents a variable key-value pair
type VariableData struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

// EventContext represents the event execution context
type EventContext struct {
	EventID     string                 `json:"eventId"`
	EventName   string                 `json:"eventName"`
	ExecutionID string                 `json:"executionId"`
	JobID       string                 `json:"jobId"`
	Trigger     string                 `json:"trigger"`
	StartTime   string                 `json:"startTime"`
	Environment map[string]string      `json:"environment"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// LoadConfig loads the helper configuration from environment or file
func LoadConfig() (*Config, error) {
	// First try to load from environment
	if mode := os.Getenv("CRONIUM_HELPER_MODE"); mode != "" {
		config := &Config{
			Mode:        Mode(mode),
			ExecutionID: os.Getenv("CRONIUM_EXECUTION_ID"),
			JobID:       os.Getenv("CRONIUM_JOB_ID"),
			EventID:     os.Getenv("CRONIUM_EVENT_ID"),
			WorkDir:     os.Getenv("CRONIUM_WORK_DIR"),
			APIEndpoint: os.Getenv("CRONIUM_API_ENDPOINT"),
			APIToken:    os.Getenv("CRONIUM_API_TOKEN"),
		}
		
		if config.WorkDir == "" {
			config.WorkDir = "."
		}
		
		return config, nil
	}
	
	// Fall back to config file
	configPath := filepath.Join(".", ".cronium", "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		// Default to bundled mode if no config found
		return &Config{
			Mode:    BundledMode,
			WorkDir: ".",
		}, nil
	}
	
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}
	
	if config.WorkDir == "" {
		config.WorkDir = "."
	}
	
	return &config, nil
}

// WriteJSON writes data to a JSON file
func WriteJSON(path string, data interface{}) error {
	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	
	// Marshal data
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal data: %w", err)
	}
	
	// Write file
	if err := os.WriteFile(path, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}
	
	return nil
}

// ReadJSON reads data from a JSON file
func ReadJSON(path string, data interface{}) error {
	jsonData, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file not found: %s", path)
		}
		return fmt.Errorf("failed to read file: %w", err)
	}
	
	if err := json.Unmarshal(jsonData, data); err != nil {
		return fmt.Errorf("failed to unmarshal data: %w", err)
	}
	
	return nil
}