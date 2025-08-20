package retry

import (
	"context"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/sirupsen/logrus"
)

// Config defines retry configuration
type Config struct {
	MaxAttempts  int
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Multiplier   float64
}

// DefaultConfig returns default retry configuration
func DefaultConfig() Config {
	return Config{
		MaxAttempts:  3,
		InitialDelay: 1 * time.Second,
		MaxDelay:     30 * time.Second,
		Multiplier:   2.0,
	}
}

// Operation is a function that can be retried
type Operation func() error

// WithRetry executes an operation with retry logic
func WithRetry(ctx context.Context, cfg Config, operation Operation, log *logrus.Entry) error {
	var lastErr error
	delay := cfg.InitialDelay

	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		// Check context before attempt
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Execute operation
		lastErr = operation()
		if lastErr == nil {
			return nil
		}

		// Check if error is retryable
		if !isRetryable(lastErr) {
			log.WithError(lastErr).Debug("Error is not retryable")
			return lastErr
		}

		// Don't retry if this was the last attempt
		if attempt == cfg.MaxAttempts {
			break
		}

		// Log retry attempt
		log.WithFields(logrus.Fields{
			"attempt": attempt,
			"delay":   delay,
			"error":   lastErr,
		}).Debug("Retrying operation")

		// Wait before retry
		select {
		case <-time.After(delay):
			// Continue to next attempt
		case <-ctx.Done():
			return ctx.Err()
		}

		// Calculate next delay with exponential backoff
		delay = time.Duration(float64(delay) * cfg.Multiplier)
		if delay > cfg.MaxDelay {
			delay = cfg.MaxDelay
		}
	}

	return lastErr
}

// isRetryable determines if an error should trigger a retry
func isRetryable(err error) bool {
	if err == nil {
		return false
	}

	// Check for typed errors
	switch e := err.(type) {
	case *errors.BaseError:
		return e.Retryable
	case *errors.APIError:
		return e.Retryable
	case *errors.DockerError:
		return e.Retryable
	case *errors.SSHError:
		return e.Retryable
	}

	// Check error type
	errType := errors.GetErrorType(err)
	switch errType {
	case errors.ErrorTypeNetwork:
		return true
	case errors.ErrorTypeTimeout:
		return false // Timeouts shouldn't be retried
	case errors.ErrorTypeValidation:
		return false
	case errors.ErrorTypePermission:
		return false
	default:
		return false
	}
}

// AsyncRetry performs retry in background with result callback
type AsyncResult struct {
	Success  bool
	Error    error
	Attempts int
}

// WithAsyncRetry executes an operation with retry logic in background
func WithAsyncRetry(ctx context.Context, cfg Config, operation Operation, log *logrus.Entry, callback func(AsyncResult)) {
	go func() {
		attempts := 0
		err := WithRetry(ctx, cfg, func() error {
			attempts++
			return operation()
		}, log)

		callback(AsyncResult{
			Success:  err == nil,
			Error:    err,
			Attempts: attempts,
		})
	}()
}
