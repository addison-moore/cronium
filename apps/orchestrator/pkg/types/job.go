package types

import (
	"time"
)

// JobType defines the type of job execution
type JobType string

const (
	JobTypeContainer JobType = "container"
	JobTypeSSH       JobType = "ssh"
)

// JobStatus represents the current status of a job
type JobStatus string

const (
	JobStatusPending      JobStatus = "pending"
	JobStatusAcknowledged JobStatus = "acknowledged"
	JobStatusPreparing    JobStatus = "preparing"
	JobStatusRunning      JobStatus = "running"
	JobStatusCompleted    JobStatus = "completed"
	JobStatusFailed       JobStatus = "failed"
	JobStatusTimeout      JobStatus = "timeout"
	JobStatusCancelled    JobStatus = "cancelled"
)

// Job represents a job to be executed
type Job struct {
	ID           string          `json:"id"`
	Type         JobType         `json:"type"`
	Priority     int             `json:"priority"`
	CreatedAt    time.Time       `json:"createdAt"`
	ScheduledFor *time.Time      `json:"scheduledFor,omitempty"`
	Attempts     int             `json:"attempts"`
	Execution    ExecutionConfig `json:"execution"`
	Metadata     map[string]any  `json:"metadata,omitempty"`

	// Runtime fields
	AcknowledgedAt *time.Time    `json:"-"`
	StartedAt      *time.Time    `json:"-"`
	CompletedAt    *time.Time    `json:"-"`
	LeaseExpiry    *time.Time    `json:"-"`
	Timeout        time.Duration `json:"-"`
}

// ExecutionConfig contains the job execution configuration
type ExecutionConfig struct {
	Target      Target            `json:"target"`
	Script      *Script           `json:"script,omitempty"`
	HTTP        *HTTPConfig       `json:"http,omitempty"`
	Environment map[string]string `json:"environment"`
	Timeout     time.Duration     `json:"timeout"`
	Resources   *Resources        `json:"resources,omitempty"`
	RetryPolicy *RetryPolicy      `json:"retryPolicy,omitempty"`

	// Workflow support
	InputData map[string]any `json:"inputData,omitempty"`
	Variables map[string]any `json:"variables,omitempty"`
}

// Target defines where to execute the job
type Target struct {
	Type          TargetType     `json:"type"`
	ServerID      *string        `json:"serverId,omitempty"`
	ServerDetails *ServerDetails `json:"serverDetails,omitempty"`
}

// TargetType defines the execution target type
type TargetType string

const (
	TargetTypeLocal  TargetType = "local"
	TargetTypeServer TargetType = "server"
)

// ServerDetails contains SSH server connection information
type ServerDetails struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	PrivateKey string `json:"privateKey,omitempty"` // Base64 encoded, optional
	Password   string `json:"password,omitempty"`   // Password for authentication, optional
	Passphrase string `json:"passphrase,omitempty"` // Passphrase for encrypted SSH keys
}

// Script contains the script to execute
type Script struct {
	Type             ScriptType `json:"type"`
	Content          string     `json:"content"`
	WorkingDirectory string     `json:"workingDirectory,omitempty"`
}

// ScriptType defines the script language
type ScriptType string

const (
	ScriptTypeBash   ScriptType = "BASH"
	ScriptTypePython ScriptType = "PYTHON"
	ScriptTypeNode   ScriptType = "NODE"
)

// HTTPConfig contains HTTP request configuration
type HTTPConfig struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    any               `json:"body,omitempty"`
}

// Resources defines resource constraints
type Resources struct {
	CPULimit    float64 `json:"cpuLimit,omitempty"`    // CPU cores
	MemoryLimit int64   `json:"memoryLimit,omitempty"` // Bytes
	DiskLimit   int64   `json:"diskLimit,omitempty"`   // Bytes
	PidsLimit   int64   `json:"pidsLimit,omitempty"`   // Process count
}

// RetryPolicy defines retry behavior
type RetryPolicy struct {
	MaxAttempts  int           `json:"maxAttempts"`
	BackoffType  string        `json:"backoffType"`
	BackoffDelay time.Duration `json:"backoffDelay"`
}

// GetJobType determines the job type from execution config
func (j *Job) GetJobType() JobType {
	if j.Execution.Target.Type == TargetTypeLocal {
		return JobTypeContainer
	}
	return JobTypeSSH
}

// GetTimeout returns the job timeout with default
func (j *Job) GetTimeout() time.Duration {
	// Use the runtime Timeout field if set
	if j.Timeout > 0 {
		return j.Timeout
	}
	// Fall back to execution config timeout
	if j.Execution.Timeout > 0 {
		return j.Execution.Timeout
	}
	// Default timeout
	return 1 * time.Hour
}

// IsRetryable checks if the job can be retried
func (j *Job) IsRetryable() bool {
	if j.Execution.RetryPolicy == nil {
		return false
	}
	return j.Attempts < j.Execution.RetryPolicy.MaxAttempts
}
