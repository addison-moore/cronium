package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/internal/service"
	"github.com/addison-moore/cronium/apps/runtime/internal/testsupport"
)

// appStub is a fake Next.js app backend serving fixture-derived bodies for
// the internal routes the runtime relays to, counting hits per METHOD+path.
type appStub struct {
	t   *testing.T
	srv *httptest.Server

	mu     sync.Mutex
	hits   map[string]int
	bodies map[string][]map[string]interface{}
}

func newAppStub(t *testing.T) *appStub {
	t.Helper()
	s := &appStub{
		t:      t,
		hits:   make(map[string]int),
		bodies: make(map[string][]map[string]interface{}),
	}

	contextResp := testsupport.LoadFixture(t, "executions-context.json", "success", map[string]interface{}{
		"executionId": testExecutionID,
		"jobId":       "job-7",
		"userId":      testUserID,
	})
	outputResp := testsupport.LoadFixture(t, "executions-output.json", "success", nil)
	conditionResp := testsupport.LoadFixture(t, "executions-condition.json", "success", nil)
	varGetResp := testsupport.LoadFixture(t, "variables.json", "getSuccess", nil)
	varPutResp := testsupport.LoadFixture(t, "variables.json", "putSuccess", nil)
	auditResp := testsupport.LoadFixture(t, "audit.json", "success", nil)

	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path

		raw, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &body)
		}

		s.mu.Lock()
		s.hits[key]++
		if body != nil {
			s.bodies[key] = append(s.bodies[key], body)
		}
		s.mu.Unlock()

		path := r.URL.Path
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(path, "/context"):
			contextResp.Write(w)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/output"):
			outputResp.Write(w)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/condition"):
			conditionResp.Write(w)
		case r.Method == http.MethodGet && strings.HasPrefix(path, "/api/internal/variables/"):
			varGetResp.Write(w)
		case r.Method == http.MethodPut && strings.HasPrefix(path, "/api/internal/variables/"):
			varPutResp.Write(w)
		case r.Method == http.MethodPost && path == "/api/internal/audit":
			auditResp.Write(w)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"Not found"}`))
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *appStub) hitCount(key string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits[key]
}

func (s *appStub) lastBody(key string) map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	bodies := s.bodies[key]
	if len(bodies) == 0 {
		return nil
	}
	return bodies[len(bodies)-1]
}

func newServiceUnderTest(t *testing.T, stub *appStub) (*service.RuntimeService, *testsupport.FakeCache) {
	t.Helper()
	fake := testsupport.NewFakeCache()
	backend := service.NewBackendClient(backendConfig(stub.srv.URL, 0), quietLogger())
	svc := service.NewRuntimeService(backend, fake, &config.Config{}, quietLogger())
	return svc, fake
}

func contextKey() string {
	return "GET /api/internal/executions/" + testExecutionID + "/context"
}

func TestRuntimeService_GetInput_ServedFromCacheAfterFirstFetch(t *testing.T) {
	stub := newAppStub(t)
	svc, _ := newServiceUnderTest(t, stub)
	ctx := capCtx()

	first, err := svc.GetInput(ctx, testExecutionID)
	if err != nil {
		t.Fatalf("GetInput: %v", err)
	}
	input, ok := first.(map[string]interface{})
	if !ok || input["a"] != float64(1) {
		t.Fatalf("input = %#v, want the fixture's metadata.input {a:1}", first)
	}
	if got := stub.hitCount(contextKey()); got != 1 {
		t.Fatalf("context fetches after first GetInput = %d, want 1", got)
	}

	second, err := svc.GetInput(ctx, testExecutionID)
	if err != nil {
		t.Fatalf("second GetInput: %v", err)
	}
	if got := stub.hitCount(contextKey()); got != 1 {
		t.Errorf("context fetches after second GetInput = %d, want 1 (input must be cache-served)", got)
	}
	if in2, ok := second.(map[string]interface{}); !ok || in2["a"] != float64(1) {
		t.Errorf("cached input = %#v, want {a:1}", second)
	}
}

func TestRuntimeService_SetOutput_RelaysAndCaches(t *testing.T) {
	stub := newAppStub(t)
	svc, fake := newServiceUnderTest(t, stub)

	data := map[string]interface{}{"result": "ok", "n": float64(3)}
	if err := svc.SetOutput(capCtx(), testExecutionID, data); err != nil {
		t.Fatalf("SetOutput: %v", err)
	}

	outKey := "POST /api/internal/executions/" + testExecutionID + "/output"
	if got := stub.hitCount(outKey); got != 1 {
		t.Fatalf("output relays = %d, want 1", got)
	}
	body := stub.lastBody(outKey)
	relayed, ok := body["output"].(map[string]interface{})
	if !ok || relayed["result"] != "ok" || relayed["n"] != float64(3) {
		t.Errorf("relayed output = %#v, want the script's data under \"output\"", body["output"])
	}
	if _, ok := body["timestamp"]; !ok {
		t.Error("relayed body missing timestamp")
	}

	cached := fake.Output(testExecutionID)
	if cached == nil {
		t.Fatal("output not written to the cache")
	}
	if got, ok := cached.Data.(map[string]interface{}); !ok || got["result"] != "ok" {
		t.Errorf("cached output = %#v, want the script's data", cached.Data)
	}
}

func TestRuntimeService_GetVariable_BackendThenCache(t *testing.T) {
	stub := newAppStub(t)
	svc, _ := newServiceUnderTest(t, stub)
	ctx := capCtx()

	varKey := "GET /api/internal/variables/" + testUserID + "/MY_KEY"

	v, err := svc.GetVariable(ctx, testExecutionID, "MY_KEY")
	if err != nil {
		t.Fatalf("GetVariable: %v", err)
	}
	if v != "hello" {
		t.Fatalf("value = %#v, want the fixture literal %q", v, "hello")
	}
	if got := stub.hitCount(varKey); got != 1 {
		t.Fatalf("backend variable GETs = %d, want 1 (and the path must be user-scoped)", got)
	}

	v2, err := svc.GetVariable(ctx, testExecutionID, "MY_KEY")
	if err != nil {
		t.Fatalf("second GetVariable: %v", err)
	}
	if v2 != "hello" {
		t.Errorf("cached value = %#v, want %q", v2, "hello")
	}
	if got := stub.hitCount(varKey); got != 1 {
		t.Errorf("backend variable GETs after cached read = %d, want 1", got)
	}
}

func TestRuntimeService_SetVariable_RelaysUserScopedAndCaches(t *testing.T) {
	stub := newAppStub(t)
	svc, _ := newServiceUnderTest(t, stub)
	ctx := capCtx()

	if err := svc.SetVariable(ctx, testExecutionID, "MY_KEY", "world"); err != nil {
		t.Fatalf("SetVariable: %v", err)
	}

	putKey := "PUT /api/internal/variables/" + testUserID + "/MY_KEY"
	if got := stub.hitCount(putKey); got != 1 {
		t.Fatalf("backend variable PUTs = %d, want 1 on the user-scoped path", got)
	}
	if body := stub.lastBody(putKey); body["value"] != "world" {
		t.Errorf("relayed value = %#v, want %q", body["value"], "world")
	}

	// A read after a write is served from the cache the write refreshed.
	v, err := svc.GetVariable(ctx, testExecutionID, "MY_KEY")
	if err != nil {
		t.Fatalf("GetVariable after set: %v", err)
	}
	if v != "world" {
		t.Errorf("value after set = %#v, want %q", v, "world")
	}
	if got := stub.hitCount("GET /api/internal/variables/" + testUserID + "/MY_KEY"); got != 0 {
		t.Errorf("backend variable GETs = %d, want 0 (write refreshes the cache)", got)
	}
}

func TestRuntimeService_SetVariable_LockContention(t *testing.T) {
	stub := newAppStub(t)
	svc, fake := newServiceUnderTest(t, stub)
	fake.LockDenied = true

	err := svc.SetVariable(capCtx(), testExecutionID, "MY_KEY", "x")
	if err == nil {
		t.Fatal("expected an error when the variable lock is held elsewhere")
	}
	if !strings.Contains(err.Error(), "locked by another process") {
		t.Errorf("error = %q, want the lock-contention message", err)
	}
	if got := stub.hitCount("PUT /api/internal/variables/" + testUserID + "/MY_KEY"); got != 0 {
		t.Errorf("backend PUTs under contention = %d, want 0", got)
	}
}

func TestRuntimeService_SetCondition_Relays(t *testing.T) {
	stub := newAppStub(t)
	svc, _ := newServiceUnderTest(t, stub)

	if err := svc.SetCondition(capCtx(), testExecutionID, true); err != nil {
		t.Fatalf("SetCondition: %v", err)
	}
	condKey := "POST /api/internal/executions/" + testExecutionID + "/condition"
	if got := stub.hitCount(condKey); got != 1 {
		t.Fatalf("condition relays = %d, want 1", got)
	}
	if body := stub.lastBody(condKey); body["condition"] != true {
		t.Errorf("relayed condition = %#v, want true", body["condition"])
	}
}

// Cache reads failing (Valkey down mid-flight) must degrade to the backend,
// never to a script-facing error.
func TestRuntimeService_CacheReadErrors_FallThroughToBackend(t *testing.T) {
	stub := newAppStub(t)
	svc, fake := newServiceUnderTest(t, stub)
	fake.GetErr = errors.New("valkey down")

	input, err := svc.GetInput(capCtx(), testExecutionID)
	if err != nil {
		t.Fatalf("GetInput with broken cache reads: %v", err)
	}
	if in, ok := input.(map[string]interface{}); !ok || in["a"] != float64(1) {
		t.Errorf("input = %#v, want {a:1} via the backend", input)
	}

	v, err := svc.GetVariable(capCtx(), testExecutionID, "MY_KEY")
	if err != nil {
		t.Fatalf("GetVariable with broken cache reads: %v", err)
	}
	if v != "hello" {
		t.Errorf("value = %#v, want %q via the backend", v, "hello")
	}
}

// Pin the context-cache invalidation policy: there is NONE on the write path.
// A cached execution context is reused by every subsequent call (input,
// output, condition, variables) and only expires by TTL in the production
// Valkey. Writes do not invalidate it.
func TestRuntimeService_ContextCache_NotInvalidatedByWrites(t *testing.T) {
	stub := newAppStub(t)
	svc, _ := newServiceUnderTest(t, stub)
	ctx := capCtx()

	if _, err := svc.GetEventContext(ctx, testExecutionID); err != nil {
		t.Fatalf("GetEventContext: %v", err)
	}
	if err := svc.SetOutput(ctx, testExecutionID, "data"); err != nil {
		t.Fatalf("SetOutput: %v", err)
	}
	if err := svc.SetCondition(ctx, testExecutionID, false); err != nil {
		t.Fatalf("SetCondition: %v", err)
	}
	if _, err := svc.GetEventContext(ctx, testExecutionID); err != nil {
		t.Fatalf("GetEventContext after writes: %v", err)
	}

	if got := stub.hitCount(contextKey()); got != 1 {
		t.Errorf("context fetches across 4 calls = %d, want exactly 1 (cache, no invalidation)", got)
	}
}

// Regression (FINDINGS #36): the event name/type from the app's nested
// "event" object must reach GetEventContext's flat fields — this is what the
// SDKs' cronium.event() ultimately returns.
func TestRuntimeService_GetEventContext_FlattensNestedEvent(t *testing.T) {
	stub := newAppStub(t)
	svc, _ := newServiceUnderTest(t, stub)

	ec, err := svc.GetEventContext(capCtx(), testExecutionID)
	if err != nil {
		t.Fatalf("GetEventContext: %v", err)
	}
	if ec.EventName != "Demo Event" {
		t.Errorf("EventName = %q, want the fixture literal \"Demo Event\"", ec.EventName)
	}
	if ec.EventType != "BASH" {
		t.Errorf("EventType = %q, want the fixture literal \"BASH\"", ec.EventType)
	}
	if ec.EventID != "42" {
		t.Errorf("EventID = %q, want the fixture literal \"42\"", ec.EventID)
	}

	// The flattened fields survive the cache round-trip too.
	ec2, err := svc.GetEventContext(capCtx(), testExecutionID)
	if err != nil {
		t.Fatalf("GetEventContext (cached): %v", err)
	}
	if got := stub.hitCount(contextKey()); got != 1 {
		t.Fatalf("context fetches = %d, want 1 (second read must be cache-served)", got)
	}
	if ec2.EventName != "Demo Event" || ec2.EventType != "BASH" {
		t.Errorf("cached context event fields = %q/%q, want Demo Event/BASH", ec2.EventName, ec2.EventType)
	}
}

func TestRuntimeService_IsJobRevoked_PassesThrough(t *testing.T) {
	stub := newAppStub(t)
	svc, fake := newServiceUnderTest(t, stub)

	revoked, err := svc.IsJobRevoked(context.Background(), "job-7")
	if err != nil || revoked {
		t.Fatalf("IsJobRevoked = %v, %v; want false, nil", revoked, err)
	}

	fake.RevokedJobs["job-7"] = true
	revoked, err = svc.IsJobRevoked(context.Background(), "job-7")
	if err != nil || !revoked {
		t.Fatalf("IsJobRevoked after revocation = %v, %v; want true, nil", revoked, err)
	}
}
