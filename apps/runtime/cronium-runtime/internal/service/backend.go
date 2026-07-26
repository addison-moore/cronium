package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/authctx"
	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/sirupsen/logrus"
)

// BackendClient handles communication with the Cronium backend
type BackendClient struct {
	config     config.BackendConfig
	httpClient *http.Client
	log        *logrus.Logger
}

// NewBackendClient creates a new backend client
func NewBackendClient(cfg config.BackendConfig, log *logrus.Logger) *BackendClient {
	return &BackendClient{
		config: cfg,
		httpClient: &http.Client{
			Timeout: cfg.Timeout,
		},
		log: log,
	}
}

// GetVariable retrieves a variable from the backend
func (c *BackendClient) GetVariable(ctx context.Context, executionID, userID, key string) (*types.Variable, error) {
	url := fmt.Sprintf("%s/api/internal/variables/%s/%s", c.config.URL, userID, key)

	req, err := c.newRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Add("X-Execution-ID", executionID)

	var variable types.Variable
	if err := c.doRequest(req, &variable); err != nil {
		return nil, fmt.Errorf("failed to get variable: %w", err)
	}

	return &variable, nil
}

// SetVariable stores a variable in the backend
func (c *BackendClient) SetVariable(ctx context.Context, executionID, userID, key string, value interface{}) error {
	url := fmt.Sprintf("%s/api/internal/variables/%s/%s", c.config.URL, userID, key)

	body := map[string]interface{}{
		"value": value,
	}

	req, err := c.newRequest(ctx, "PUT", url, body)
	if err != nil {
		return err
	}

	req.Header.Add("X-Execution-ID", executionID)

	if err := c.doRequest(req, nil); err != nil {
		return fmt.Errorf("failed to set variable: %w", err)
	}

	return nil
}

// GetExecutionContext retrieves execution context from the backend
func (c *BackendClient) GetExecutionContext(ctx context.Context, executionID string) (*types.ExecutionContext, error) {
	url := fmt.Sprintf("%s/api/internal/executions/%s/context", c.config.URL, executionID)

	req, err := c.newRequest(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	var context types.ExecutionContext
	if err := c.doRequest(req, &context); err != nil {
		return nil, fmt.Errorf("failed to get execution context: %w", err)
	}

	// The wire carries the event's name/type only inside the nested "event"
	// object (FINDINGS #36 — there are no top-level eventName/eventType
	// fields). Flatten them so cronium.event() and every consumer of the flat
	// contract sees real values.
	if context.Event != nil {
		if context.EventName == "" {
			context.EventName = context.Event.Name
		}
		if context.EventType == "" {
			context.EventType = context.Event.Type
		}
		if context.EventID == "" {
			context.EventID = context.Event.ID
		}
	}

	return &context, nil
}

// SaveOutput saves execution output to the backend
func (c *BackendClient) SaveOutput(ctx context.Context, executionID string, output interface{}) error {
	url := fmt.Sprintf("%s/api/internal/executions/%s/output", c.config.URL, executionID)

	body := map[string]interface{}{
		"output":    output,
		"timestamp": time.Now(),
	}

	req, err := c.newRequest(ctx, "POST", url, body)
	if err != nil {
		return err
	}

	if err := c.doRequest(req, nil); err != nil {
		return fmt.Errorf("failed to save output: %w", err)
	}

	return nil
}

// SaveCondition saves workflow condition result to the backend
func (c *BackendClient) SaveCondition(ctx context.Context, executionID string, condition bool) error {
	url := fmt.Sprintf("%s/api/internal/executions/%s/condition", c.config.URL, executionID)

	body := map[string]interface{}{
		"condition": condition,
		"timestamp": time.Now(),
	}

	req, err := c.newRequest(ctx, "POST", url, body)
	if err != nil {
		return err
	}

	if err := c.doRequest(req, nil); err != nil {
		return fmt.Errorf("failed to save condition: %w", err)
	}

	return nil
}

// ExecuteToolAction executes a tool action via the backend
func (c *BackendClient) ExecuteToolAction(ctx context.Context, executionID, userID string, config types.ToolActionConfig) (*types.ToolActionResult, error) {
	url := fmt.Sprintf("%s/api/internal/tools/execute", c.config.URL)

	body := map[string]interface{}{
		"executionId": executionID,
		"userId":      userID,
		"tool":        config.Tool,
		"action":      config.Action,
		"params":      config.Params,
	}

	req, err := c.newRequest(ctx, "POST", url, body)
	if err != nil {
		return nil, err
	}

	var result types.ToolActionResult
	if err := c.doRequest(req, &result); err != nil {
		return nil, fmt.Errorf("failed to execute tool action: %w", err)
	}

	return &result, nil
}

// AuditLog sends an audit log entry to the backend
func (c *BackendClient) AuditLog(ctx context.Context, executionID, action string, metadata map[string]interface{}) error {
	url := fmt.Sprintf("%s/api/internal/audit", c.config.URL)

	body := map[string]interface{}{
		"executionId": executionID,
		"action":      action,
		"metadata":    metadata,
		"timestamp":   time.Now(),
	}

	// Capture the capability token before detaching — the goroutine's
	// background context won't inherit it otherwise (HI-10).
	capability := authctx.CapabilityFromContext(ctx)

	// Fire and forget on a detached context: the caller's request context is
	// often canceled the moment its handler returns, which would abort this
	// audit write if the request were built from it.
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		bgCtx = authctx.WithCapability(bgCtx, capability)
		req, err := c.newRequest(bgCtx, "POST", url, body)
		if err != nil {
			c.log.WithError(err).Error("Failed to build audit log request")
			return
		}
		if err := c.doRequest(req, nil); err != nil {
			c.log.WithError(err).Error("Failed to send audit log")
		}
	}()

	return nil
}

// newRequest creates a new HTTP request with common headers
func (c *BackendClient) newRequest(ctx context.Context, method, url string, body interface{}) (*http.Request, error) {
	var bodyReader io.Reader

	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	if c.config.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.Token)
	}

	// Present the per-job capability token (HI-10) when the context carries one
	// — the app's job-scoped internal routes verify this instead of the shared
	// backend token.
	if cap := authctx.CapabilityFromContext(ctx); cap != "" {
		req.Header.Set("X-Job-Capability", cap)
	}

	return req, nil
}

// doRequest executes an HTTP request with retry logic
func (c *BackendClient) doRequest(req *http.Request, result interface{}) error {
	var lastErr error

	for i := 0; i <= c.config.MaxRetries; i++ {
		if i > 0 {
			// Wait before retry
			time.Sleep(c.config.RetryDelay * time.Duration(i))
			c.log.WithField("attempt", i).Debug("Retrying request")
		}

		// Rebuild the request body for each attempt. The body is a one-shot
		// reader that attempt 1 drains, so without this a retry would send an
		// empty body (e.g. writing {"output":null} over real data).
		if req.GetBody != nil {
			bodyCopy, err := req.GetBody()
			if err != nil {
				return fmt.Errorf("failed to rewind request body: %w", err)
			}
			req.Body = bodyCopy
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		// Read + close the body this iteration (don't defer inside the loop,
		// which would leak every non-final response until the function returns).
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		// Check status code
		if resp.StatusCode >= 400 {
			// The app's canonical error body is {"error": "<string>"} with no
			// message field; join the parts only when both exist so the error
			// never ends in a dangling " - " (FINDINGS #38).
			var errResp types.ErrorResponse
			if err := json.Unmarshal(body, &errResp); err == nil && (errResp.Error != "" || errResp.Message != "") {
				detail := errResp.Error
				switch {
				case detail == "":
					detail = errResp.Message
				case errResp.Message != "":
					detail = detail + " - " + errResp.Message
				}
				lastErr = fmt.Errorf("backend error: %s", detail)
			} else {
				lastErr = fmt.Errorf("backend error: %s", resp.Status)
			}

			// Don't retry client errors
			if resp.StatusCode >= 400 && resp.StatusCode < 500 {
				return lastErr
			}

			continue
		}

		// Parse successful response if result is provided
		if result != nil && len(body) > 0 {
			if err := json.Unmarshal(body, result); err != nil {
				return fmt.Errorf("failed to parse response: %w", err)
			}
		}

		return nil
	}

	return fmt.Errorf("request failed after %d attempts: %w", c.config.MaxRetries+1, lastErr)
}
