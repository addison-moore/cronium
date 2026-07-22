package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/retry"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"golang.org/x/sync/singleflight"
)

// Client is the API client for communicating with the Cronium backend
type Client struct {
	config     config.APIConfig
	httpClient *http.Client
	baseURL    *url.URL
	token      string
	log        *logrus.Logger

	// Deduplication for concurrent requests
	requestGroup singleflight.Group
}

// NewClient creates a new API client
func NewClient(cfg config.APIConfig, log *logrus.Logger) (*Client, error) {
	baseURL, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid API endpoint: %w", err)
	}

	httpClient := &http.Client{
		Timeout: cfg.Timeout,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
			DisableCompression:  false,
			DisableKeepAlives:   false,
		},
	}

	return &Client{
		config:     cfg,
		httpClient: httpClient,
		baseURL:    baseURL,
		token:      cfg.Token,
		log:        log,
	}, nil
}

// ClaimJobs atomically claims a batch of due jobs under a lease (PLAN.md
// §4.2). The claim IS the acknowledgment: there is no separate ack step, and
// a claimer that dies is recovered by lease expiry, not orphan queries.
func (c *Client) ClaimJobs(ctx context.Context, limit int) ([]*types.Job, error) {
	req := ClaimJobsRequest{
		OrchestratorID: c.config.OrchestratorID,
		BatchSize:      limit,
	}

	var response PollJobsResponse
	if err := c.post(ctx, "/api/internal/jobs/claim", req, &response); err != nil {
		return nil, err
	}

	// Convert response to types.Job
	jobs := make([]*types.Job, len(response.Jobs))
	for i, qj := range response.Jobs {
		jobs[i] = convertQueuedJob(qj)
	}

	return jobs, nil
}

// JobsHeartbeat renews the leases of the given in-flight jobs and returns
// which of them have cancellation requested. Failing to heartbeat within the
// lease window hands the jobs to the app's sweeper — callers must self-fence
// (abort execution) when renewal keeps failing.
func (c *Client) JobsHeartbeat(ctx context.Context, jobIDs []string) (*JobsHeartbeatResponse, error) {
	req := JobsHeartbeatRequest{
		OrchestratorID: c.config.OrchestratorID,
		JobIDs:         jobIDs,
	}

	var response JobsHeartbeatResponse
	if err := c.post(ctx, "/api/internal/jobs/heartbeat", req, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

// UpdateJobStatus updates the status of a job
func (c *Client) UpdateJobStatus(ctx context.Context, jobID string, status types.JobStatus, details *types.StatusUpdate) error {
	req := UpdateStatusRequest{
		Status:    status,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	if details != nil {
		req.Details = &StatusDetails{
			Message:  details.Message,
			ExitCode: details.ExitCode,
			Error:    details.Error,
		}
	}

	var response UpdateStatusResponse
	if err := c.put(ctx, fmt.Sprintf("/api/internal/jobs/%s/status", jobID), req, &response); err != nil {
		return err
	}

	if !response.Success {
		return fmt.Errorf("failed to update job status")
	}

	return nil
}

// CompleteJob marks a job as completed
func (c *Client) CompleteJob(ctx context.Context, jobID string, req *CompleteJobRequest) error {
	req.Timestamp = time.Now().Format(time.RFC3339)

	var response interface{}
	return c.post(ctx, fmt.Sprintf("/api/internal/jobs/%s/complete", jobID), req, &response)
}

// CreateExecution creates a new execution record
func (c *Client) CreateExecution(ctx context.Context, executionID, jobID string, serverID *string, serverName *string) error {
	req := map[string]interface{}{
		"jobId": jobID,
	}

	if serverID != nil {
		// Parse server ID to int if it's numeric
		req["serverId"] = *serverID
	}

	if serverName != nil {
		req["serverName"] = *serverName
	}

	var response interface{}
	return c.post(ctx, fmt.Sprintf("/api/internal/executions/%s/create", executionID), req, &response)
}

// ExecutionStatusUpdate contains execution status update details
type ExecutionStatusUpdate struct {
	StartedAt   *time.Time
	CompletedAt *time.Time
	ExitCode    *int
	Output      *string
	Error       *string
	// Phase-based timing fields
	SetupStartedAt       *time.Time
	SetupCompletedAt     *time.Time
	ExecutionStartedAt   *time.Time
	ExecutionCompletedAt *time.Time
	CleanupStartedAt     *time.Time
	CleanupCompletedAt   *time.Time
	SetupDuration        *int64 // milliseconds
	ExecutionDuration    *int64 // milliseconds
	CleanupDuration      *int64 // milliseconds
	TotalDuration        *int64 // milliseconds
	ExecutionMetadata    map[string]interface{}
}

// UpdateExecution updates an execution's status
func (c *Client) UpdateExecution(ctx context.Context, executionID string, status types.JobStatus, details *ExecutionStatusUpdate) error {
	req := map[string]interface{}{
		"status": status,
	}

	if details != nil {
		if details.StartedAt != nil {
			req["startedAt"] = details.StartedAt.Format(time.RFC3339)
		}
		if details.CompletedAt != nil {
			req["completedAt"] = details.CompletedAt.Format(time.RFC3339)
		}
		if details.ExitCode != nil {
			req["exitCode"] = *details.ExitCode
		}
		if details.Output != nil {
			req["output"] = *details.Output
		}
		if details.Error != nil {
			req["error"] = *details.Error
		}
		// Phase-based timing fields
		if details.SetupStartedAt != nil {
			req["setupStartedAt"] = details.SetupStartedAt.Format(time.RFC3339)
		}
		if details.SetupCompletedAt != nil {
			req["setupCompletedAt"] = details.SetupCompletedAt.Format(time.RFC3339)
		}
		if details.ExecutionStartedAt != nil {
			req["executionStartedAt"] = details.ExecutionStartedAt.Format(time.RFC3339)
		}
		if details.ExecutionCompletedAt != nil {
			req["executionCompletedAt"] = details.ExecutionCompletedAt.Format(time.RFC3339)
		}
		if details.CleanupStartedAt != nil {
			req["cleanupStartedAt"] = details.CleanupStartedAt.Format(time.RFC3339)
		}
		if details.CleanupCompletedAt != nil {
			req["cleanupCompletedAt"] = details.CleanupCompletedAt.Format(time.RFC3339)
		}
		if details.SetupDuration != nil {
			req["setupDuration"] = *details.SetupDuration
		}
		if details.ExecutionDuration != nil {
			req["executionDuration"] = *details.ExecutionDuration
		}
		if details.CleanupDuration != nil {
			req["cleanupDuration"] = *details.CleanupDuration
		}
		if details.TotalDuration != nil {
			req["totalDuration"] = *details.TotalDuration
		}
		if details.ExecutionMetadata != nil && len(details.ExecutionMetadata) > 0 {
			req["executionMetadata"] = details.ExecutionMetadata
		}
	}

	var response interface{}
	return c.put(ctx, fmt.Sprintf("/api/internal/executions/%s/update", executionID), req, &response)
}

// ReportHealth sends a health report to the backend
func (c *Client) ReportHealth(ctx context.Context, report *HealthReport) error {
	report.Timestamp = time.Now().Format(time.RFC3339)

	var response interface{}
	return c.post(ctx, "/api/internal/orchestrator/health", report, &response)
}

// SendHeartbeat reports orchestrator liveness and capacity
func (c *Client) SendHeartbeat(ctx context.Context, req *HeartbeatRequest) error {
	req.Timestamp = time.Now().Format(time.RFC3339)
	var response interface{}
	return c.post(ctx, "/api/internal/orchestrator/heartbeat", req, &response)
}

// SendMetrics reports orchestrator-level metrics
func (c *Client) SendMetrics(ctx context.Context, req *MetricsRequest) error {
	req.Timestamp = time.Now().Format(time.RFC3339)
	var response interface{}
	return c.post(ctx, "/api/internal/orchestrator/metrics", req, &response)
}

// HealthCheck performs a health check on the API
func (c *Client) HealthCheck(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var response interface{}
	return c.get(ctx, "/api/internal/orchestrator/health", nil, &response)
}

// HTTP helper methods

func (c *Client) get(ctx context.Context, path string, params url.Values, response interface{}) error {
	u := c.baseURL.ResolveReference(&url.URL{Path: path})
	if params != nil {
		u.RawQuery = params.Encode()
	}

	return c.doRequest(ctx, http.MethodGet, u.String(), nil, response)
}

func (c *Client) post(ctx context.Context, path string, body interface{}, response interface{}) error {
	return c.doJSON(ctx, http.MethodPost, path, body, response)
}

func (c *Client) put(ctx context.Context, path string, body interface{}, response interface{}) error {
	return c.doJSON(ctx, http.MethodPut, path, body, response)
}

func (c *Client) doJSON(ctx context.Context, method, path string, body interface{}, response interface{}) error {
	var bodyBytes []byte
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyBytes = jsonData
	}

	u := c.baseURL.ResolveReference(&url.URL{Path: path})
	return c.doRequest(ctx, method, u.String(), bodyBytes, response)
}

// doRequest executes an HTTP request with retries. A FRESH request is built
// for every attempt — reusing one *http.Request across attempts consumes its
// body on the first try and every retried POST/PUT then sends an empty body
// (the review's C5: the retry layer could never actually retry a write).
func (c *Client) doRequest(ctx context.Context, method, urlStr string, bodyBytes []byte, response interface{}) error {
	// Log request
	logEntry := c.log.WithFields(logrus.Fields{
		"method": method,
		"url":    urlStr,
	})
	logEntry.Debug("API request")

	// Configure retry
	retryCfg := retry.Config{
		MaxAttempts:  c.config.RetryConfig.MaxAttempts + 1, // Include initial attempt
		InitialDelay: c.config.RetryConfig.InitialDelay,
		MaxDelay:     c.config.RetryConfig.MaxDelay,
		Multiplier:   2.0,
	}

	var resp *http.Response
	var body []byte

	// Execute request with retry utility
	err := retry.WithRetry(ctx, retryCfg, func() error {
		var bodyReader io.Reader
		if bodyBytes != nil {
			bodyReader = bytes.NewReader(bodyBytes)
		}
		req, err := http.NewRequestWithContext(ctx, method, urlStr, bodyReader)
		if err != nil {
			return err
		}
		if bodyBytes != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("X-Service-Name", "cronium-orchestrator")
		req.Header.Set("X-Service-Version", "1.0.0")
		req.Header.Set("X-Orchestrator-ID", c.config.OrchestratorID)
		req.Header.Set("Accept", "application/json")
		// Present the per-job capability token (HI-10) when the context carries
		// one — the job-scoped routes verify this instead of the shared key.
		if cap := jobCapabilityFromContext(ctx); cap != "" {
			req.Header.Set("X-Job-Capability", cap)
		}

		resp, err = c.httpClient.Do(req)
		if err != nil {
			// Network errors are retryable
			netErr := errors.NewNetworkError(
				fmt.Sprintf("HTTP request failed: %v", err),
				"HTTP",
			)
			netErr.Retryable = true
			return netErr
		}
		defer resp.Body.Close()

		// Read response body
		body, err = io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("failed to read response body: %w", err)
		}

		// Check status code
		if resp.StatusCode >= 400 {
			// Parse error response
			var errorResp ErrorResponse
			if err := json.Unmarshal(body, &errorResp); err == nil && errorResp.Error.Code != "" {
				apiErr := errors.NewAPIError(resp.StatusCode, errorResp.Error.Code, errorResp.Error.Message)
				apiErr.Endpoint = req.URL.String()
				apiErr.Method = req.Method

				// Determine if retryable
				if resp.StatusCode == 429 || resp.StatusCode >= 500 {
					apiErr.Retryable = true
				}
				return apiErr
			}

			// Generic error
			apiErr := errors.NewAPIError(
				resp.StatusCode,
				"UNKNOWN",
				fmt.Sprintf("API request failed with status %d: %s", resp.StatusCode, string(body)),
			)
			apiErr.Endpoint = req.URL.String()
			apiErr.Method = req.Method

			// 5xx errors are retryable
			if resp.StatusCode >= 500 {
				apiErr.Retryable = true
			}
			return apiErr
		}

		return nil
	}, logEntry)

	if err != nil {
		return err
	}

	// Parse response
	if response != nil && len(body) > 0 {
		if err := json.Unmarshal(body, response); err != nil {
			return fmt.Errorf("failed to parse response: %w", err)
		}
	}

	return nil
}

// convertQueuedJob converts API response to internal job type
func convertQueuedJob(qj QueuedJob) *types.Job {
	job := &types.Job{
		ID:              qj.ID,
		Type:            types.JobType(qj.Type),
		Priority:        qj.Priority,
		CreatedAt:       qj.CreatedAt,
		ScheduledFor:    qj.ScheduledFor,
		Attempts:        qj.Attempts,
		Metadata:        qj.Metadata,
		CapabilityToken: qj.CapabilityToken,
	}

	// Convert execution config
	job.Execution = types.ExecutionConfig{
		Environment: qj.Execution.Environment,
		Timeout:     time.Duration(qj.Execution.Timeout) * time.Second,
		InputData:   qj.Execution.InputData,
		Variables:   qj.Execution.Variables,
	}

	// Set target
	job.Execution.Target = types.Target{
		Type:          types.TargetType(qj.Execution.Target.Type),
		ServerID:      qj.Execution.Target.ServerID,
		ServerDetails: convertServerDetails(qj.Execution.Target.ServerDetails),
	}

	// Set script if present
	if qj.Execution.Script != nil {
		job.Execution.Script = &types.Script{
			Type:             types.ScriptType(qj.Execution.Script.Type),
			Content:          qj.Execution.Script.Content,
			WorkingDirectory: qj.Execution.Script.WorkingDirectory,
		}
	}

	// Set resources if present
	if qj.Execution.Resources != nil {
		job.Execution.Resources = &types.Resources{
			CPULimit:    qj.Execution.Resources.CPULimit,
			MemoryLimit: qj.Execution.Resources.MemoryLimit,
			DiskLimit:   qj.Execution.Resources.DiskLimit,
			PidsLimit:   qj.Execution.Resources.PidsLimit,
		}
	}

	// Set retry policy if present
	if qj.Execution.RetryPolicy != nil {
		job.Execution.RetryPolicy = &types.RetryPolicy{
			MaxAttempts:  qj.Execution.RetryPolicy.MaxAttempts,
			BackoffType:  qj.Execution.RetryPolicy.BackoffType,
			BackoffDelay: time.Duration(qj.Execution.RetryPolicy.BackoffDelay) * time.Second,
		}
	}

	// Set timeout from config
	job.Timeout = job.GetTimeout()

	return job
}

func convertServerDetails(sd *ServerDetails) *types.ServerDetails {
	if sd == nil {
		return nil
	}

	return &types.ServerDetails{
		ID:         sd.ID,
		Name:       sd.Name,
		Host:       sd.Host,
		Port:       sd.Port,
		Username:   sd.Username,
		PrivateKey: sd.PrivateKey,
		Password:   sd.Password,
		Passphrase: sd.Passphrase,
	}
}
