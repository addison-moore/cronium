package helpers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// APIClient handles communication with the runtime API
type APIClient struct {
	endpoint string
	token    string
	client   *http.Client
}

// NewAPIClient creates a new API client
func NewAPIClient(endpoint, token string) *APIClient {
	return &APIClient{
		endpoint: endpoint,
		token:    token,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// GetInput retrieves input data from the API
func (c *APIClient) GetInput(executionID string) (interface{}, error) {
	url := fmt.Sprintf("%s/executions/%s/input", c.endpoint, executionID)
	
	resp, err := c.doRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	
	var result struct {
		Success bool        `json:"success"`
		Data    interface{} `json:"data"`
		Error   string      `json:"error,omitempty"`
	}
	
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	if !result.Success {
		return nil, fmt.Errorf("API error: %s", result.Error)
	}
	
	return result.Data, nil
}

// SetOutput sends output data to the API
func (c *APIClient) SetOutput(executionID string, data interface{}) error {
	url := fmt.Sprintf("%s/executions/%s/output", c.endpoint, executionID)
	
	body := map[string]interface{}{
		"data": data,
	}
	
	_, err := c.doRequest("POST", url, body)
	return err
}

// GetVariable retrieves a variable value from the API
func (c *APIClient) GetVariable(executionID, key string) (interface{}, error) {
	url := fmt.Sprintf("%s/executions/%s/variables/%s", c.endpoint, executionID, key)
	
	resp, err := c.doRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Key   string      `json:"key"`
			Value interface{} `json:"value"`
		} `json:"data"`
		Error string `json:"error,omitempty"`
	}
	
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	if !result.Success {
		return nil, fmt.Errorf("API error: %s", result.Error)
	}
	
	return result.Data.Value, nil
}

// SetVariable sets a variable value via the API
func (c *APIClient) SetVariable(executionID, key string, value interface{}) error {
	url := fmt.Sprintf("%s/executions/%s/variables/%s", c.endpoint, executionID, key)
	
	body := map[string]interface{}{
		"value": value,
	}
	
	_, err := c.doRequest("PUT", url, body)
	return err
}

// GetContext retrieves the event execution context
func (c *APIClient) GetContext(executionID string) (*EventContext, error) {
	url := fmt.Sprintf("%s/executions/%s/context", c.endpoint, executionID)
	
	resp, err := c.doRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	
	var result struct {
		Success bool          `json:"success"`
		Data    *EventContext `json:"data"`
		Error   string        `json:"error,omitempty"`
	}
	
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	if !result.Success {
		return nil, fmt.Errorf("API error: %s", result.Error)
	}
	
	return result.Data, nil
}

// doRequest performs an HTTP request
func (c *APIClient) doRequest(method, url string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBody)
	}
	
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	
	return respBody, nil
}