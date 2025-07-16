package api

import (
	"time"

	"github.com/addison-more/cronium/orchestrator/pkg/types"
)

// API Request/Response types

// PollJobsResponse is the response from polling jobs
type PollJobsResponse struct {
	Jobs     []QueuedJob `json:"jobs"`
	Metadata struct {
		Timestamp      string `json:"timestamp"`
		NextPollAfter  string `json:"nextPollAfter,omitempty"`
		QueueSize      int    `json:"queueSize"`
	} `json:"metadata"`
}

// QueuedJob represents a job from the API
type QueuedJob struct {
	ID           string                 `json:"id"`
	Type         string                 `json:"type"`
	Priority     int                    `json:"priority"`
	CreatedAt    time.Time              `json:"createdAt"`
	ScheduledFor *time.Time             `json:"scheduledFor,omitempty"`
	Attempts     int                    `json:"attempts"`
	Execution    ExecutionConfig        `json:"execution"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// ExecutionConfig from API
type ExecutionConfig struct {
	Target      Target                 `json:"target"`
	Script      *Script                `json:"script,omitempty"`
	HTTP        *HTTPConfig            `json:"http,omitempty"`
	Environment map[string]string      `json:"environment"`
	Timeout     int                    `json:"timeout"` // seconds
	Resources   *Resources             `json:"resources,omitempty"`
	RetryPolicy *RetryPolicy           `json:"retryPolicy,omitempty"`
	InputData   map[string]interface{} `json:"inputData,omitempty"`
	Variables   map[string]interface{} `json:"variables,omitempty"`
}

// Target from API
type Target struct {
	Type          string         `json:"type"`
	ServerID      *string        `json:"serverId,omitempty"`
	ServerDetails *ServerDetails `json:"serverDetails,omitempty"`
}

// ServerDetails from API
type ServerDetails struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase,omitempty"`
}

// Script from API
type Script struct {
	Type             string `json:"type"`
	Content          string `json:"content"`
	WorkingDirectory string `json:"workingDirectory,omitempty"`
}

// HTTPConfig from API
type HTTPConfig struct {
	Method  string                 `json:"method"`
	URL     string                 `json:"url"`
	Headers map[string]string      `json:"headers,omitempty"`
	Body    interface{}            `json:"body,omitempty"`
}

// Resources from API
type Resources struct {
	CPULimit    float64 `json:"cpuLimit,omitempty"`
	MemoryLimit int64   `json:"memoryLimit,omitempty"`
	DiskLimit   int64   `json:"diskLimit,omitempty"`
	PidsLimit   int64   `json:"pidsLimit,omitempty"`
}

// RetryPolicy from API
type RetryPolicy struct {
	MaxAttempts  int `json:"maxAttempts"`
	BackoffType  string `json:"backoffType"`
	BackoffDelay int `json:"backoffDelay"` // seconds
}

// AcknowledgeRequest is sent to acknowledge a job
type AcknowledgeRequest struct {
	OrchestratorID     string `json:"orchestratorId"`
	Timestamp          string `json:"timestamp"`
	EstimatedStartTime string `json:"estimatedStartTime,omitempty"`
}

// AcknowledgeResponse is the response from acknowledging a job
type AcknowledgeResponse struct {
	Success bool `json:"success"`
	Lease   struct {
		ExpiresAt    string `json:"expiresAt"`
		RenewalToken string `json:"renewalToken"`
	} `json:"lease"`
}

// UpdateStatusRequest updates job status
type UpdateStatusRequest struct {
	Status    types.JobStatus `json:"status"`
	Timestamp string          `json:"timestamp"`
	Details   *StatusDetails  `json:"details,omitempty"`
}

// StatusDetails contains optional status details
type StatusDetails struct {
	Message  string                `json:"message,omitempty"`
	ExitCode *int                  `json:"exitCode,omitempty"`
	Error    *types.ErrorDetails   `json:"error,omitempty"`
	Output   *OutputSummary        `json:"output,omitempty"`
	Metrics  *types.ExecutionMetrics `json:"metrics,omitempty"`
}

// OutputSummary summarizes job output
type OutputSummary struct {
	Stdout OutputInfo `json:"stdout"`
	Stderr OutputInfo `json:"stderr"`
}

// OutputInfo contains output statistics
type OutputInfo struct {
	Lines     int  `json:"lines"`
	Bytes     int  `json:"bytes"`
	Truncated bool `json:"truncated"`
}

// UpdateStatusResponse is the response from updating status
type UpdateStatusResponse struct {
	Success    bool   `json:"success"`
	Timestamp  string `json:"timestamp"`
	NextAction string `json:"nextAction,omitempty"`
}

// CompleteJobRequest marks a job as complete
type CompleteJobRequest struct {
	Status    types.JobStatus          `json:"status"`
	ExitCode  int                      `json:"exitCode"`
	Output    Output                   `json:"output"`
	Artifacts *Artifacts               `json:"artifacts,omitempty"`
	Metrics   types.ExecutionMetrics   `json:"metrics"`
	Timestamp string                   `json:"timestamp"`
}

// Output contains job output
type Output struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
}

// Artifacts contains job artifacts
type Artifacts struct {
	Variables map[string]interface{} `json:"variables,omitempty"`
	Files     []FileArtifact         `json:"files,omitempty"`
}

// FileArtifact represents an output file
type FileArtifact struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	MimeType  string `json:"mimeType"`
	Content   string `json:"content,omitempty"`
	UploadURL string `json:"uploadUrl,omitempty"`
}

// HealthReport is sent periodically
type HealthReport struct {
	OrchestratorID string                          `json:"orchestratorId"`
	Timestamp      string                          `json:"timestamp"`
	Status         string                          `json:"status"`
	Version        string                          `json:"version"`
	Uptime         int64                           `json:"uptime"`
	Components     map[string]ComponentHealth      `json:"components"`
	Metrics        map[string]interface{}          `json:"metrics"`
}

// ComponentHealth represents health of a component
type ComponentHealth struct {
	Status    string                 `json:"status"`
	LastCheck string                 `json:"lastCheck"`
	Message   string                 `json:"message,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// ErrorResponse is the standard error response
type ErrorResponse struct {
	Error struct {
		Code      string                 `json:"code"`
		Message   string                 `json:"message"`
		Details   map[string]interface{} `json:"details,omitempty"`
		Timestamp string                 `json:"timestamp"`
		TraceID   string                 `json:"traceId,omitempty"`
	} `json:"error"`
}

// WebSocket Message Types

// WSMessage is a WebSocket message
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// AuthenticateMessage authenticates WebSocket connection
type AuthenticateMessage struct {
	Token          string `json:"token"`
	OrchestratorID string `json:"orchestratorId"`
	Version        string `json:"version"`
}

// LogMessage streams log entries
type LogMessage struct {
	JobID   string            `json:"jobId"`
	Entries []types.LogEntry  `json:"entries"`
}

// StatusMessage updates job status via WebSocket
type StatusMessage struct {
	JobID     string              `json:"jobId"`
	Status    types.JobStatus     `json:"status"`
	Timestamp string              `json:"timestamp"`
	Details   interface{}         `json:"details,omitempty"`
}

// PingMessage is a heartbeat message
type PingMessage struct {
	Timestamp string `json:"timestamp"`
}

// AckMessage acknowledges a WebSocket message
type AckMessage struct {
	MessageID string `json:"messageId"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}