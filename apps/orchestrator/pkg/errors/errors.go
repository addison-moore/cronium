package errors

import (
	"fmt"
)

// ErrorType categorizes errors for handling
type ErrorType string

const (
	// System errors
	ErrorTypeSystem        ErrorType = "system"
	ErrorTypeConfiguration ErrorType = "configuration"
	ErrorTypeResource      ErrorType = "resource"
	
	// Execution errors
	ErrorTypeExecution     ErrorType = "execution"
	ErrorTypeTimeout       ErrorType = "timeout"
	ErrorTypeValidation    ErrorType = "validation"
	
	// External service errors
	ErrorTypeDocker        ErrorType = "docker"
	ErrorTypeSSH           ErrorType = "ssh"
	ErrorTypeAPI           ErrorType = "api"
	ErrorTypeNetwork       ErrorType = "network"
	
	// User errors
	ErrorTypeScript        ErrorType = "script"
	ErrorTypePermission    ErrorType = "permission"
	ErrorTypeQuota         ErrorType = "quota"
)

// BaseError provides common error functionality
type BaseError struct {
	Type       ErrorType
	Code       string
	Message    string
	Details    map[string]interface{}
	Retryable  bool
	UserFacing bool
}

// Error implements the error interface
func (e *BaseError) Error() string {
	return fmt.Sprintf("[%s] %s: %s", e.Type, e.Code, e.Message)
}

// APIError represents backend API failures
type APIError struct {
	BaseError
	Endpoint   string
	StatusCode int
	Method     string
}

// NewAPIError creates a new API error
func NewAPIError(statusCode int, code, message string) *APIError {
	return &APIError{
		BaseError: BaseError{
			Type:      ErrorTypeAPI,
			Code:      code,
			Message:   message,
			Retryable: statusCode >= 500 || statusCode == 429,
		},
		StatusCode: statusCode,
	}
}

// DockerError represents Docker-specific failures
type DockerError struct {
	BaseError
	ContainerID string
	ImageName   string
	Operation   string
}

// NewDockerError creates a new Docker error
func NewDockerError(code, message, operation string) *DockerError {
	return &DockerError{
		BaseError: BaseError{
			Type:      ErrorTypeDocker,
			Code:      code,
			Message:   message,
			Retryable: false,
		},
		Operation: operation,
	}
}

// SSHError represents SSH connection/execution failures
type SSHError struct {
	BaseError
	ServerID  string
	Host      string
	Operation string
}

// NewSSHError creates a new SSH error
func NewSSHError(code, message, operation string) *SSHError {
	return &SSHError{
		BaseError: BaseError{
			Type:      ErrorTypeSSH,
			Code:      code,
			Message:   message,
			Retryable: true,
		},
		Operation: operation,
	}
}

// ValidationError represents input validation failures
type ValidationError struct {
	BaseError
	Field      string
	Value      interface{}
	Constraint string
}

// NewValidationError creates a new validation error
func NewValidationError(field, constraint, message string) *ValidationError {
	return &ValidationError{
		BaseError: BaseError{
			Type:       ErrorTypeValidation,
			Code:       "VALIDATION_ERROR",
			Message:    message,
			Retryable:  false,
			UserFacing: true,
		},
		Field:      field,
		Constraint: constraint,
	}
}

// NetworkError represents network-related errors
type NetworkError struct {
	BaseError
	Protocol string
	Endpoint string
}

// NewNetworkError creates a new network error
func NewNetworkError(message, protocol string) *NetworkError {
	return &NetworkError{
		BaseError: BaseError{
			Type:      ErrorTypeNetwork,
			Code:      "NETWORK_ERROR",
			Message:   message,
			Retryable: true, // Network errors are typically retryable
		},
		Protocol: protocol,
	}
}

// IsRetryable checks if an error is retryable
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	
	switch e := err.(type) {
	case *BaseError:
		return e.Retryable
	case *APIError:
		return e.Retryable
	case *DockerError:
		return e.Retryable
	case *SSHError:
		return e.Retryable
	case *NetworkError:
		return e.Retryable
	case *ValidationError:
		return false
	default:
		return false
	}
}

// GetErrorType returns the type of an error
func GetErrorType(err error) ErrorType {
	if err == nil {
		return ""
	}
	
	switch e := err.(type) {
	case *BaseError:
		return e.Type
	case *APIError:
		return e.Type
	case *DockerError:
		return e.Type
	case *SSHError:
		return e.Type
	case *NetworkError:
		return e.Type
	case *ValidationError:
		return e.Type
	default:
		return ErrorTypeSystem
	}
}