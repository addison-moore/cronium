package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	croniumerrors "github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testOrchKey = "test-orchestrator-key"
	testOrchID  = "orch-test"
)

// newTestClient builds a Client against the given endpoint. `retries` is the
// number of retries on top of the initial attempt (0 = single attempt), with
// millisecond-scale backoff so tests stay fast.
func newTestClient(t *testing.T, endpoint string, retries int) *Client {
	t.Helper()

	log := logrus.New()
	log.SetOutput(io.Discard)

	client, err := NewClient(config.APIConfig{
		Endpoint: endpoint,
		Token:    testOrchKey,
		Timeout:  5 * time.Second,
		RetryConfig: config.RetryConfig{
			MaxAttempts:  retries,
			InitialDelay: time.Millisecond,
			MaxDelay:     4 * time.Millisecond,
		},
		OrchestratorID: testOrchID,
	}, log)
	require.NoError(t, err)
	return client
}

func TestNewClientInvalidEndpoint(t *testing.T) {
	log := logrus.New()
	log.SetOutput(io.Discard)

	_, err := NewClient(config.APIConfig{Endpoint: "://missing-scheme"}, log)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid API endpoint")
}

// assertOrchestratorIdentityHeaders asserts the header contract for
// orchestrator-identity routes ("auth": "orchestrator-key" in the fixtures):
// the shared key as a bearer token, plus the standard service headers, and no
// per-job capability.
func assertOrchestratorIdentityHeaders(t *testing.T, req capturedRequest) {
	t.Helper()
	assert.Equal(t, "Bearer "+testOrchKey, req.Header.Get("Authorization"))
	assert.Equal(t, testOrchID, req.Header.Get("X-Orchestrator-ID"))
	assert.Equal(t, "cronium-orchestrator", req.Header.Get("X-Service-Name"))
	assert.Equal(t, "application/json", req.Header.Get("Accept"))
	assert.Empty(t, req.Header.Get("X-Job-Capability"),
		"orchestrator-identity calls must not present a job capability")
}

// assertJobCapabilityHeaders asserts the header contract for job-scoped routes
// ("auth": "job-capability"): the per-job token travels in X-Job-Capability.
func assertJobCapabilityHeaders(t *testing.T, req capturedRequest, token string) {
	t.Helper()
	assert.Equal(t, token, req.Header.Get("X-Job-Capability"))
}

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/claim
// ---------------------------------------------------------------------------

func TestClaimJobsSuccessFixture(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	jobs, err := client.ClaimJobs(context.Background(), 5)
	require.NoError(t, err)

	// Request contract: orchestrator-identity route.
	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "/api/internal/jobs/claim", req.Path)
	assert.Equal(t, "application/json", req.Header.Get("Content-Type"))
	assertOrchestratorIdentityHeaders(t, req)
	body := req.jsonBody(t)
	assert.Equal(t, testOrchID, body["orchestratorId"])
	assert.Equal(t, float64(5), body["batchSize"])

	// Response decoding: the client must faithfully decode the canonical
	// fixture body (sentinels were substituted with known values).
	require.Len(t, jobs, 1)
	job := jobs[0]
	assert.Equal(t, idAtPath("jobs.0.id"), job.ID)
	assert.Equal(t, types.JobTypeContainer, job.Type)
	assert.Equal(t, 1, job.Priority)
	assert.True(t, job.CreatedAt.Equal(fixtureTime), "createdAt: got %v", job.CreatedAt)
	require.NotNil(t, job.ScheduledFor)
	assert.True(t, job.ScheduledFor.Equal(fixtureTime))
	assert.Equal(t, 1, job.Attempts)
	assert.Equal(t, fixtureToken, job.CapabilityToken)
	assert.Equal(t, map[string]string{"CRONIUM_EVENT": "demo"}, job.Execution.Environment)

	// Regression (timeout unit bug): the wire value is nanoseconds — a
	// serialized Go time.Duration (60000000000 = 60s in the fixture). The old
	// conversion multiplied by time.Second, overflowing int64 and effectively
	// disabling job timeouts.
	assert.Equal(t, 60*time.Second, job.Execution.Timeout)
	assert.Equal(t, 60*time.Second, job.Timeout)

	assert.Equal(t, types.TargetTypeLocal, job.Execution.Target.Type)
	require.NotNil(t, job.Execution.Target.ServerID)
	assert.Equal(t, "7", *job.Execution.Target.ServerID)
	assert.Nil(t, job.Execution.Target.ServerDetails)

	require.NotNil(t, job.Execution.Script)
	assert.Equal(t, types.ScriptTypeBash, job.Execution.Script.Type)
	assert.Equal(t, "echo hello", job.Execution.Script.Content)
	assert.Equal(t, "/workspace", job.Execution.Script.WorkingDirectory)

	assert.Nil(t, job.Execution.Resources)
	assert.Nil(t, job.Execution.RetryPolicy)
}

func TestClaimJobsEmptyFixture(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	server := newFixtureServer(t, serveScenario(t, fx, "empty"))
	client := newTestClient(t, server.URL, 0)

	jobs, err := client.ClaimJobs(context.Background(), 10)
	require.NoError(t, err)
	assert.Empty(t, jobs)
}

func TestClaimJobsErrorScenarios(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")

	cases := []struct {
		scenario   string
		wantStatus int
	}{
		{"unauthorized", 401},
		{"badRequest", 400},
		{"serverError", 500},
	}
	for _, tc := range cases {
		t.Run(tc.scenario, func(t *testing.T) {
			server := newFixtureServer(t, serveScenario(t, fx, tc.scenario))
			client := newTestClient(t, server.URL, 0)

			_, err := client.ClaimJobs(context.Background(), 5)
			require.Error(t, err)

			var apiErr *croniumerrors.APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, tc.wantStatus, apiErr.StatusCode)
			// The app's canonical error body is {"error": "<string>"} which
			// does not match the client's structured ErrorResponse shape, so
			// the client falls back to the generic UNKNOWN code.
			assert.Equal(t, "UNKNOWN", apiErr.Code)
			assert.Equal(t, tc.wantStatus == 500, apiErr.Retryable)
		})
	}
}

func TestClaimJobsRetriesOn500ThenSucceeds(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	errHandler := serveScenario(t, fx, "serverError")
	okHandler := serveScenario(t, fx, "success")

	var calls atomic.Int32
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= 2 {
			errHandler(w, r)
			return
		}
		okHandler(w, r)
	})
	client := newTestClient(t, server.URL, 2) // 3 attempts total

	jobs, err := client.ClaimJobs(context.Background(), 5)
	require.NoError(t, err)
	assert.Len(t, jobs, 1)

	// Regression for the "fresh request per attempt" fix: every retried POST
	// must carry the full body, not an already-consumed empty reader.
	reqs := server.captured()
	require.Len(t, reqs, 3)
	first := reqs[0].jsonBody(t)
	for i, req := range reqs {
		assert.NotEmpty(t, req.Body, "attempt %d must have a body", i+1)
		assert.Equal(t, first, req.jsonBody(t), "attempt %d body must match attempt 1", i+1)
	}
}

func TestClaimJobsDoesNotRetryNonRetryable401(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	server := newFixtureServer(t, serveScenario(t, fx, "unauthorized"))
	client := newTestClient(t, server.URL, 3)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)
	assert.Len(t, server.captured(), 1, "401 must not be retried")
}

func TestClaimJobsStructuredErrorBody(t *testing.T) {
	// Synthetic, NOT from the fixtures: the client also understands a
	// structured {"error":{"code","message"}} body. Note the app's canonical
	// error shape is a plain {"error":"<string>"} (see the fixtures), which
	// never matches this branch — canonical errors always surface as code
	// UNKNOWN (asserted in TestClaimJobsErrorScenarios).
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"code":"CAS_CONFLICT","message":"transition rejected"}}`))
	})
	client := newTestClient(t, server.URL, 0)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)
	var apiErr *croniumerrors.APIError
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, 409, apiErr.StatusCode)
	assert.Equal(t, "CAS_CONFLICT", apiErr.Code)
	assert.Contains(t, apiErr.Message, "transition rejected")
	assert.False(t, apiErr.Retryable)
}

func TestClaimJobsMalformedJSONBody(t *testing.T) {
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{not json"))
	})
	client := newTestClient(t, server.URL, 0)

	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse response")
}

func TestClaimJobsConnectionRefused(t *testing.T) {
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {})
	url := server.URL
	server.Close()

	client := newTestClient(t, url, 0)
	_, err := client.ClaimJobs(context.Background(), 5)
	require.Error(t, err)
	assert.Equal(t, croniumerrors.ErrorTypeNetwork, croniumerrors.GetErrorType(err))
}

func TestClaimJobsContextCancellation(t *testing.T) {
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {
		// Block until the client gives up.
		<-r.Context().Done()
	})
	client := newTestClient(t, server.URL, 1)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	_, err := client.ClaimJobs(ctx, 5)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/heartbeat
// ---------------------------------------------------------------------------

func TestJobsHeartbeatSuccessFixture(t *testing.T) {
	fx := loadFixture(t, "jobs-heartbeat")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	resp, err := client.JobsHeartbeat(context.Background(), []string{"job-a", "job-b"})
	require.NoError(t, err)

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "/api/internal/jobs/heartbeat", req.Path)
	assertOrchestratorIdentityHeaders(t, req)
	body := req.jsonBody(t)
	assert.Equal(t, testOrchID, body["orchestratorId"])
	assert.Equal(t, []interface{}{"job-a", "job-b"}, body["jobIds"])

	// Cancellation list handling: both arrays decode faithfully, including
	// which ids landed in which list.
	assert.Equal(t, []string{idAtPath("extended.0"), idAtPath("extended.1")}, resp.Extended)
	assert.Equal(t, []string{idAtPath("cancelRequested.0")}, resp.CancelRequested)
}

func TestJobsHeartbeatErrorScenarios(t *testing.T) {
	fx := loadFixture(t, "jobs-heartbeat")

	for scenario, wantStatus := range map[string]int{
		"unauthorized": 401,
		"badRequest":   400,
		"serverError":  500,
	} {
		t.Run(scenario, func(t *testing.T) {
			server := newFixtureServer(t, serveScenario(t, fx, scenario))
			client := newTestClient(t, server.URL, 0)

			_, err := client.JobsHeartbeat(context.Background(), []string{"job-a"})
			require.Error(t, err)
			var apiErr *croniumerrors.APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, wantStatus, apiErr.StatusCode)
		})
	}
}

// ---------------------------------------------------------------------------
// PUT /api/internal/jobs/[jobId]/status
// ---------------------------------------------------------------------------

func TestUpdateJobStatusSuccessFixture(t *testing.T) {
	fx := loadFixture(t, "jobs-status")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	exitCode := 0
	ctx := WithJobCapability(context.Background(), fixtureToken)
	err := client.UpdateJobStatus(ctx, "job-123", types.JobStatusRunning, &types.StatusUpdate{
		Message:  "started",
		ExitCode: &exitCode,
	})
	require.NoError(t, err)

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPut, req.Method)
	assert.Equal(t, "/api/internal/jobs/job-123/status", req.Path)
	// Job-scoped route: the per-job capability from the context must arrive
	// as X-Job-Capability.
	assertJobCapabilityHeaders(t, req, fixtureToken)

	body := req.jsonBody(t)
	assert.Equal(t, "running", body["status"])
	ts, ok := body["timestamp"].(string)
	require.True(t, ok)
	_, err = time.Parse(time.RFC3339, ts)
	assert.NoError(t, err, "timestamp must be RFC3339")
	details, ok := body["details"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "started", details["message"])
	assert.Equal(t, float64(0), details["exitCode"])
}

func TestUpdateJobStatusWithoutCapabilityOmitsHeader(t *testing.T) {
	fx := loadFixture(t, "jobs-status")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	// Fail-closed contract: with no capability in the context the header is
	// simply absent (the app then rejects; the client never invents one).
	err := client.UpdateJobStatus(context.Background(), "job-123", types.JobStatusRunning, nil)
	require.NoError(t, err)
	assert.Empty(t, server.lastRequest(t).Header.Get("X-Job-Capability"))
}

func TestUpdateJobStatusErrorScenarios(t *testing.T) {
	fx := loadFixture(t, "jobs-status")

	for scenario, wantStatus := range map[string]int{
		"unauthorized":   401,
		"forbidden":      403,
		"forbiddenScope": 403,
		"notFound":       404,
		"casConflict":    409,
	} {
		t.Run(scenario, func(t *testing.T) {
			server := newFixtureServer(t, serveScenario(t, fx, scenario))
			client := newTestClient(t, server.URL, 2)

			ctx := WithJobCapability(context.Background(), fixtureToken)
			err := client.UpdateJobStatus(ctx, "job-123", types.JobStatusRunning, nil)
			require.Error(t, err)
			var apiErr *croniumerrors.APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, wantStatus, apiErr.StatusCode)
			assert.Len(t, server.captured(), 1, "4xx must not be retried")
		})
	}
}

func TestUpdateJobStatusSuccessFalse(t *testing.T) {
	// Not a canonical fixture scenario: exercises the client's own
	// success=false guard branch.
	server := newFixtureServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":false}`))
	})
	client := newTestClient(t, server.URL, 0)

	err := client.UpdateJobStatus(context.Background(), "job-123", types.JobStatusRunning, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to update job status")
}

// ---------------------------------------------------------------------------
// POST /api/internal/jobs/[jobId]/complete
// ---------------------------------------------------------------------------

func TestCompleteJobSuccessFixture(t *testing.T) {
	fx := loadFixture(t, "jobs-complete")

	for _, scenario := range []string{"success", "idempotentNoop"} {
		t.Run(scenario, func(t *testing.T) {
			server := newFixtureServer(t, serveScenario(t, fx, scenario))
			client := newTestClient(t, server.URL, 0)

			ctx := WithJobCapability(context.Background(), fixtureToken)
			req := &CompleteJobRequest{
				Status:   types.JobStatusCompleted,
				ExitCode: 0,
				Output:   Output{Stdout: "hello world", Stderr: ""},
			}
			require.NoError(t, client.CompleteJob(ctx, "job-123", req))

			captured := server.lastRequest(t)
			assert.Equal(t, http.MethodPost, captured.Method)
			assert.Equal(t, "/api/internal/jobs/job-123/complete", captured.Path)
			assertJobCapabilityHeaders(t, captured, fixtureToken)

			body := captured.jsonBody(t)
			assert.Equal(t, "completed", body["status"])
			assert.Equal(t, float64(0), body["exitCode"])
			output, ok := body["output"].(map[string]interface{})
			require.True(t, ok)
			assert.Equal(t, "hello world", output["stdout"])

			// CompleteJob stamps the timestamp on the caller's request.
			require.NotEmpty(t, req.Timestamp)
			_, err := time.Parse(time.RFC3339, req.Timestamp)
			assert.NoError(t, err)
			// Zero-valued honest-stats fields are omitted from the wire.
			assert.NotContains(t, body, "droppedLogLines")
			assert.NotContains(t, body, "outputTruncatedBytes")
		})
	}
}

func TestCompleteJobErrorScenarios(t *testing.T) {
	fx := loadFixture(t, "jobs-complete")

	for scenario, wantStatus := range map[string]int{
		"unauthorized":      401,
		"forbiddenScope":    403,
		"notFound":          404,
		"ownershipConflict": 409,
		"casConflict":       409,
		"serverError":       500,
	} {
		t.Run(scenario, func(t *testing.T) {
			server := newFixtureServer(t, serveScenario(t, fx, scenario))
			client := newTestClient(t, server.URL, 0)

			ctx := WithJobCapability(context.Background(), fixtureToken)
			err := client.CompleteJob(ctx, "job-123", &CompleteJobRequest{Status: types.JobStatusCompleted})
			require.Error(t, err)
			var apiErr *croniumerrors.APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, wantStatus, apiErr.StatusCode)
		})
	}
}

// ---------------------------------------------------------------------------
// POST /api/internal/executions/[executionId]/create
// ---------------------------------------------------------------------------

func TestCreateExecutionSuccessFixture(t *testing.T) {
	fx := loadFixture(t, "executions-create")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	serverID := "7"
	serverName := "sandbox-1"
	ctx := WithJobCapability(context.Background(), fixtureToken)
	err := client.CreateExecution(ctx, "exec-1", "job-123", &serverID, &serverName)
	require.NoError(t, err)

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "/api/internal/executions/exec-1/create", req.Path)
	assertJobCapabilityHeaders(t, req, fixtureToken)

	body := req.jsonBody(t)
	assert.Equal(t, "job-123", body["jobId"])
	assert.Equal(t, "7", body["serverId"])
	assert.Equal(t, "sandbox-1", body["serverName"])
}

func TestCreateExecutionOmitsNilServerFields(t *testing.T) {
	fx := loadFixture(t, "executions-create")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	err := client.CreateExecution(context.Background(), "exec-1", "job-123", nil, nil)
	require.NoError(t, err)

	body := server.lastRequest(t).jsonBody(t)
	assert.Equal(t, "job-123", body["jobId"])
	assert.NotContains(t, body, "serverId")
	assert.NotContains(t, body, "serverName")
}

func TestCreateExecutionErrorScenarios(t *testing.T) {
	fx := loadFixture(t, "executions-create")

	for scenario, wantStatus := range map[string]int{
		"unauthorized": 401,
		"forbidden":    403,
		"badRequest":   400,
		"serverError":  500,
	} {
		t.Run(scenario, func(t *testing.T) {
			server := newFixtureServer(t, serveScenario(t, fx, scenario))
			client := newTestClient(t, server.URL, 0)

			err := client.CreateExecution(context.Background(), "exec-1", "job-123", nil, nil)
			require.Error(t, err)
			var apiErr *croniumerrors.APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, wantStatus, apiErr.StatusCode)
		})
	}
}

// ---------------------------------------------------------------------------
// PUT /api/internal/executions/[executionId]/update
// ---------------------------------------------------------------------------

func TestUpdateExecutionFullDetailsFixture(t *testing.T) {
	fx := loadFixture(t, "executions-update")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	started := fixtureTime
	completed := fixtureTime.Add(90 * time.Second)
	exitCode := 0
	output := "hello"
	errMsg := "boom"
	setupDur := int64(1000)
	execDur := int64(2000)
	cleanupDur := int64(500)
	totalDur := int64(3500)

	ctx := WithJobCapability(context.Background(), fixtureToken)
	err := client.UpdateExecution(ctx, "exec-1", types.JobStatusRunning, &ExecutionStatusUpdate{
		StartedAt:            &started,
		CompletedAt:          &completed,
		ExitCode:             &exitCode,
		Output:               &output,
		Error:                &errMsg,
		SetupStartedAt:       &started,
		SetupCompletedAt:     &completed,
		ExecutionStartedAt:   &started,
		ExecutionCompletedAt: &completed,
		CleanupStartedAt:     &started,
		CleanupCompletedAt:   &completed,
		SetupDuration:        &setupDur,
		ExecutionDuration:    &execDur,
		CleanupDuration:      &cleanupDur,
		TotalDuration:        &totalDur,
		ExecutionMetadata:    map[string]interface{}{"phase": "done"},
	})
	require.NoError(t, err)

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPut, req.Method)
	assert.Equal(t, "/api/internal/executions/exec-1/update", req.Path)
	assertJobCapabilityHeaders(t, req, fixtureToken)

	body := req.jsonBody(t)
	assert.Equal(t, "running", body["status"])
	assert.Equal(t, started.Format(time.RFC3339), body["startedAt"])
	assert.Equal(t, completed.Format(time.RFC3339), body["completedAt"])
	assert.Equal(t, float64(0), body["exitCode"])
	assert.Equal(t, "hello", body["output"])
	assert.Equal(t, "boom", body["error"])
	for _, key := range []string{
		"setupStartedAt", "setupCompletedAt",
		"executionStartedAt", "executionCompletedAt",
		"cleanupStartedAt", "cleanupCompletedAt",
	} {
		assert.Contains(t, body, key)
	}
	assert.Equal(t, float64(1000), body["setupDuration"])
	assert.Equal(t, float64(2000), body["executionDuration"])
	assert.Equal(t, float64(500), body["cleanupDuration"])
	assert.Equal(t, float64(3500), body["totalDuration"])
	assert.Equal(t, map[string]interface{}{"phase": "done"}, body["executionMetadata"])
}

func TestUpdateExecutionMinimal(t *testing.T) {
	fx := loadFixture(t, "executions-update")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	err := client.UpdateExecution(context.Background(), "exec-1", types.JobStatusRunning, nil)
	require.NoError(t, err)

	body := server.lastRequest(t).jsonBody(t)
	assert.Equal(t, map[string]interface{}{"status": "running"}, body)
}

func TestUpdateExecutionNotFound(t *testing.T) {
	fx := loadFixture(t, "executions-update")
	server := newFixtureServer(t, serveScenario(t, fx, "notFound"))
	client := newTestClient(t, server.URL, 0)

	err := client.UpdateExecution(context.Background(), "exec-1", types.JobStatusRunning, nil)
	require.Error(t, err)
	var apiErr *croniumerrors.APIError
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, 404, apiErr.StatusCode)
}

// ---------------------------------------------------------------------------
// Orchestrator-identity routes: health / heartbeat / metrics
// ---------------------------------------------------------------------------

func TestReportHealthFixture(t *testing.T) {
	fx := loadFixture(t, "orchestrator-health")
	server := newFixtureServer(t, serveScenario(t, fx, "reportSuccess"))
	client := newTestClient(t, server.URL, 0)

	report := &HealthReport{OrchestratorID: testOrchID, Status: "healthy"}
	require.NoError(t, client.ReportHealth(context.Background(), report))

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "/api/internal/orchestrator/health", req.Path)
	assertOrchestratorIdentityHeaders(t, req)
	assert.NotEmpty(t, report.Timestamp, "ReportHealth must stamp the timestamp")

	body := req.jsonBody(t)
	assert.Equal(t, testOrchID, body["orchestratorId"])
	assert.Equal(t, "healthy", body["status"])
}

func TestSendHeartbeatFixture(t *testing.T) {
	fx := loadFixture(t, "orchestrator-heartbeat")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	hb := &HeartbeatRequest{
		OrchestratorID: testOrchID,
		RunningJobs:    []string{"job-a"},
		Capacity:       &HeartbeatCapacity{MaxJobs: 5, CurrentJobs: 1, AvailableSlots: 4},
	}
	require.NoError(t, client.SendHeartbeat(context.Background(), hb))

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "/api/internal/orchestrator/heartbeat", req.Path)
	assertOrchestratorIdentityHeaders(t, req)
	assert.NotEmpty(t, hb.Timestamp)

	body := req.jsonBody(t)
	assert.Equal(t, testOrchID, body["orchestratorId"])
	assert.Equal(t, []interface{}{"job-a"}, body["runningJobs"])
	capacity, ok := body["capacity"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(4), capacity["availableSlots"])
}

func TestSendMetricsFixture(t *testing.T) {
	fx := loadFixture(t, "orchestrator-metrics")
	server := newFixtureServer(t, serveScenario(t, fx, "success"))
	client := newTestClient(t, server.URL, 0)

	m := &MetricsRequest{
		OrchestratorID: testOrchID,
		Metrics:        OrchestratorStats{JobsProcessed: 10, JobsSucceeded: 9, JobsFailed: 1},
		Period:         "60s",
	}
	require.NoError(t, client.SendMetrics(context.Background(), m))

	req := server.lastRequest(t)
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "/api/internal/orchestrator/metrics", req.Path)
	assertOrchestratorIdentityHeaders(t, req)
	assert.NotEmpty(t, m.Timestamp)

	body := req.jsonBody(t)
	metrics, ok := body["metrics"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(10), metrics["jobsProcessed"])
}

func TestSendMetricsBadRequestFixture(t *testing.T) {
	fx := loadFixture(t, "orchestrator-metrics")
	server := newFixtureServer(t, serveScenario(t, fx, "badRequestMissingMetrics"))
	client := newTestClient(t, server.URL, 0)

	err := client.SendMetrics(context.Background(), &MetricsRequest{OrchestratorID: testOrchID})
	require.Error(t, err)
	var apiErr *croniumerrors.APIError
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
}

func TestHealthCheckFixture(t *testing.T) {
	fx := loadFixture(t, "orchestrator-health")

	t.Run("healthy", func(t *testing.T) {
		server := newFixtureServer(t, serveScenario(t, fx, "healthy"))
		client := newTestClient(t, server.URL, 0)

		require.NoError(t, client.HealthCheck(context.Background()))
		req := server.lastRequest(t)
		assert.Equal(t, http.MethodGet, req.Method)
		assert.Equal(t, "/api/internal/orchestrator/health", req.Path)
		assertOrchestratorIdentityHeaders(t, req)
	})

	t.Run("unhealthy", func(t *testing.T) {
		server := newFixtureServer(t, serveScenario(t, fx, "unhealthy"))
		client := newTestClient(t, server.URL, 0)

		err := client.HealthCheck(context.Background())
		require.Error(t, err)
		var apiErr *croniumerrors.APIError
		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, 503, apiErr.StatusCode)
		assert.True(t, apiErr.Retryable, "5xx must be marked retryable")
	})
}

// ---------------------------------------------------------------------------
// convertQueuedJob: field-by-field mapping
// ---------------------------------------------------------------------------

// TestConvertQueuedJobFromClaimFixture drives the conversion with the
// canonical job shape from the jobs-claim fixture and asserts the mapping
// field by field against the source QueuedJob.
func TestConvertQueuedJobFromClaimFixture(t *testing.T) {
	fx := loadFixture(t, "jobs-claim")
	raw, _ := resolvedBody(t, fx, "success")

	var response PollJobsResponse
	require.NoError(t, json.Unmarshal(raw, &response))
	require.Len(t, response.Jobs, 1)
	qj := response.Jobs[0]

	job := convertQueuedJob(qj)

	assert.Equal(t, qj.ID, job.ID)
	assert.Equal(t, types.JobType(qj.Type), job.Type)
	assert.Equal(t, qj.Priority, job.Priority)
	assert.True(t, job.CreatedAt.Equal(qj.CreatedAt))
	require.NotNil(t, job.ScheduledFor)
	assert.True(t, job.ScheduledFor.Equal(*qj.ScheduledFor))
	assert.Equal(t, qj.Attempts, job.Attempts)
	assert.Equal(t, qj.Metadata, job.Metadata)
	assert.Equal(t, qj.CapabilityToken, job.CapabilityToken)

	assert.Equal(t, qj.Execution.Environment, job.Execution.Environment)
	// Wire timeout is nanoseconds: 60000000000 in the fixture == 60s.
	assert.Equal(t, time.Duration(qj.Execution.Timeout), job.Execution.Timeout)
	assert.Equal(t, 60*time.Second, job.Execution.Timeout)
	assert.Equal(t, qj.Execution.InputData, job.Execution.InputData)
	assert.Equal(t, qj.Execution.Variables, job.Execution.Variables)

	assert.Equal(t, types.TargetType(qj.Execution.Target.Type), job.Execution.Target.Type)
	assert.Equal(t, qj.Execution.Target.ServerID, job.Execution.Target.ServerID)
	assert.Nil(t, job.Execution.Target.ServerDetails)

	require.NotNil(t, job.Execution.Script)
	assert.Equal(t, types.ScriptType(qj.Execution.Script.Type), job.Execution.Script.Type)
	assert.Equal(t, qj.Execution.Script.Content, job.Execution.Script.Content)
	assert.Equal(t, qj.Execution.Script.WorkingDirectory, job.Execution.Script.WorkingDirectory)

	assert.Nil(t, job.Execution.Resources)
	assert.Nil(t, job.Execution.RetryPolicy)

	// The runtime timeout is materialized from the execution config.
	assert.Equal(t, job.GetTimeout(), job.Timeout)
	assert.Equal(t, 60*time.Second, job.Timeout)
}

// TestConvertQueuedJobOptionalBranches covers the optional sub-structs the
// canonical claim fixture does not include (server details, resources, retry
// policy). Synthetic input: this exercises conversion branches, not the wire
// contract.
func TestConvertQueuedJobOptionalBranches(t *testing.T) {
	scheduled := fixtureTime.Add(time.Minute)
	qj := QueuedJob{
		ID:           "job-ssh",
		Type:         "ssh",
		Priority:     3,
		CreatedAt:    fixtureTime,
		ScheduledFor: &scheduled,
		Attempts:     2,
		Execution: ExecutionConfig{
			Environment: map[string]string{"A": "1"},
			Timeout:     int64(90 * time.Second),
			Target: Target{
				Type: "server",
				ServerDetails: &ServerDetails{
					ID:         "7",
					Name:       "sandbox-1",
					Host:       "203.0.113.10",
					Port:       2222,
					Username:   "deploy",
					PrivateKey: "key-material",
					Password:   "pw",
					Passphrase: "pp",
				},
			},
			Resources: &Resources{
				CPULimit:    1.5,
				MemoryLimit: 1024,
				DiskLimit:   2048,
				PidsLimit:   64,
			},
			RetryPolicy: &RetryPolicy{
				MaxAttempts:  4,
				BackoffType:  "exponential",
				BackoffDelay: 5, // seconds on the wire
			},
		},
	}

	job := convertQueuedJob(qj)

	require.NotNil(t, job.Execution.Target.ServerDetails)
	sd := job.Execution.Target.ServerDetails
	assert.Equal(t, "7", sd.ID)
	assert.Equal(t, "sandbox-1", sd.Name)
	assert.Equal(t, "203.0.113.10", sd.Host)
	assert.Equal(t, 2222, sd.Port)
	assert.Equal(t, "deploy", sd.Username)
	assert.Equal(t, "key-material", sd.PrivateKey)
	assert.Equal(t, "pw", sd.Password)
	assert.Equal(t, "pp", sd.Passphrase)

	require.NotNil(t, job.Execution.Resources)
	assert.Equal(t, 1.5, job.Execution.Resources.CPULimit)
	assert.Equal(t, int64(1024), job.Execution.Resources.MemoryLimit)
	assert.Equal(t, int64(2048), job.Execution.Resources.DiskLimit)
	assert.Equal(t, int64(64), job.Execution.Resources.PidsLimit)

	require.NotNil(t, job.Execution.RetryPolicy)
	assert.Equal(t, 4, job.Execution.RetryPolicy.MaxAttempts)
	assert.Equal(t, "exponential", job.Execution.RetryPolicy.BackoffType)
	assert.Equal(t, 5*time.Second, job.Execution.RetryPolicy.BackoffDelay)

	assert.Equal(t, 90*time.Second, job.Execution.Timeout)
	assert.Equal(t, 90*time.Second, job.Timeout)
	assert.Nil(t, job.Execution.Script)
}

func TestConvertServerDetailsNil(t *testing.T) {
	assert.Nil(t, convertServerDetails(nil))
}
