package types

import (
	"fmt"
	"time"
)

// UpdateType defines the type of execution update
type UpdateType string

const (
	UpdateTypeLog      UpdateType = "log"
	UpdateTypeStatus   UpdateType = "status"
	UpdateTypeProgress UpdateType = "progress"
	UpdateTypeError    UpdateType = "error"
	UpdateTypeComplete UpdateType = "complete"
)

// ExecutionUpdate represents a real-time update during execution
type ExecutionUpdate struct {
	Type      UpdateType
	Timestamp time.Time
	Data      interface{}
}

// LogEntry represents a log line from execution
type LogEntry struct {
	Stream    string    `json:"stream"`    // stdout, stderr
	Line      string    `json:"line"`
	Timestamp time.Time `json:"timestamp"`
	Sequence  int64     `json:"sequence"`
}

// StatusUpdate represents a status change
type StatusUpdate struct {
	Status    JobStatus              `json:"status"`
	Message   string                 `json:"message,omitempty"`
	ExitCode  *int                   `json:"exitCode,omitempty"`
	Error     *ErrorDetails          `json:"error,omitempty"`
	Output    *OutputData            `json:"output,omitempty"`
}

// ProgressUpdate represents execution progress
type ProgressUpdate struct {
	Percentage int    `json:"percentage,omitempty"`
	Message    string `json:"message"`
}

// ErrorDetails provides detailed error information
type ErrorDetails struct {
	Type      string                 `json:"type"`
	Code      string                 `json:"code"`
	Message   string                 `json:"message"`
	Retryable bool                   `json:"retryable"`
	Details   map[string]interface{} `json:"details,omitempty"`
}

// ExecutionError represents an execution failure
type ExecutionError struct {
	ErrorDetails
	JobID     string
	Timestamp time.Time
}

// Error implements the error interface
func (e *ExecutionError) Error() string {
	return fmt.Sprintf("[%s] %s: %s", e.Type, e.Code, e.Message)
}

// OutputData contains execution output
type OutputData struct {
	Data      interface{}            `json:"data,omitempty"`
	Variables map[string]interface{} `json:"variables,omitempty"`
	Files     map[string][]byte      `json:"files,omitempty"`
	Condition *bool                  `json:"condition,omitempty"`
	Stdout    string                 `json:"stdout,omitempty"`
	Stderr    string                 `json:"stderr,omitempty"`
}

// ExecutionMetrics contains execution performance metrics
type ExecutionMetrics struct {
	StartTime     time.Time `json:"startTime"`
	EndTime       time.Time `json:"endTime,omitempty"`
	Duration      int64     `json:"duration,omitempty"` // milliseconds
	ResourceUsage *ResourceUsage `json:"resourceUsage,omitempty"`
}

// ResourceUsage contains resource consumption metrics
type ResourceUsage struct {
	PeakCPU    float64 `json:"peakCpu,omitempty"`    // percentage
	PeakMemory int64   `json:"peakMemory,omitempty"` // bytes
	NetworkRx  int64   `json:"networkRx,omitempty"`  // bytes
	NetworkTx  int64   `json:"networkTx,omitempty"`  // bytes
	DiskRead   int64   `json:"diskRead,omitempty"`   // bytes
	DiskWrite  int64   `json:"diskWrite,omitempty"`  // bytes
}

// ErrorDetailsFromError creates ErrorDetails from an error
func ErrorDetailsFromError(err error) *ErrorDetails {
	if err == nil {
		return nil
	}
	
	// Check if it's already an ExecutionError
	if execErr, ok := err.(*ExecutionError); ok {
		return &execErr.ErrorDetails
	}
	
	// Create generic error details
	return &ErrorDetails{
		Type:      "generic",
		Code:      "EXECUTION_ERROR",
		Message:   err.Error(),
		Retryable: false,
	}
}

// NewLogEntry creates a new log entry
func NewLogEntry(stream, line string, sequence int64) *LogEntry {
	return &LogEntry{
		Stream:    stream,
		Line:      line,
		Timestamp: time.Now(),
		Sequence:  sequence,
	}
}

// NewStatusUpdate creates a new status update
func NewStatusUpdate(status JobStatus, message string) *StatusUpdate {
	return &StatusUpdate{
		Status:  status,
		Message: message,
	}
}

// NewProgressUpdate creates a new progress update
func NewProgressUpdate(percentage int, message string) *ProgressUpdate {
	return &ProgressUpdate{
		Percentage: percentage,
		Message:    message,
	}
}

// NewExecutionError creates a new execution error
func NewExecutionError(errType, code, message string, retryable bool) *ExecutionError {
	return &ExecutionError{
		ErrorDetails: ErrorDetails{
			Type:      errType,
			Code:      code,
			Message:   message,
			Retryable: retryable,
			Details:   make(map[string]interface{}),
		},
		Timestamp: time.Now(),
	}
}