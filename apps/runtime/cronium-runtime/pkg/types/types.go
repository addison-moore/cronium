package types

import (
	"time"
)

// ExecutionContext represents the context for a running execution.
//
// The app's context route (canonical shape:
// tests/fixtures/internal-api/executions-context.json) carries the event's
// name/type only inside a nested "event" object — there are no top-level
// eventName/eventType fields on the wire (FINDINGS #36). Event models that
// nested object; the backend client flattens it into EventName/EventType so
// the script-facing handlers and SDKs keep their flat contract.
type ExecutionContext struct {
	ExecutionID string                 `json:"executionId"`
	EventID     string                 `json:"eventId"`
	EventName   string                 `json:"eventName"`
	EventType   string                 `json:"eventType"`
	UserID      string                 `json:"userId"`
	StartTime   time.Time              `json:"startTime"`
	Metadata    map[string]interface{} `json:"metadata"`
	Event       *ExecutionEvent        `json:"event,omitempty"`
}

// ExecutionEvent is the nested "event" object on the app's context route.
// Null when the execution has no associated event (fixture scenario
// "successNoEvent").
type ExecutionEvent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	RunLocation string `json:"runLocation,omitempty"`
}

// Variable represents a user-defined variable
type Variable struct {
	Key       string      `json:"key"`
	Value     interface{} `json:"value"`
	Type      string      `json:"type"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

// ToolActionConfig represents configuration for executing a tool action
type ToolActionConfig struct {
	Tool   string                 `json:"tool"`
	Action string                 `json:"action"`
	Params map[string]interface{} `json:"params"`
}

// ToolActionResult represents the result of a tool action execution
type ToolActionResult struct {
	Success  bool                   `json:"success"`
	Data     interface{}            `json:"data"`
	Error    string                 `json:"error,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ErrorResponse represents an API error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

// SuccessResponse represents a successful API response
type SuccessResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
}

// InputData represents input data for an execution
type InputData struct {
	Data      interface{} `json:"data"`
	Timestamp time.Time   `json:"timestamp"`
}

// OutputData represents output data from an execution
type OutputData struct {
	Data      interface{} `json:"data"`
	Timestamp time.Time   `json:"timestamp"`
}

// ConditionResult represents a workflow condition result
type ConditionResult struct {
	Result    bool      `json:"result"`
	Timestamp time.Time `json:"timestamp"`
}

// TokenClaims represents JWT token claims
type TokenClaims struct {
	JobID       string    `json:"jobId"`
	ExecutionID string    `json:"executionId"`
	UserID      string    `json:"userId"`
	EventID     string    `json:"eventId"`
	Capability  string    `json:"capabilityToken,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt"`
	IssuedAt    time.Time `json:"issuedAt"`
}

// CacheKey generates a cache key for various operations
type CacheKey struct {
	Type        string
	ExecutionID string
	Key         string
}

// String returns the string representation of the cache key
func (c CacheKey) String() string {
	if c.Key != "" {
		return c.Type + ":" + c.ExecutionID + ":" + c.Key
	}
	return c.Type + ":" + c.ExecutionID
}
