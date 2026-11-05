package helpers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Same limits as the container SDKs: three tries, one and then two seconds apart,
// so a runtime restart or a dropped tunnel costs a script the same on both paths.
const (
	maxRequestAttempts = 3
	defaultRetryDelay  = time.Second
)

// APIClient talks to the runtime API for one execution.
type APIClient struct {
	endpoint    string
	token       string
	executionID string
	client      *http.Client
	retryDelay  time.Duration
}

// NewAPIClient creates a client for one execution's runtime API.
func NewAPIClient(endpoint, token, executionID string) *APIClient {
	return &APIClient{
		endpoint:    endpoint,
		token:       token,
		executionID: executionID,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		retryDelay: defaultRetryDelay,
	}
}

// executionURL builds a path under this execution's API root.
func (c *APIClient) executionURL(suffix string) string {
	return fmt.Sprintf("%s/executions/%s/%s", c.endpoint, url.PathEscape(c.executionID), suffix)
}

// GetInput retrieves input data, or nil when there is none.
func (c *APIClient) GetInput() (json.RawMessage, error) {
	return c.getData(c.executionURL("input"))
}

// SetOutput sends output data to the API.
func (c *APIClient) SetOutput(data json.RawMessage) error {
	return c.write("POST", c.executionURL("output"), map[string]interface{}{"data": data})
}

// GetVariable retrieves a variable's value, or nil when it is unset.
func (c *APIClient) GetVariable(key string) (json.RawMessage, error) {
	resp, err := c.doRequest("GET", c.executionURL("variables/"+url.PathEscape(key)), nil)
	if err != nil {
		if isNotFound(err) {
			return nil, nil
		}
		return nil, err
	}

	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Value json.RawMessage `json:"value"`
		} `json:"data"`
		Error string `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("API error: %s", result.Error)
	}
	return nilIfNull(result.Data.Value), nil
}

// SetVariable sets a variable's value.
func (c *APIClient) SetVariable(key string, value json.RawMessage) error {
	return c.write("PUT", c.executionURL("variables/"+url.PathEscape(key)), map[string]interface{}{"value": value})
}

// SetCondition sets the condition that ON_CONDITION workflow edges read.
func (c *APIClient) SetCondition(condition bool) error {
	return c.write("POST", c.executionURL("condition"), map[string]interface{}{"condition": condition})
}

// GetContext retrieves the execution context exactly as the runtime returns it.
func (c *APIClient) GetContext() (json.RawMessage, error) {
	return c.getData(c.executionURL("context"))
}

// ExecuteToolAction runs a tool action and returns its result, or nil when it has
// none. It makes one attempt, unlike every other call here: a retry after a
// failure the tool reported could send the same message twice.
func (c *APIClient) ExecuteToolAction(tool, action string, config json.RawMessage) (json.RawMessage, error) {
	resp, err := c.send("POST", c.endpoint+"/tool-actions/execute", map[string]interface{}{
		"tool":   tool,
		"action": action,
		"config": config,
	}, 1)
	if err != nil {
		return nil, err
	}
	return parseData(resp)
}

// getData fetches a URL and returns the data field of its response.
func (c *APIClient) getData(target string) (json.RawMessage, error) {
	resp, err := c.doRequest("GET", target, nil)
	if err != nil {
		return nil, err
	}
	return parseData(resp)
}

// write sends a request whose response carries nothing but the envelope.
func (c *APIClient) write(method, target string, body interface{}) error {
	resp, err := c.doRequest(method, target, body)
	if err != nil {
		return err
	}
	return checkEnvelope(resp)
}

// parseData returns the data field of a runtime response, or nil when it is null.
func parseData(resp []byte) (json.RawMessage, error) {
	var result struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Error   string          `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("API error: %s", result.Error)
	}
	return nilIfNull(result.Data), nil
}

// checkEnvelope inspects the runtime's {"success":bool,...} response envelope
// on write paths. A 200 with {"success":false} is a FAILED write (FINDINGS
// #37: it used to be treated as success because only the HTTP status was
// checked) and surfaces the envelope's error message.
func checkEnvelope(resp []byte) error {
	var result struct {
		Success bool   `json:"success"`
		Error   string `json:"error,omitempty"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if !result.Success {
		return fmt.Errorf("API error: %s", result.Error)
	}

	return nil
}

// httpStatusError is a response the runtime answered with an error status.
type httpStatusError struct {
	status int
	body   string
}

// Error reads the same as the container's bash SDK, for a job's log to match. The
// Python and Node bindings pick the status code out of it.
func (e *httpStatusError) Error() string {
	return fmt.Sprintf("API request failed - HTTP %d - %s", e.status, e.message())
}

func (e *httpStatusError) message() string {
	var body struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal([]byte(e.body), &body); err != nil {
		return strings.TrimSpace(e.body)
	}
	if body.Message != "" {
		return body.Message
	}
	if body.Error != "" {
		return body.Error
	}
	return "Unknown error"
}

func isNotFound(err error) bool {
	statusErr, ok := err.(*httpStatusError)
	return ok && statusErr.status == http.StatusNotFound
}

// doRequest performs an HTTP request, retrying what a retry can fix.
func (c *APIClient) doRequest(method, target string, body interface{}) ([]byte, error) {
	return c.send(method, target, body, maxRequestAttempts)
}

func (c *APIClient) send(method, target string, body interface{}, attempts int) ([]byte, error) {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
	}

	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			time.Sleep(c.retryDelay * time.Duration(attempt-1))
		}

		resp, retry, err := c.sendOnce(method, target, payload)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if !retry {
			break
		}
	}
	return nil, lastErr
}

// sendOnce makes one attempt and reports whether a failure is worth retrying.
// Network failures and 5xx responses are. A 501 is not: it means the endpoint is
// permanently unsupported in this execution context.
func (c *APIClient) sendOnce(method, target string, payload []byte) ([]byte, bool, error) {
	var bodyReader io.Reader
	if payload != nil {
		bodyReader = bytes.NewReader(payload)
	}

	req, err := http.NewRequest(method, target, bodyReader)
	if err != nil {
		return nil, false, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, true, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, true, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		retry := resp.StatusCode >= 500 && resp.StatusCode != http.StatusNotImplemented
		return nil, retry, &httpStatusError{status: resp.StatusCode, body: string(respBody)}
	}

	return respBody, false, nil
}
