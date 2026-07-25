package api

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type recordedAPIRequest struct {
	Endpoint string
	Method   string
	Duration float64
}

type recordedAPIError struct {
	Endpoint string
	Method   string
	Code     string
}

type fakeMetricsRecorder struct {
	mu       sync.Mutex
	requests []recordedAPIRequest
	errors   []recordedAPIError
}

func (f *fakeMetricsRecorder) RecordAPIRequest(endpoint, method string, duration float64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, recordedAPIRequest{endpoint, method, duration})
}

func (f *fakeMetricsRecorder) RecordAPIError(endpoint, method, code string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.errors = append(f.errors, recordedAPIError{endpoint, method, code})
}

func (f *fakeMetricsRecorder) snapshot() ([]recordedAPIRequest, []recordedAPIError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	reqs := make([]recordedAPIRequest, len(f.requests))
	copy(reqs, f.requests)
	errs := make([]recordedAPIError, len(f.errors))
	copy(errs, f.errors)
	return reqs, errs
}

func TestWithMetricsRecordsSuccessfulRequest(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	recorder := &fakeMetricsRecorder{}
	client.WithMetrics(recorder)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.NoError(t, err)

	reqs, errs := recorder.snapshot()
	require.Len(t, reqs, 1)
	assert.Equal(t, "/api/internal/jobs/claim", reqs[0].Endpoint)
	assert.Equal(t, http.MethodPost, reqs[0].Method)
	assert.GreaterOrEqual(t, reqs[0].Duration, float64(0))
	assert.Empty(t, errs, "successful request must not record an error")
}

func TestWithMetricsRecordsHTTPErrorCode(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	server := newFixtureServer(t, serveScenario(t, fx, "serverError"))
	client := newTestClient(t, server.URL, 0)

	recorder := &fakeMetricsRecorder{}
	client.WithMetrics(recorder)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)

	reqs, errs := recorder.snapshot()
	require.Len(t, reqs, 1)
	require.Len(t, errs, 1)
	assert.Equal(t, "/api/internal/jobs/claim", errs[0].Endpoint)
	assert.Equal(t, http.MethodPost, errs[0].Method)
	assert.Equal(t, "500", errs[0].Code)
}

func TestWithMetricsRecordsNetworkError(t *testing.T) {
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {})
	url := server.URL
	server.Close()

	client := newTestClient(t, url, 0)
	recorder := &fakeMetricsRecorder{}
	client.WithMetrics(recorder)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)

	reqs, errs := recorder.snapshot()
	require.Len(t, reqs, 1, "the attempt itself is still recorded")
	require.Len(t, errs, 1)
	assert.Equal(t, "network_error", errs[0].Code)
}

func TestWithMetricsRecordsEveryRetryAttempt(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	server := newFixtureServer(t, serveScenario(t, fx, "serverError"))
	client := newTestClient(t, server.URL, 2) // 3 attempts

	recorder := &fakeMetricsRecorder{}
	client.WithMetrics(recorder)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)

	reqs, errs := recorder.snapshot()
	assert.Len(t, reqs, 3, "metrics wrap the transport, so each attempt is recorded")
	assert.Len(t, errs, 3)
}

func TestWithMetricsNilRecorderIsNoop(t *testing.T) {
	client := newTestClient(t, "http://127.0.0.1:0", 0)
	before := client.httpClient.Transport
	client.WithMetrics(nil)
	assert.Equal(t, before, client.httpClient.Transport, "nil recorder must not wrap the transport")
}
