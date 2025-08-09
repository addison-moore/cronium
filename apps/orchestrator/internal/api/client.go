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

// ReportHealth sends a health report to the backend
func (c *Client) ReportHealth(ctx context.Context, report *HealthReport) error {
	report.Timestamp = time.Now().Format(time.RFC3339)
	
	var response interface{}
	return c.post(ctx, "/api/internal/orchestrator/health", report, &response)
}

// HealthCheck performs a health check on the API
func (c *Client) HealthCheck(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
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
	c.log.WithFields(logrus.Fields{
		"method": req.Method,
		"url":    req.URL.String(),
	}).Debug("API request")
	
	// Execute request with retry
	var resp *http.Response
	var err error
	
	for attempt := 0; attempt <= c.config.RetryConfig.MaxAttempts; attempt++ {
		if attempt > 0 {
			delay := calculateBackoff(attempt, c.config.RetryConfig)
			time.Sleep(delay)
		}
		
		resp, err = c.httpClient.Do(req)
		if err != nil {
			c.log.WithError(err).Warn("API request failed")
			continue
		}
		
		// Don't retry on 4xx errors (except 429)
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 429 {
			break
		}
		
		// Success or non-retryable error
		if resp.StatusCode < 500 {
			break
		}
	}
	
	if err != nil {
		return fmt.Errorf("request failed after %d attempts: %w", c.config.RetryConfig.MaxAttempts, err)
	}
	defer resp.Body.Close()
	
	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}
	
	// Check for errors
	if resp.StatusCode >= 400 {
		var errorResp ErrorResponse
		if err := json.Unmarshal(body, &errorResp); err == nil && errorResp.Error.Code != "" {
			apiErr := errors.NewAPIError(resp.StatusCode, errorResp.Error.Code, errorResp.Error.Message)
			apiErr.Endpoint = req.URL.String()
			apiErr.Method = req.Method
			return apiErr
		}
		return fmt.Errorf("API request failed with status %d: %s", resp.StatusCode, string(body))
	}
	
	// Parse response
	if response != nil && len(body) > 0 {
		if err := json.Unmarshal(body, response); err != nil {
			return fmt.Errorf("failed to parse response: %w", err)
		}
	}
	
	return nil
}

func calculateBackoff(attempt int, cfg config.RetryConfig) time.Duration {
	var delay time.Duration
	
	switch cfg.BackoffType {
	case "exponential":
		delay = cfg.InitialDelay * time.Duration(1<<uint(attempt-1))
	case "linear":
		delay = cfg.InitialDelay * time.Duration(attempt)
	default:
		delay = cfg.InitialDelay
	}
	
	if delay > cfg.MaxDelay {
		delay = cfg.MaxDelay
	}
	
	return delay
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