package service_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/authctx"
	"github.com/addison-moore/cronium/apps/runtime/internal/cache"
	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/internal/service"
	"github.com/addison-moore/cronium/apps/runtime/internal/testsupport"
	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/sirupsen/logrus"
)

// The production Valkey client must satisfy the Cache seam the service is
// built against, and so must the in-memory fake the tests inject.
var (
	_ service.Cache = (*cache.ValkeyClient)(nil)
	_ service.Cache = (*testsupport.FakeCache)(nil)
)

const (
	testExecutionID = "exec-123"
	testUserID      = "user-42"
	testCapability  = "cap.1.payload.sig"
)

func quietLogger() *logrus.Logger {
	log := logrus.New()
	log.SetOutput(io.Discard)
	return log
}

func backendConfig(url string, retries int) config.BackendConfig {
	return config.BackendConfig{
		URL:        url,
		Timeout:    5 * time.Second,
		MaxRetries: retries,
		RetryDelay: time.Millisecond,
	}
}

// capCtx returns a context carrying the per-job capability token, as
// AuthMiddleware installs after JWT validation.
func capCtx() context.Context {
	return authctx.WithCapability(context.Background(), testCapability)
}

func TestBackendClient_SetsCapabilityAndJSONHeaders(t *testing.T) {
	success := testsupport.LoadFixture(t, "executions-output.json", "success", nil)

	var mu sync.Mutex
	var got http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = r.Header.Clone()
		mu.Unlock()
		success.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 0), quietLogger())
	if err := c.SaveOutput(capCtx(), testExecutionID, map[string]interface{}{"n": 1}); err != nil {
		t.Fatalf("SaveOutput: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if h := got.Get("X-Job-Capability"); h != testCapability {
		t.Errorf("X-Job-Capability = %q, want %q", h, testCapability)
	}
	if h := got.Get("Content-Type"); h != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", h)
	}
	// HI-10: no shared bearer when BackendConfig.Token is empty (the normal
	// deployment shape) — the capability token is the only credential.
	if h := got.Get("Authorization"); h != "" {
		t.Errorf("Authorization = %q, want empty when Token is unset", h)
	}
}

func TestBackendClient_LegacyBearerWhenTokenConfigured(t *testing.T) {
	success := testsupport.LoadFixture(t, "executions-output.json", "success", nil)

	var mu sync.Mutex
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		auth = r.Header.Get("Authorization")
		mu.Unlock()
		success.Write(w)
	}))
	defer srv.Close()

	cfg := backendConfig(srv.URL, 0)
	cfg.Token = "legacy-shared-token"
	c := service.NewBackendClient(cfg, quietLogger())
	if err := c.SaveOutput(context.Background(), testExecutionID, "x"); err != nil {
		t.Fatalf("SaveOutput: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if auth != "Bearer legacy-shared-token" {
		t.Errorf("Authorization = %q, want the legacy bearer", auth)
	}
}

// A retry must resend the COMPLETE request body. The body is a one-shot
// reader drained by attempt 1; doRequest rebuilds it via req.GetBody before
// each attempt (a prior fix — without it a retried SaveOutput would write
// {"output":null} over real data).
func TestBackendClient_RetryRebuildsRequestBody(t *testing.T) {
	success := testsupport.LoadFixture(t, "executions-output.json", "success", nil)
	serverError := testsupport.LoadFixture(t, "executions-output.json", "serverError", nil)

	var mu sync.Mutex
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(b))
		attempt := len(bodies)
		mu.Unlock()
		if attempt == 1 {
			serverError.Write(w)
			return
		}
		success.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 2), quietLogger())
	payload := map[string]interface{}{"blob": strings.Repeat("x", 4096)}
	if err := c.SaveOutput(capCtx(), testExecutionID, payload); err != nil {
		t.Fatalf("SaveOutput after retry: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatalf("attempts = %d, want 2", len(bodies))
	}
	if bodies[1] != bodies[0] {
		t.Fatalf("retry body differs from first attempt:\nfirst:  %d bytes\nsecond: %d bytes",
			len(bodies[0]), len(bodies[1]))
	}
	var sent struct {
		Output map[string]interface{} `json:"output"`
	}
	if err := json.Unmarshal([]byte(bodies[1]), &sent); err != nil {
		t.Fatalf("retried body is not complete JSON: %v", err)
	}
	if sent.Output["blob"] != payload["blob"] {
		t.Error("retried body lost the output payload")
	}
}

func TestBackendClient_ClientErrorsAreNotRetried(t *testing.T) {
	forbidden := testsupport.LoadFixture(t, "executions-output.json", "forbidden", nil)

	var mu sync.Mutex
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
		forbidden.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 3), quietLogger())
	err := c.SaveOutput(capCtx(), testExecutionID, "data")
	if err == nil {
		t.Fatal("expected an error for a 403 backend response")
	}
	// The pinned fixture error string surfaces in the script-facing error.
	if !strings.Contains(err.Error(), "backend error: Forbidden") {
		t.Errorf("error = %q, want it to carry the backend's pinned error string", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if hits != 1 {
		t.Errorf("hits = %d, want 1 (4xx must not be retried)", hits)
	}
}

func TestBackendClient_ServerErrorsExhaustRetries(t *testing.T) {
	serverError := testsupport.LoadFixture(t, "executions-output.json", "serverError", nil)

	var mu sync.Mutex
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
		serverError.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 2), quietLogger())
	err := c.SaveOutput(capCtx(), testExecutionID, "data")
	if err == nil {
		t.Fatal("expected an error when every attempt returns 500")
	}
	if !strings.Contains(err.Error(), "request failed after 3 attempts") {
		t.Errorf("error = %q, want the attempt-count wrapper", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if hits != 3 {
		t.Errorf("hits = %d, want 3 (initial + MaxRetries)", hits)
	}
}

func TestBackendClient_GetVariable_ParsesPinnedFixtureShape(t *testing.T) {
	getSuccess := testsupport.LoadFixture(t, "variables.json", "getSuccess", nil)

	var mu sync.Mutex
	var path, execHeader, capHeader string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		path = r.URL.Path
		execHeader = r.Header.Get("X-Execution-ID")
		capHeader = r.Header.Get("X-Job-Capability")
		mu.Unlock()
		getSuccess.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 0), quietLogger())
	v, err := c.GetVariable(capCtx(), testExecutionID, testUserID, "MY_KEY")
	if err != nil {
		t.Fatalf("GetVariable: %v", err)
	}

	mu.Lock()
	if want := "/api/internal/variables/" + testUserID + "/MY_KEY"; path != want {
		t.Errorf("path = %q, want the user-scoped %q", path, want)
	}
	if execHeader != testExecutionID {
		t.Errorf("X-Execution-ID = %q, want %q", execHeader, testExecutionID)
	}
	if capHeader != testCapability {
		t.Errorf("X-Job-Capability = %q, want %q", capHeader, testCapability)
	}
	mu.Unlock()

	if v.Key != "MY_KEY" {
		t.Errorf("Key = %q, want MY_KEY", v.Key)
	}
	if v.Value != "hello" {
		t.Errorf("Value = %v, want %q (fixture literal)", v.Value, "hello")
	}
	if v.UpdatedAt.IsZero() {
		t.Error("UpdatedAt not parsed from the fixture's <iso-date>")
	}
}

func TestBackendClient_GetExecutionContext_ParsesPinnedFixtureShape(t *testing.T) {
	success := testsupport.LoadFixture(t, "executions-context.json", "success", map[string]interface{}{
		"executionId": testExecutionID,
		"jobId":       "job-7",
		"userId":      testUserID,
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want := "/api/internal/executions/" + testExecutionID + "/context"; r.URL.Path != want {
			t.Errorf("path = %q, want %q", r.URL.Path, want)
		}
		success.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 0), quietLogger())
	ec, err := c.GetExecutionContext(capCtx(), testExecutionID)
	if err != nil {
		t.Fatalf("GetExecutionContext: %v", err)
	}

	if ec.ExecutionID != testExecutionID {
		t.Errorf("ExecutionID = %q, want %q", ec.ExecutionID, testExecutionID)
	}
	if ec.UserID != testUserID {
		t.Errorf("UserID = %q, want %q", ec.UserID, testUserID)
	}
	if ec.EventID != "42" {
		t.Errorf("EventID = %q, want the fixture literal \"42\"", ec.EventID)
	}
	input, ok := ec.Metadata["input"].(map[string]interface{})
	if !ok || input["a"] != float64(1) {
		t.Errorf("Metadata[input] = %#v, want the fixture literal {a:1}", ec.Metadata["input"])
	}
	// Contract drift, pinned deliberately: the app's context route (per the
	// fixture) carries the event's name/type only inside the nested "event"
	// object, which types.ExecutionContext does not model — so these fields
	// are always empty on the Go side. See the final report.
	if ec.EventName != "" || ec.EventType != "" {
		t.Errorf("EventName/EventType unexpectedly populated (%q/%q): the wire contract has no top-level fields for them",
			ec.EventName, ec.EventType)
	}
}

// The audit write is fire-and-forget on a DETACHED context: it must still
// reach the backend (with the capability header) after the caller's request
// context has been canceled, which happens the moment a handler returns.
func TestBackendClient_AuditLog_SurvivesCanceledCallerContext(t *testing.T) {
	success := testsupport.LoadFixture(t, "audit.json", "success", nil)

	type auditHit struct {
		capability string
		body       map[string]interface{}
	}
	hits := make(chan auditHit, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		_ = json.Unmarshal(b, &body)
		select {
		case hits <- auditHit{capability: r.Header.Get("X-Job-Capability"), body: body}:
		default:
		}
		success.Write(w)
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 0), quietLogger())

	ctx, cancel := context.WithCancel(capCtx())
	cancel() // the handler has already returned
	if err := c.AuditLog(ctx, testExecutionID, "set_output", map[string]interface{}{"k": "v"}); err != nil {
		t.Fatalf("AuditLog: %v", err)
	}

	select {
	case hit := <-hits:
		if hit.capability != testCapability {
			t.Errorf("audit X-Job-Capability = %q, want %q (must be captured before detaching)",
				hit.capability, testCapability)
		}
		if hit.body["executionId"] != testExecutionID || hit.body["action"] != "set_output" {
			t.Errorf("audit body = %#v, want executionId/action set", hit.body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("audit write never reached the backend after the caller context was canceled")
	}
}

// FINDINGS #1 documentation: the SDKs POST {tool, action, config} but the Go
// type's field is tagged json:"params", so an SDK payload decodes with
// Params == nil and the relay forwards "params": null. There is currently NO
// app route at /api/internal/tools/execute at all (the handler now 501s
// before relaying — see the handlers tests); this test pins the relay's wire
// shape for whoever revives the feature.
func TestBackendClient_ExecuteToolAction_SDKConfigFieldIsDropped(t *testing.T) {
	sdkPayload := []byte(`{"tool":"slack","action":"send_message","config":{"channel":"#general","text":"hi"}}`)
	var cfg types.ToolActionConfig
	if err := json.Unmarshal(sdkPayload, &cfg); err != nil {
		t.Fatalf("decoding SDK payload: %v", err)
	}
	if cfg.Params != nil {
		t.Fatalf("Params = %#v; expected nil — the SDK sends \"config\", the Go tag is \"params\"", cfg.Params)
	}

	var mu sync.Mutex
	var relayed map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want := "/api/internal/tools/execute"; r.URL.Path != want {
			t.Errorf("path = %q, want %q", r.URL.Path, want)
		}
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		_ = json.Unmarshal(b, &relayed)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"ok":true}}`))
	}))
	defer srv.Close()

	c := service.NewBackendClient(backendConfig(srv.URL, 0), quietLogger())
	res, err := c.ExecuteToolAction(capCtx(), testExecutionID, testUserID, cfg)
	if err != nil {
		t.Fatalf("ExecuteToolAction: %v", err)
	}
	if !res.Success {
		t.Error("Success = false, want true")
	}

	mu.Lock()
	defer mu.Unlock()
	if v, present := relayed["params"]; !present || v != nil {
		t.Errorf("relayed params = %#v, want present-and-null (SDK config discarded)", v)
	}
	if _, present := relayed["config"]; present {
		t.Error("relay unexpectedly forwarded a config field")
	}
	if relayed["tool"] != "slack" || relayed["action"] != "send_message" {
		t.Errorf("relayed tool/action = %v/%v", relayed["tool"], relayed["action"])
	}
	if relayed["executionId"] != testExecutionID || relayed["userId"] != testUserID {
		t.Errorf("relayed executionId/userId = %v/%v", relayed["executionId"], relayed["userId"])
	}
}
