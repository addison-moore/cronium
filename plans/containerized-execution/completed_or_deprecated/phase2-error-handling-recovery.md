# Phase 2: Error Handling and Recovery Mechanisms

## Overview

This document defines comprehensive error handling and recovery strategies for the Cronium orchestrator, ensuring resilient operation and graceful degradation under failure conditions.

## Error Classification

### Error Hierarchy

```go
// BaseError provides common error functionality
type BaseError struct {
    Type       ErrorType
    Code       string
    Message    string
    Details    map[string]interface{}
    Timestamp  time.Time
    TraceID    string
    Retryable  bool
    UserFacing bool
}

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

// Error implements the error interface
func (e *BaseError) Error() string {
    return fmt.Sprintf("[%s] %s: %s", e.Type, e.Code, e.Message)
}

// Unwrap supports error wrapping
func (e *BaseError) Unwrap() error {
    if cause, ok := e.Details["cause"].(error); ok {
        return cause
    }
    return nil
}
```

### Specific Error Types

```go
// ExecutionError represents job execution failures
type ExecutionError struct {
    BaseError
    JobID      string
    ExitCode   int
    Output     string
    StartTime  time.Time
    EndTime    time.Time
}

// DockerError represents Docker-specific failures
type DockerError struct {
    BaseError
    ContainerID string
    ImageName   string
    Operation   string
}

// SSHError represents SSH connection/execution failures
type SSHError struct {
    BaseError
    ServerID   string
    Host       string
    Operation  string
}

// APIError represents backend API failures
type APIError struct {
    BaseError
    Endpoint   string
    StatusCode int
    Method     string
}

// ValidationError represents input validation failures
type ValidationError struct {
    BaseError
    Field      string
    Value      interface{}
    Constraint string
}
```

## Error Detection

### Proactive Error Detection

```go
// ErrorDetector proactively identifies potential failures
type ErrorDetector struct {
    healthCheckers []HealthChecker
    thresholds     ErrorThresholds
    alerter        Alerter
}

// HealthChecker interface for component health monitoring
type HealthChecker interface {
    Name() string
    Check(ctx context.Context) error
    Critical() bool
}

// Built-in health checkers
type DockerHealthChecker struct {
    client *docker.Client
}

func (d *DockerHealthChecker) Check(ctx context.Context) error {
    _, err := d.client.Ping(ctx)
    if err != nil {
        return &DockerError{
            BaseError: BaseError{
                Type:    ErrorTypeDocker,
                Code:    "DOCKER_UNREACHABLE",
                Message: "Docker daemon is not responding",
            },
        }
    }
    return nil
}

type APIHealthChecker struct {
    client *APIClient
}

func (a *APIHealthChecker) Check(ctx context.Context) error {
    if err := a.client.HealthCheck(ctx); err != nil {
        return &APIError{
            BaseError: BaseError{
                Type:    ErrorTypeAPI,
                Code:    "API_UNREACHABLE",
                Message: "Backend API is not responding",
            },
        }
    }
    return nil
}

// Continuous health monitoring
func (d *ErrorDetector) StartMonitoring(ctx context.Context) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            d.runHealthChecks(ctx)
        case <-ctx.Done():
            return
        }
    }
}
```

### Error Context Enrichment

```go
// ErrorContext provides rich context for errors
type ErrorContext struct {
    JobID         string
    ExecutorType  string
    Operation     string
    ResourceUsage ResourceMetrics
    SystemState   SystemMetrics
    RecentLogs    []LogEntry
}

// EnrichError adds context to errors
func EnrichError(err error, ctx ErrorContext) error {
    baseErr, ok := err.(*BaseError)
    if !ok {
        baseErr = &BaseError{
            Type:    ErrorTypeSystem,
            Message: err.Error(),
        }
    }

    baseErr.Details["context"] = ctx
    baseErr.TraceID = generateTraceID()
    baseErr.Timestamp = time.Now()

    return baseErr
}

// Error pattern detection
type ErrorPatternDetector struct {
    patterns []ErrorPattern
    history  *ErrorHistory
}

type ErrorPattern struct {
    Name      string
    Matcher   func(error) bool
    Threshold int
    Window    time.Duration
    Action    RecoveryAction
}

// Detect recurring error patterns
func (d *ErrorPatternDetector) Analyze(err error) *RecoveryAction {
    for _, pattern := range d.patterns {
        if pattern.Matcher(err) {
            count := d.history.Count(pattern.Name, pattern.Window)
            if count >= pattern.Threshold {
                return &pattern.Action
            }
        }
    }
    return nil
}
```

## Recovery Strategies

### Retry Mechanisms

```go
// RetryPolicy defines retry behavior
type RetryPolicy struct {
    MaxAttempts     int
    InitialDelay    time.Duration
    MaxDelay        time.Duration
    BackoffType     BackoffType
    RetryableErrors []ErrorType
}

type BackoffType string

const (
    BackoffTypeFixed       BackoffType = "fixed"
    BackoffTypeLinear      BackoffType = "linear"
    BackoffTypeExponential BackoffType = "exponential"
)

// RetryExecutor handles retry logic
type RetryExecutor struct {
    policy RetryPolicy
    jitter float64
}

// ExecuteWithRetry performs an operation with retry logic
func (r *RetryExecutor) ExecuteWithRetry(ctx context.Context, operation func() error) error {
    var lastErr error

    for attempt := 0; attempt <= r.policy.MaxAttempts; attempt++ {
        if attempt > 0 {
            delay := r.calculateDelay(attempt)
            select {
            case <-time.After(delay):
            case <-ctx.Done():
                return ctx.Err()
            }
        }

        err := operation()
        if err == nil {
            return nil
        }

        lastErr = err

        if !r.isRetryable(err) {
            return err
        }

        log.Printf("Attempt %d failed: %v, retrying...", attempt+1, err)
    }

    return fmt.Errorf("operation failed after %d attempts: %w", r.policy.MaxAttempts, lastErr)
}

// Calculate delay with backoff and jitter
func (r *RetryExecutor) calculateDelay(attempt int) time.Duration {
    var delay time.Duration

    switch r.policy.BackoffType {
    case BackoffTypeFixed:
        delay = r.policy.InitialDelay
    case BackoffTypeLinear:
        delay = time.Duration(attempt) * r.policy.InitialDelay
    case BackoffTypeExponential:
        delay = time.Duration(math.Pow(2, float64(attempt))) * r.policy.InitialDelay
    }

    // Apply max delay cap
    if delay > r.policy.MaxDelay {
        delay = r.policy.MaxDelay
    }

    // Add jitter
    if r.jitter > 0 {
        jitterAmount := time.Duration(rand.Float64() * r.jitter * float64(delay))
        delay += jitterAmount
    }

    return delay
}
```

### Circuit Breaker Pattern

```go
// CircuitBreaker prevents cascading failures
type CircuitBreaker struct {
    name            string
    maxFailures     int
    resetTimeout    time.Duration
    halfOpenMax     int
    onStateChange   func(CircuitState)

    mu              sync.Mutex
    state           CircuitState
    failures        int
    lastFailureTime time.Time
    halfOpenTests   int
}

type CircuitState string

const (
    CircuitClosed    CircuitState = "closed"
    CircuitOpen      CircuitState = "open"
    CircuitHalfOpen  CircuitState = "half-open"
)

// Execute with circuit breaker protection
func (cb *CircuitBreaker) Execute(operation func() error) error {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    switch cb.state {
    case CircuitOpen:
        if time.Since(cb.lastFailureTime) > cb.resetTimeout {
            cb.transitionTo(CircuitHalfOpen)
            cb.halfOpenTests = 0
        } else {
            return &BaseError{
                Type:    ErrorTypeSystem,
                Code:    "CIRCUIT_OPEN",
                Message: fmt.Sprintf("Circuit breaker %s is open", cb.name),
            }
        }

    case CircuitHalfOpen:
        if cb.halfOpenTests >= cb.halfOpenMax {
            return &BaseError{
                Type:    ErrorTypeSystem,
                Code:    "CIRCUIT_HALF_OPEN_LIMIT",
                Message: fmt.Sprintf("Circuit breaker %s half-open test limit reached", cb.name),
            }
        }
        cb.halfOpenTests++
    }

    err := operation()

    if err == nil {
        cb.onSuccess()
    } else {
        cb.onFailure()
    }

    return err
}

// Handle successful operation
func (cb *CircuitBreaker) onSuccess() {
    switch cb.state {
    case CircuitHalfOpen:
        cb.transitionTo(CircuitClosed)
    case CircuitClosed:
        cb.failures = 0
    }
}

// Handle failed operation
func (cb *CircuitBreaker) onFailure() {
    cb.failures++
    cb.lastFailureTime = time.Now()

    if cb.failures >= cb.maxFailures {
        cb.transitionTo(CircuitOpen)
    }
}
```

### Fallback Mechanisms

```go
// FallbackChain provides cascading fallback options
type FallbackChain struct {
    strategies []FallbackStrategy
}

// FallbackStrategy defines a fallback option
type FallbackStrategy interface {
    Name() string
    CanHandle(error) bool
    Execute(context.Context, *Job) error
}

// Executor fallback strategies
type DirectExecutionFallback struct {
    enabled bool
}

func (d *DirectExecutionFallback) Execute(ctx context.Context, job *Job) error {
    if !d.enabled {
        return fmt.Errorf("direct execution fallback is disabled")
    }

    log.Warn("Falling back to direct execution (SECURITY RISK)")
    // Implementation for emergency direct execution
    return nil
}

type AlternateServerFallback struct {
    servers []Server
}

func (a *AlternateServerFallback) Execute(ctx context.Context, job *Job) error {
    for _, server := range a.servers {
        if err := executeOnServer(ctx, job, server); err == nil {
            return nil
        }
    }
    return fmt.Errorf("all fallback servers failed")
}

type QueueForRetryFallback struct {
    queue RetryQueue
}

func (q *QueueForRetryFallback) Execute(ctx context.Context, job *Job) error {
    return q.queue.Enqueue(job, time.Now().Add(5*time.Minute))
}
```

## Graceful Degradation

### Service Degradation Levels

```go
// DegradationLevel defines service capability levels
type DegradationLevel int

const (
    DegradationNone DegradationLevel = iota
    DegradationMinor
    DegradationMajor
    DegradationCritical
)

// ServiceDegradation manages graceful degradation
type ServiceDegradation struct {
    level      DegradationLevel
    components map[string]ComponentStatus
    policies   []DegradationPolicy
}

type DegradationPolicy struct {
    Condition func(map[string]ComponentStatus) bool
    Level     DegradationLevel
    Actions   []DegradationAction
}

type DegradationAction interface {
    Execute() error
}

// Example degradation actions
type ReduceConcurrencyAction struct {
    factor float64
}

func (r *ReduceConcurrencyAction) Execute() error {
    currentLimit := getMaxConcurrency()
    newLimit := int(float64(currentLimit) * r.factor)
    setMaxConcurrency(newLimit)
    log.Printf("Reduced concurrency from %d to %d", currentLimit, newLimit)
    return nil
}

type DisableFeatureAction struct {
    feature string
}

func (d *DisableFeatureAction) Execute() error {
    disableFeature(d.feature)
    log.Printf("Disabled feature: %s", d.feature)
    return nil
}
```

### Resource Protection

```go
// ResourceProtector prevents resource exhaustion
type ResourceProtector struct {
    limits    ResourceLimits
    usage     ResourceUsage
    breakers  map[string]*CircuitBreaker
}

// Check resource availability
func (r *ResourceProtector) CheckResources(required Resources) error {
    r.mu.RLock()
    defer r.mu.RUnlock()

    // Check CPU
    if r.usage.CPU+required.CPU > r.limits.CPU {
        return &BaseError{
            Type:    ErrorTypeResource,
            Code:    "CPU_LIMIT_EXCEEDED",
            Message: "Insufficient CPU resources",
        }
    }

    // Check Memory
    if r.usage.Memory+required.Memory > r.limits.Memory {
        return &BaseError{
            Type:    ErrorTypeResource,
            Code:    "MEMORY_LIMIT_EXCEEDED",
            Message: "Insufficient memory resources",
        }
    }

    // Check concurrent executions
    if r.usage.Executions >= r.limits.MaxExecutions {
        return &BaseError{
            Type:    ErrorTypeResource,
            Code:    "EXECUTION_LIMIT_EXCEEDED",
            Message: "Maximum concurrent executions reached",
        }
    }

    return nil
}
```

## Recovery Procedures

### Automatic Recovery

```go
// RecoveryManager coordinates recovery procedures
type RecoveryManager struct {
    detectors  []ErrorDetector
    strategies map[ErrorType]RecoveryStrategy
    history    *RecoveryHistory
}

// RecoveryStrategy defines how to recover from specific error types
type RecoveryStrategy interface {
    CanRecover(error) bool
    Recover(context.Context, error) error
    Priority() int
}

// Container recovery strategy
type ContainerRecoveryStrategy struct{}

func (c *ContainerRecoveryStrategy) Recover(ctx context.Context, err error) error {
    dockerErr, ok := err.(*DockerError)
    if !ok {
        return fmt.Errorf("not a docker error")
    }

    switch dockerErr.Code {
    case "DOCKER_DAEMON_UNREACHABLE":
        return c.restartDockerDaemon(ctx)
    case "CONTAINER_OOM":
        return c.cleanupAndRetry(ctx, dockerErr.ContainerID)
    case "IMAGE_PULL_FAILED":
        return c.retryImagePull(ctx, dockerErr.ImageName)
    default:
        return fmt.Errorf("no recovery strategy for %s", dockerErr.Code)
    }
}

// SSH recovery strategy
type SSHRecoveryStrategy struct {
    pools map[string]*ConnectionPool
}

func (s *SSHRecoveryStrategy) Recover(ctx context.Context, err error) error {
    sshErr, ok := err.(*SSHError)
    if !ok {
        return fmt.Errorf("not an SSH error")
    }

    switch sshErr.Code {
    case "CONNECTION_REFUSED":
        return s.resetConnection(sshErr.ServerID)
    case "AUTH_FAILED":
        return s.refreshCredentials(sshErr.ServerID)
    case "TIMEOUT":
        return s.adjustTimeout(sshErr.ServerID)
    default:
        return fmt.Errorf("no recovery strategy for %s", sshErr.Code)
    }
}
```

### Manual Intervention

```go
// InterventionRequest represents a request for manual intervention
type InterventionRequest struct {
    ID          string
    Type        string
    Severity    Severity
    Description string
    Context     map[string]interface{}
    Actions     []InterventionAction
    CreatedAt   time.Time
    ResolvedAt  *time.Time
}

// InterventionAction represents a manual action option
type InterventionAction struct {
    Name        string
    Description string
    Command     string
    Risks       []string
}

// InterventionManager handles manual intervention requests
type InterventionManager struct {
    requests  map[string]*InterventionRequest
    notifier  Notifier
    resolver  InterventionResolver
}

// Request manual intervention
func (m *InterventionManager) RequestIntervention(req *InterventionRequest) error {
    m.requests[req.ID] = req

    // Notify administrators
    return m.notifier.Notify(NotificationPriority(req.Severity), req)
}

// Example intervention scenarios
var InterventionScenarios = map[string]InterventionRequest{
    "docker_daemon_failed": {
        Type:        "docker_daemon_recovery",
        Severity:    SeverityCritical,
        Description: "Docker daemon has failed and automatic recovery was unsuccessful",
        Actions: []InterventionAction{
            {
                Name:        "restart_docker",
                Description: "Restart Docker daemon",
                Command:     "systemctl restart docker",
                Risks:       []string{"May interrupt running containers"},
            },
            {
                Name:        "failover",
                Description: "Failover to backup orchestrator",
                Command:     "orchestrator-failover --target=backup",
                Risks:       []string{"Potential job duplication"},
            },
        },
    },
}
```

## Error Reporting

### Error Aggregation

```go
// ErrorAggregator collects and analyzes errors
type ErrorAggregator struct {
    store     ErrorStore
    analyzer  ErrorAnalyzer
    reporter  ErrorReporter
}

// ErrorMetrics tracks error statistics
type ErrorMetrics struct {
    TotalErrors   int64
    ErrorsByType  map[ErrorType]int64
    ErrorsByCode  map[string]int64
    ErrorRate     float64
    RecentErrors  []ErrorSummary
}

// Aggregate errors over time windows
func (a *ErrorAggregator) GetMetrics(window time.Duration) *ErrorMetrics {
    errors := a.store.GetErrors(time.Now().Add(-window), time.Now())

    metrics := &ErrorMetrics{
        TotalErrors:  int64(len(errors)),
        ErrorsByType: make(map[ErrorType]int64),
        ErrorsByCode: make(map[string]int64),
    }

    for _, err := range errors {
        metrics.ErrorsByType[err.Type]++
        metrics.ErrorsByCode[err.Code]++
    }

    metrics.ErrorRate = float64(metrics.TotalErrors) / window.Seconds()

    return metrics
}

// Error reporting format
type ErrorReport struct {
    Period      TimeRange
    Summary     ErrorSummary
    TopErrors   []ErrorDetail
    Trends      []ErrorTrend
    Recoveries  []RecoveryEvent
    Interventions []InterventionRequest
}
```

### Alerting

```go
// AlertManager handles error-based alerting
type AlertManager struct {
    rules     []AlertRule
    channels  []AlertChannel
    throttler Throttler
}

// AlertRule defines when to trigger alerts
type AlertRule struct {
    Name       string
    Condition  AlertCondition
    Severity   AlertSeverity
    Channels   []string
    Throttle   time.Duration
}

// Alert conditions
type ErrorRateCondition struct {
    Threshold float64
    Window    time.Duration
}

func (c ErrorRateCondition) Evaluate(metrics *ErrorMetrics) bool {
    return metrics.ErrorRate > c.Threshold
}

type ErrorCountCondition struct {
    ErrorType ErrorType
    Count     int
    Window    time.Duration
}

func (c ErrorCountCondition) Evaluate(metrics *ErrorMetrics) bool {
    return metrics.ErrorsByType[c.ErrorType] >= int64(c.Count)
}
```

## Testing Error Scenarios

### Chaos Engineering

```go
// ChaosInjector simulates failures for testing
type ChaosInjector struct {
    enabled    bool
    scenarios  []ChaosScenario
    probability float64
}

// ChaosScenario defines a failure scenario
type ChaosScenario struct {
    Name        string
    Type        ChaosType
    Target      string
    Probability float64
    Duration    time.Duration
}

type ChaosType string

const (
    ChaosTypeNetworkDelay    ChaosType = "network_delay"
    ChaosTypeNetworkFailure  ChaosType = "network_failure"
    ChaosTypeResourceExhaust ChaosType = "resource_exhaust"
    ChaosTypeServiceCrash    ChaosType = "service_crash"
)

// Inject chaos if enabled
func (c *ChaosInjector) MaybeInject(operation string) error {
    if !c.enabled || rand.Float64() > c.probability {
        return nil
    }

    for _, scenario := range c.scenarios {
        if scenario.Target == operation && rand.Float64() < scenario.Probability {
            return c.inject(scenario)
        }
    }

    return nil
}
```

## Summary

This comprehensive error handling and recovery system provides:

1. **Classification**: Clear error types and hierarchies
2. **Detection**: Proactive health monitoring and pattern detection
3. **Recovery**: Automatic retry, circuit breakers, and fallbacks
4. **Degradation**: Graceful service degradation under stress
5. **Intervention**: Clear procedures for manual recovery
6. **Reporting**: Comprehensive error metrics and alerting

The design ensures the orchestrator can handle failures gracefully while maintaining visibility and control.
