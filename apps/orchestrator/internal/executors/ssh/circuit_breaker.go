package ssh

import (
	"sync"
	"time"
)

// CircuitBreakerState represents the state of a circuit breaker
type CircuitBreakerState int

const (
	StateClosed CircuitBreakerState = iota
	StateOpen
	StateHalfOpen
)

// CircuitBreaker implements the circuit breaker pattern for SSH connections
type CircuitBreaker struct {
	mu               sync.RWMutex
	failureThreshold int
	successThreshold int
	timeout          time.Duration

	state            CircuitBreakerState
	failures         int
	successes        int
	lastFailureTime  time.Time
	halfOpenRequests int
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker(failureThreshold, successThreshold int, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		failureThreshold: failureThreshold,
		successThreshold: successThreshold,
		timeout:          timeout,
		state:            StateClosed,
	}
}

// Allow checks if a request is allowed
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()

	switch cb.state {
	case StateClosed:
		return true

	case StateOpen:
		// Check if timeout has passed
		if now.Sub(cb.lastFailureTime) > cb.timeout {
			cb.state = StateHalfOpen
			cb.halfOpenRequests = 0
			cb.successes = 0
			return true
		}
		return false

	case StateHalfOpen:
		// Allow limited requests in half-open state
		if cb.halfOpenRequests < 3 {
			cb.halfOpenRequests++
			return true
		}
		return false

	default:
		return false
	}
}

// RecordSuccess records a successful request
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.failures = 0

	case StateHalfOpen:
		cb.successes++
		if cb.successes >= cb.successThreshold {
			cb.state = StateClosed
			cb.failures = 0
			cb.successes = 0
		}

	case StateOpen:
		// Shouldn't happen, but reset if it does
		cb.state = StateClosed
		cb.failures = 0
		cb.successes = 0
	}
}

// RecordFailure records a failed request
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.lastFailureTime = time.Now()

	switch cb.state {
	case StateClosed:
		cb.failures++
		if cb.failures >= cb.failureThreshold {
			cb.state = StateOpen
		}

	case StateHalfOpen:
		// Failure in half-open state immediately opens the circuit
		cb.state = StateOpen
		cb.failures = cb.failureThreshold

	case StateOpen:
		// Already open, just update failure time
	}
}

// GetState returns the current state
func (cb *CircuitBreaker) GetState() CircuitBreakerState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// Reset resets the circuit breaker
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.state = StateClosed
	cb.failures = 0
	cb.successes = 0
	cb.halfOpenRequests = 0
}
