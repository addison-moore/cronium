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
	"testing"
)

// recordedRequest captures what the client actually sent.
type recordedRequest struct {
	method  string
	path    string
	auth    string
	ctype   string
	body    []byte
	visited bool
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
		rec.auth = r.Header.Get("Authorization")
		rec.ctype = r.Header.Get("Content-Type")
		rec.body = body
		rec.visited = true
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return NewAPIClient(srv.URL, "test-token"), rec
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

func TestGetInputRequestShapeAndSuccess(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true,"data":{"a":1,"b":"two"}}`)

	data, err := client.GetInput("exec-1")
	if err != nil {
		t.Fatalf("GetInput failed: %v", err)
	}
	assertRequest(t, rec, http.MethodGet, "/executions/exec-1/input")
	want := map[string]interface{}{"a": float64(1), "b": "two"}
	if !reflect.DeepEqual(data, want) {
		t.Errorf("data = %#v, want %#v", data, want)
	}
}

func TestGetInputAPIError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"boom"}`)
	_, err := client.GetInput("exec-1")
	if err == nil || !strings.Contains(err.Error(), "API error: boom") {
		t.Fatalf("expected API error, got: %v", err)
	}
}

func TestGetInputMalformedResponse(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, "not-json")
	_, err := client.GetInput("exec-1")
	if err == nil || !strings.Contains(err.Error(), "failed to parse response") {
		t.Fatalf("expected parse error, got: %v", err)
	}
}

func TestGetInputHTTPErrorIncludesStatusAndBody(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusInternalServerError, `{"error":"internal"}`)
	_, err := client.GetInput("exec-1")
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") || !strings.Contains(err.Error(), "internal") {
		t.Fatalf("expected HTTP 500 error with body, got: %v", err)
	}
}

func TestGetInputUnauthorized(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusUnauthorized, `{"error":"missing or invalid execution token"}`)
	_, err := client.GetInput("exec-1")
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("expected HTTP 401 error, got: %v", err)
	}
}

func TestSetOutputPostsDataEnvelope(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true}`)

	if err := client.SetOutput("exec-9", map[string]interface{}{"answer": 42}); err != nil {
		t.Fatalf("SetOutput failed: %v", err)
	}
	assertRequest(t, rec, http.MethodPost, "/executions/exec-9/output")

	var body map[string]interface{}
	if err := json.Unmarshal(rec.body, &body); err != nil {
		t.Fatalf("request body is not JSON: %v (%q)", err, rec.body)
	}
	want := map[string]interface{}{"data": map[string]interface{}{"answer": float64(42)}}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("request body = %#v, want %#v", body, want)
	}
}

// Pin actual behavior: SetOutput only checks the HTTP status; a 200 response
// with {"success":false} is still treated as success (the envelope is not
// inspected on write paths).
func TestSetOutputIgnoresEnvelopeOn200(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"ignored"}`)
	if err := client.SetOutput("exec-9", "x"); err != nil {
		t.Fatalf("expected nil error (status-only check), got: %v", err)
	}
}

func TestSetOutputHTTPError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusRequestEntityTooLarge, `{"error":"too large"}`)
	err := client.SetOutput("exec-9", "x")
	if err == nil || !strings.Contains(err.Error(), "HTTP 413") {
		t.Fatalf("expected HTTP 413 error, got: %v", err)
	}
}

func TestGetVariableRequestShapeAndSuccess(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK,
		`{"success":true,"data":{"key":"MY_KEY","value":"hello"}}`)

	value, err := client.GetVariable("exec-1", "MY_KEY")
	if err != nil {
		t.Fatalf("GetVariable failed: %v", err)
	}
	assertRequest(t, rec, http.MethodGet, "/executions/exec-1/variables/MY_KEY")
	if value != "hello" {
		t.Errorf("value = %#v, want hello", value)
	}
}

func TestGetVariableAPIError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"nope"}`)
	_, err := client.GetVariable("exec-1", "MY_KEY")
	if err == nil || !strings.Contains(err.Error(), "API error: nope") {
		t.Fatalf("expected API error, got: %v", err)
	}
}

func TestSetVariablePutsValueEnvelope(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{"success":true}`)

	if err := client.SetVariable("exec-1", "MY_KEY", []interface{}{1, "two"}); err != nil {
		t.Fatalf("SetVariable failed: %v", err)
	}
	assertRequest(t, rec, http.MethodPut, "/executions/exec-1/variables/MY_KEY")

	var body map[string]interface{}
	if err := json.Unmarshal(rec.body, &body); err != nil {
		t.Fatalf("request body is not JSON: %v (%q)", err, rec.body)
	}
	want := map[string]interface{}{"value": []interface{}{float64(1), "two"}}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("request body = %#v, want %#v", body, want)
	}
}

func TestGetContextRequestShapeAndSuccess(t *testing.T) {
	client, rec := newRecordingServer(t, http.StatusOK, `{
		"success": true,
		"data": {
			"eventId": "42",
			"eventName": "Demo Event",
			"executionId": "exec-1",
			"jobId": "job-1",
			"trigger": "manual",
			"startTime": "2026-01-02T03:04:05Z",
			"environment": {"FOO": "bar"},
			"metadata": {"k": "v"}
		}
	}`)

	ctx, err := client.GetContext("exec-1")
	if err != nil {
		t.Fatalf("GetContext failed: %v", err)
	}
	assertRequest(t, rec, http.MethodGet, "/executions/exec-1/context")
	want := &EventContext{
		EventID:     "42",
		EventName:   "Demo Event",
		ExecutionID: "exec-1",
		JobID:       "job-1",
		Trigger:     "manual",
		StartTime:   "2026-01-02T03:04:05Z",
		Environment: map[string]string{"FOO": "bar"},
		Metadata:    map[string]interface{}{"k": "v"},
	}
	if !reflect.DeepEqual(ctx, want) {
		t.Errorf("context = %#v, want %#v", ctx, want)
	}
}

func TestGetContextAPIError(t *testing.T) {
	client, _ := newRecordingServer(t, http.StatusOK, `{"success":false,"error":"denied"}`)
	_, err := client.GetContext("exec-1")
	if err == nil || !strings.Contains(err.Error(), "API error: denied") {
		t.Fatalf("expected API error, got: %v", err)
	}
}

func TestDoRequestConnectionRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	endpoint := srv.URL
	srv.Close() // guarantee nothing is listening

	client := NewAPIClient(endpoint, "test-token")
	_, err := client.GetInput("exec-1")
	if err == nil || !strings.Contains(err.Error(), "request failed") {
		t.Fatalf("expected transport error, got: %v", err)
	}
}
