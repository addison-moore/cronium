package api

import (
	"net/http"
	"strconv"
	"time"
)

// MetricsRecorder interface for recording API metrics
type MetricsRecorder interface {
	RecordAPIRequest(endpoint, method string, duration float64)
	RecordAPIError(endpoint, method, code string)
}

// metricsTransport wraps http.RoundTripper to record metrics
type metricsTransport struct {
	base     http.RoundTripper
	recorder MetricsRecorder
}

// RoundTrip implements http.RoundTripper
func (t *metricsTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	start := time.Now()
	endpoint := req.URL.Path
	method := req.Method
	
	// Execute request
	resp, err := t.base.RoundTrip(req)
	
	// Record metrics
	duration := time.Since(start).Seconds()
	
	if t.recorder != nil {
		t.recorder.RecordAPIRequest(endpoint, method, duration)
		
		if err != nil {
			t.recorder.RecordAPIError(endpoint, method, "network_error")
		} else if resp.StatusCode >= 400 {
			t.recorder.RecordAPIError(endpoint, method, strconv.Itoa(resp.StatusCode))
		}
	}
	
	return resp, err
}

// WithMetrics adds metrics recording to the client
func (c *Client) WithMetrics(recorder MetricsRecorder) {
	if recorder == nil {
		return
	}
	
	transport := c.httpClient.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	
	c.httpClient.Transport = &metricsTransport{
		base:     transport,
		recorder: recorder,
	}
}