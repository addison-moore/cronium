package types

import "time"

// ScriptType represents the type of script to execute
type ScriptType string

const (
	ScriptTypeBash   ScriptType = "BASH"
	ScriptTypePython ScriptType = "PYTHON"
	ScriptTypeNode   ScriptType = "NODE"
)

// Manifest represents the payload manifest
type Manifest struct {
	Version     string            `yaml:"version"`
	Interpreter ScriptType        `yaml:"interpreter"`
	Entrypoint  string            `yaml:"entrypoint"`
	Environment map[string]string `yaml:"environment,omitempty"`
	Metadata    Metadata          `yaml:"metadata"`
}

// Metadata contains execution metadata
type Metadata struct {
	JobID        string                 `yaml:"jobId,omitempty"`
	EventID      string                 `yaml:"eventId"`
	EventVersion int                    `yaml:"eventVersion"`
	CreatedAt    time.Time              `yaml:"createdAt"`
	ExecutionID  string                 `yaml:"executionId,omitempty"`
	EventName    string                 `yaml:"eventName,omitempty"`
	Trigger      string                 `yaml:"trigger,omitempty"`
	APIEndpoint  string                 `yaml:"apiEndpoint,omitempty"`
	APIToken     string                 `yaml:"apiToken,omitempty"`
	InputData    interface{}            `yaml:"inputData,omitempty"`
	Extra        map[string]interface{} `yaml:"extra,omitempty"`
}

