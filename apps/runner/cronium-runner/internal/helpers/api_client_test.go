package helpers

// The runner-side API client talks to the cronium-runtime service, whose
// responses use the {"success": bool, "data": ..., "error": ...} envelope
// (apps/runtime/cronium-runtime/internal/handlers). Note this is a different
// wire contract from the Next.js internal API pinned by
// tests/fixtures/internal-api/ — those fixtures do not apply here, so these
// tests pin the request/response shapes the client code itself expects.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// recordedRequest captures what the client actually sent.
type recordedRequest struct {
	method  string
	path    string
	rawPath string
	auth    string
	ctype   string
	body    []byte
	visited bool
}

// newTestClient points a client for execution exec-1 at a URL, with retries that
// do not wait.
func newTestClient(endpoint string) *APIClient {
	client := NewAPIClient(endpoint, "test-token", "exec-1")
	client.retryDelay = 0
	return client
}

// newRecordingServer runs an httptest server that records the request and
// replies with the given status and raw body.
func newRecordingServer(t *testing.T, status int, respBody string) (*APIClient, *recordedRequest) {
	t.Helper()
	rec := &recordedRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("failed to read request body: %v", err)
		}
		rec.method = r.Method
		rec.path = r.URL.Path
		rec.rawPath = r.URL.EscapedPath()
		rec.auth = r.Header.Get("Authorization")
		rec.ctype = r.Header.Get("Content-Type")
		rec.body = body
		rec.visited = true
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return newTestClient(srv.URL), rec
}

// newStatusSequenceServer answers with each status in turn, then 200, and counts
// the requests it saw.
func newStatusSequenceServer(t *testing.T, statuses ...int) (*APIClient, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call := int(calls.Add(1))
		if call <= len(statuses) {
			w.WriteHeader(statuses[call-1])
			_, _ = w.Write([]byte(`{"error":"failed"}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"data":"ok"}`))
	}))
	t.Cleanup(srv.Close)
	return newTestClient(srv.URL), &calls
}

func assertRequest(t *testing.T, rec *recordedRequest, method, path string) {
	t.Helper()
	if !rec.visited {
		t.Fatal("server was never called")
	}
	if rec.method != method {
		t.Errorf("method = %q, want %q", rec.method, method)
	}
	if rec.path != path {
		t.Errorf("path = %q, want %q", rec.path, path)
	}
	if rec.auth != "Bearer test-token" {
		t.Errorf("Authorization = %q, want Bearer test-token", rec.auth)
	}
	if rec.ctype != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", rec.ctype)
	}
}

func assertBody(t *testing.T, rec *recordedRequest, want map[string]interface{}) {
	t.Helper()
	var body map[string]interface{}
	if err := json.Unmarshal(rec.body, &body); err != nil {
		t.Fatalf("request body is not JSON: %v (%q)", err, rec.body)
	}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("request body = %#v, want %#v", body, want)
	}
}

func TestGetInputRequestShapeAndSuccess(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true,"data":{"b":1,"a":"two"}}`)

	data, err := client.GetInput()
	if err != nil {
		t.Fatalf("GetInput failed: %v", err)
	}
	assertRequest(t, rec, http.MethodGet, "/executions/exec-1/input")
	if string(data) != `{"b":1,"a":"two"}` {
		t.Errorf("data = %s, want the JSON exactly as sent", data)
	}
}

func TestGetInputNullIsNil(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":true,"data":null}`)
	data, err := client.GetInput()
	if err != nil {
		t.Fatalf("GetInput failed: %v", err)
	}
	if data != nil {
		t.Errorf("data = %s, want nil", data)
	}
}

func TestGetInputAPIError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"boom"}`)
	_, err := client.GetInput()
	if err == nil || !strings.Contains(err.Error(), "API error: boom") {
		t.Fatalf("expected API error, got: %v", err)
	}
}

func TestGetInputMalformedResponse(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, "not-json")
	_, err := client.GetInput()
	if err == nil || !strings.Contains(err.Error(), "failed to parse response") {
		t.Fatalf("expected parse error, got: %v", err)
	}
}

func TestGetInputHTTPErrorIncludesStatusAndBody(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusInternalServerError, `{"error":"internal"}`)
	_, err := client.GetInput()
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") || !strings.Contains(err.Error(), "internal") {
		t.Fatalf("expected HTTP 500 error with body, got: %v", err)
	}
}

func TestGetInputUnauthorized(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusUnauthorized, `{"error":"missing or invalid execution token"}`)
	_, err := client.GetInput()
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("expected HTTP 401 error, got: %v", err)
	}
}

func TestSetOutputPostsDataEnvelope(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true}`)

	if err := client.SetOutput(json.RawMessage(`{"answer":42}`)); err != nil {
		t.Fatalf("SetOutput failed: %v", err)
	}
	assertRequest(t, rec, http.MethodPost, "/executions/exec-1/output")
	assertBody(t, rec, map[string]interface{}{"data": map[string]interface{}{"answer": float64(42)}})
}

// Regression (FINDINGS #37): a 200 response with {"success":false} is a
// FAILED write — the envelope is inspected on write paths too, and the
// envelope's error message is surfaced. (This flips the old
// TestSetOutputIgnoresEnvelopeOn200 pin of the status-only check.)
func TestSetOutputEnvelopeFailureOn200IsError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"backend rejected output"}`)
	err := client.SetOutput(json.RawMessage(`"x"`))
	if err == nil || !strings.Contains(err.Error(), "API error: backend rejected output") {
		t.Fatalf("expected the envelope's error to surface, got: %v", err)
	}
}

// SetVariable shares the same envelope check (the sibling write path).
func TestSetVariableEnvelopeFailureOn200IsError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"variable is locked by another process"}`)
	err := client.SetVariable("MY_KEY", json.RawMessage(`"v"`))
	if err == nil || !strings.Contains(err.Error(), "API error: variable is locked by another process") {
		t.Fatalf("expected the envelope's error to surface, got: %v", err)
	}
}

func TestSetOutputMalformedResponse(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, "not-json")
	err := client.SetOutput(json.RawMessage(`"x"`))
	if err == nil || !strings.Contains(err.Error(), "failed to parse response") {
		t.Fatalf("expected parse error, got: %v", err)
	}
}

func TestSetOutputHTTPError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusRequestEntityTooLarge, `{"error":"too large"}`)
	err := client.SetOutput(json.RawMessage(`"x"`))
	if err == nil || !strings.Contains(err.Error(), "HTTP 413") {
		t.Fatalf("expected HTTP 413 error, got: %v", err)
	}
}

func TestGetVariableRequestShapeAndSuccess(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK,
		`{"success":true,"data":{"key":"MY_KEY","value":"hello"}}`)

	value, err := client.GetVariable("MY_KEY")
	if err != nil {
		t.Fatalf("GetVariable failed: %v", err)
	}
	assertRequest(t, rec, http.MethodGet, "/executions/exec-1/variables/MY_KEY")
	if string(value) != `"hello"` {
		t.Errorf("value = %s, want \"hello\"", value)
	}
}

// An HTTP failure reads as it does from the container's bash SDK.
func TestHTTPErrorMessage(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"message wins", `{"error":"Bad Gateway","message":"tool action failed"}`, "API request failed - HTTP 502 - tool action failed"},
		{"error alone", `{"error":"Forbidden"}`, "API request failed - HTTP 502 - Forbidden"},
		{"neither", `{}`, "API request failed - HTTP 502 - Unknown error"},
		{"not json", "<html>bad gateway</html>\n", "API request failed - HTTP 502 - <html>bad gateway</html>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := newRecordingServer(t, http.StatusBadGateway, tc.body)
			_, err := client.ExecuteToolAction("sql", "run-query", json.RawMessage(`{}`))
			if err == nil || err.Error() != tc.want {
				t.Errorf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

// A key can hold characters that mean something in a URL path.
func TestGetVariableEscapesKey(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true,"data":{"value":"v"}}`)
	if _, err := client.GetVariable("a b/c"); err != nil {
		t.Fatalf("GetVariable failed: %v", err)
	}
	if rec.rawPath != "/executions/exec-1/variables/a%20b%2Fc" {
		t.Errorf("escaped path = %q", rec.rawPath)
	}
}

// An unset variable reads as nil, whichever way the runtime reports it.
func TestGetVariableUnsetIsNil(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
	}{
		"null value": {http.StatusOK, `{"success":true,"data":{"key":"K","value":null}}`},
		"404":        {http.StatusNotFound, `{"message":"Variable not found"}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			client, _ := newRecordingServer(t, tc.status, tc.body)
			value, err := client.GetVariable("K")
			if err != nil {
				t.Fatalf("GetVariable failed: %v", err)
			}
			if value != nil {
				t.Errorf("value = %s, want nil", value)
			}
		})
	}
}

func TestGetVariableAPIError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"nope"}`)
	_, err := client.GetVariable("MY_KEY")
	if err == nil || !strings.Contains(err.Error(), "API error: nope") {
		t.Fatalf("expected API error, got: %v", err)
	}
}

func TestSetVariablePutsValueEnvelope(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true}`)

	if err := client.SetVariable("MY_KEY", json.RawMessage(`[1,"two"]`)); err != nil {
		t.Fatalf("SetVariable failed: %v", err)
	}
	assertRequest(t, rec, http.MethodPut, "/executions/exec-1/variables/MY_KEY")
	assertBody(t, rec, map[string]interface{}{"value": []interface{}{float64(1), "two"}})
}

func TestSetConditionPostsBoolean(t *testing.T) {
	for _, condition := range []bool{true, false} {
		client, rec := newRecordingServer(t, http.StatusOK, `{"success":true}`)
		if err := client.SetCondition(condition); err != nil {
			t.Fatalf("SetCondition(%v) failed: %v", condition, err)
		}
		assertRequest(t, rec, http.MethodPost, "/executions/exec-1/condition")
		assertBody(t, rec, map[string]interface{}{"condition": condition})
	}
}

func TestSetConditionEnvelopeFailureOn200IsError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"denied"}`)
	err := client.SetCondition(true)
	if err == nil || !strings.Contains(err.Error(), "API error: denied") {
		t.Fatalf("expected the envelope's error to surface, got: %v", err)
	}
}

// The context comes back untouched: fields the runner has never heard of, in the
// runtime's order, so cronium.event() matches a container.
func TestGetContextReturnsRuntimeFieldsUntouched(t *testing.T) {
	const context = `{"executionId":"exec-1","eventId":"42","userId":"u1","event":{"name":"Demo","runLocation":"REMOTE"},"metadata":{"z":1,"a":2}}`
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true,"data":`+context+`}`)

	data, err := client.GetContext()
	if err != nil {
		t.Fatalf("GetContext failed: %v", err)
	}
	assertRequest(t, rec, http.MethodGet, "/executions/exec-1/context")
	if string(data) != context {
		t.Errorf("context = %s, want %s", data, context)
	}
}

func TestGetContextAPIError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"denied"}`)
	_, err := client.GetContext()
	if err == nil || !strings.Contains(err.Error(), "API error: denied") {
		t.Fatalf("expected API error, got: %v", err)
	}
}

func TestExecuteToolActionRequestShapeAndResult(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true,"data":{"sent":true}}`)

	result, err := client.ExecuteToolAction("slack", "send_message", json.RawMessage(`{"channel":"#x"}`))
	if err != nil {
		t.Fatalf("ExecuteToolAction failed: %v", err)
	}
	assertRequest(t, rec, http.MethodPost, "/tool-actions/execute")
	assertBody(t, rec, map[string]interface{}{
		"tool":   "slack",
		"action": "send_message",
		"config": map[string]interface{}{"channel": "#x"},
	})
	if string(result) != `{"sent":true}` {
		t.Errorf("result = %s", result)
	}
}

func TestDoRequestConnectionRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	endpoint := srv.URL
	srv.Close() // guarantee nothing is listening

	_, err := newTestClient(endpoint).GetInput()
	if err == nil || !strings.Contains(err.Error(), "request failed") {
		t.Fatalf("expected transport error, got: %v", err)
	}
}

func TestRetriesServerErrorsThenSucceeds(t *testing.T) {
	client, calls := newStatusSequenceServer(t, http.StatusServiceUnavailable, http.StatusBadGateway)

	data, err := client.GetInput()
	if err != nil {
		t.Fatalf("expected success after retries, got: %v", err)
	}
	if string(data) != `"ok"` {
		t.Errorf("data = %s", data)
	}
	if calls.Load() != 3 {
		t.Errorf("attempts = %d, want 3", calls.Load())
	}
}

func TestGivesUpAfterMaxAttempts(t *testing.T) {
	client, calls := newStatusSequenceServer(t, 500, 500, 500, 500)
	_, err := client.GetInput()
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("expected HTTP 500, got: %v", err)
	}
	if calls.Load() != maxRequestAttempts {
		t.Errorf("attempts = %d, want %d", calls.Load(), maxRequestAttempts)
	}
}

// A retry resends the same body, not the one the first attempt drained.
func TestRetryResendsBody(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(body))
		mu.Unlock()
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	t.Cleanup(srv.Close)

	if err := newTestClient(srv.URL).SetCondition(true); err != nil {
		t.Fatalf("SetCondition failed: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 || bodies[0] != bodies[1] || bodies[1] != `{"condition":true}` {
		t.Errorf("bodies = %q", bodies)
	}
}

func TestDoesNotRetryWhatARetryCannotFix(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusForbidden, http.StatusNotImplemented} {
		client, calls := newStatusSequenceServer(t, status, status)
		if _, err := client.GetInput(); err == nil {
			t.Errorf("status %d: expected an error", status)
		}
		if calls.Load() != 1 {
			t.Errorf("status %d: attempts = %d, want 1", status, calls.Load())
		}
	}
}

// A tool action that reported failure may already have sent its message.
func TestToolActionIsNotRetried(t *testing.T) {
	client, calls := newStatusSequenceServer(t, http.StatusBadGateway, http.StatusBadGateway)
	if _, err := client.ExecuteToolAction("email", "send_message", json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected an error")
	}
	if calls.Load() != 1 {
		t.Errorf("attempts = %d, want 1", calls.Load())
	}
}
