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

// PollJobs retrieves pending jobs from the queue
func (c *Client) PollJobs(ctx context.Context, limit int) ([]*types.Job, error) {
	params := url.Values{}
	params.Set("batchSize", fmt.Sprintf("%d", limit))
	
	var response PollJobsResponse
	if err := c.get(ctx, "/api/internal/jobs/queue", params, &response); err != nil {
		return nil, err
	}
	
	// Convert response to types.Job
	jobs := make([]*types.Job, len(response.Jobs))
	for i, qj := range response.Jobs {
		jobs[i] = convertQueuedJob(qj)
	}
	
	return jobs, nil
}

// AcknowledgeJob confirms receipt of a job
func (c *Client) AcknowledgeJob(ctx context.Context, jobID string) error {
	req := AcknowledgeRequest{
		OrchestratorID:     c.config.OrchestratorID,
		Timestamp:          time.Now().Format(time.RFC3339),
		EstimatedStartTime: time.Now().Add(5 * time.Second).Format(time.RFC3339),
	}
	
	var response AcknowledgeResponse
	if err := c.post(ctx, fmt.Sprintf("/api/internal/jobs/%s/acknowledge", jobID), req, &response); err != nil {
		return err
	}
	
	if !response.Success {
		return fmt.Errorf("failed to acknowledge job")
	}
	
	return nil
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
	
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	
	return c.doRequest(req, response)
}

func (c *Client) post(ctx context.Context, path string, body interface{}, response interface{}) error {
	return c.doJSON(ctx, http.MethodPost, path, body, response)
}

func (c *Client) put(ctx context.Context, path string, body interface{}, response interface{}) error {
	return c.doJSON(ctx, http.MethodPut, path, body, response)
}

func (c *Client) doJSON(ctx context.Context, method, path string, body interface{}, response interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(jsonData)
	}
	
	u := c.baseURL.ResolveReference(&url.URL{Path: path})
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bodyReader)
	if err != nil {
		return err
	}
	
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	
	return c.doRequest(req, response)
}

func (c *Client) doRequest(req *http.Request, response interface{}) error {
	// Add authentication
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Service-Name", "cronium-orchestrator")
	req.Header.Set("X-Service-Version", "1.0.0")
	req.Header.Set("X-Orchestrator-ID", c.config.OrchestratorID)
	req.Header.Set("Accept", "application/json")
	
	// Log request
	logEntry := c.log.WithFields(logrus.Fields{
		"method": req.Method,
		"url":    req.URL.String(),
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
	err := retry.WithRetry(req.Context(), retryCfg, func() error {
		var err error
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
		ID:           qj.ID,
		Type:         types.JobType(qj.Type),
		Priority:     qj.Priority,
		CreatedAt:    qj.CreatedAt,
		ScheduledFor: qj.ScheduledFor,
		Attempts:     qj.Attempts,
		Metadata:     qj.Metadata,
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
		Passphrase: sd.Passphrase,
	}
}

// GetOrphanedJobs gets jobs that were claimed by a specific orchestrator
func (c *Client) GetOrphanedJobs(ctx context.Context, orchestratorID string) ([]*types.Job, error) {
	params := url.Values{}
	params.Set("orchestratorId", orchestratorID)
	
	var jobs []*types.Job
	if err := c.get(ctx, "/api/internal/jobs/orphaned", params, &jobs); err != nil {
		return nil, fmt.Errorf("failed to get orphaned jobs: %w", err)
	}
	
	return jobs, nil
}

// ReleaseJob releases a job back to the queue
func (c *Client) ReleaseJob(ctx context.Context, jobID string, status *types.StatusUpdate) error {
	var response interface{}
	return c.post(ctx, fmt.Sprintf("/jobs/%s/release", jobID), status, &response)
}