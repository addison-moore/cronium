// Integration-style tests for the runtime's script-facing HTTP API: the full
// router (auth + revocation + rate-limit middleware and the handlers) is
// stood up with its real constructors and driven over real HTTP, relaying to
// a fake app backend that serves the pinned wire-contract fixtures from
// tests/fixtures/internal-api.
package handlers_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/api"
	"github.com/addison-moore/cronium/apps/runtime/internal/auth"
	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/internal/handlers"
	"github.com/addison-moore/cronium/apps/runtime/internal/service"
	"github.com/addison-moore/cronium/apps/runtime/internal/testsupport"
	"github.com/golang-jwt/jwt/v5"
	"github.com/sirupsen/logrus"
)

const (
	testSecret      = "test-jwt-secret"
	testExecutionID = "exec-123"
	testJobID       = "job-7"
	testUserID      = "user-42"
	testEventID     = "42"
	testCapability  = "cap.1.payload.sig"

	// maxOutputBytes mirrors the handler's cap (itself pinned to the app
	// route's 5242880-byte output limit in executions-output.json).
	maxOutputBytes = 5242880
)

func quietLogger() *logrus.Logger {
	log := logrus.New()
	log.SetOutput(io.Discard)
	return log
}

// fakeApp is the fake Next.js app backend. It serves fixture-derived bodies
// and records hits, request bodies, and the capability header per route.
type fakeApp struct {
	srv *httptest.Server

	mu           sync.Mutex
	hits         map[string]int
	bodies       map[string][]map[string]interface{}
	capabilities map[string]string

	failContext bool // serve the pinned 500 for the context route
}

func newFakeApp(t *testing.T) *fakeApp {
	t.Helper()
	a := &fakeApp{
		hits:         make(map[string]int),
		bodies:       make(map[string][]map[string]interface{}),
		capabilities: make(map[string]string),
	}

	contextOK := testsupport.LoadFixture(t, "executions-context.json", "success", map[string]interface{}{
		"executionId": testExecutionID,
		"jobId":       testJobID,
		"userId":      testUserID,
	})
	contextErr := testsupport.LoadFixture(t, "executions-context.json", "serverError", nil)
	outputOK := testsupport.LoadFixture(t, "executions-output.json", "success", nil)
	conditionOK := testsupport.LoadFixture(t, "executions-condition.json", "success", nil)
	varGetOK := testsupport.LoadFixture(t, "variables.json", "getSuccess", nil)
	varPutOK := testsupport.LoadFixture(t, "variables.json", "putSuccess", nil)
	auditOK := testsupport.LoadFixture(t, "audit.json", "success", nil)

	a.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path

		raw, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &body)
		}

		a.mu.Lock()
		a.hits[key]++
		if body != nil {
			a.bodies[key] = append(a.bodies[key], body)
		}
		a.capabilities[key] = r.Header.Get("X-Job-Capability")
		failContext := a.failContext
		a.mu.Unlock()

		path := r.URL.Path
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(path, "/context"):
			if failContext {
				contextErr.Write(w)
				return
			}
			contextOK.Write(w)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/output"):
			outputOK.Write(w)
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/condition"):
			conditionOK.Write(w)
		case r.Method == http.MethodGet && strings.HasPrefix(path, "/api/internal/variables/"):
			varGetOK.Write(w)
		case r.Method == http.MethodPut && strings.HasPrefix(path, "/api/internal/variables/"):
			varPutOK.Write(w)
		case r.Method == http.MethodPost && path == "/api/internal/audit":
			auditOK.Write(w)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"Not found"}`))
		}
	}))
	t.Cleanup(a.srv.Close)
	return a
}

func (a *fakeApp) hitCount(key string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.hits[key]
}

// nonAuditHits counts every recorded backend request except audit writes
// (which are asynchronous and timing-dependent).
func (a *fakeApp) nonAuditHits() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for key, c := range a.hits {
		if !strings.HasSuffix(key, "/api/internal/audit") {
			n += c
		}
	}
	return n
}

func (a *fakeApp) lastBody(key string) map[string]interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	bodies := a.bodies[key]
	if len(bodies) == 0 {
		return nil
	}
	return bodies[len(bodies)-1]
}

func (a *fakeApp) capability(key string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.capabilities[key]
}

// env is one full runtime-service instance under test.
type env struct {
	ts    *httptest.Server
	app   *fakeApp
	cache *testsupport.FakeCache
}

func newEnv(t *testing.T) *env {
	t.Helper()
	app := newFakeApp(t)
	fake := testsupport.NewFakeCache()

	cfg := &config.Config{}
	cfg.Auth.JWTSecret = testSecret
	cfg.Auth.TokenExpiration = time.Hour
	cfg.Security.EnableCORS = false
	cfg.Security.RateLimitPerMin = 100000
	cfg.Backend = config.BackendConfig{
		URL:        app.srv.URL,
		Timeout:    5 * time.Second,
		MaxRetries: 0,
		RetryDelay: time.Millisecond,
	}

	backend := service.NewBackendClient(cfg.Backend, quietLogger())
	svc := service.NewRuntimeService(backend, fake, cfg, quietLogger())
	router := api.NewRouter(svc, cfg, quietLogger())

	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)
	return &env{ts: ts, app: app, cache: fake}
}

// token mints an execution JWT the way the orchestrator does, signed with the
// runtime's secret. Mutators adjust individual claims.
func token(t *testing.T, mutators ...func(*auth.Claims)) string {
	t.Helper()
	now := time.Now()
	claims := &auth.Claims{
		JobID:       testJobID,
		ExecutionID: testExecutionID,
		UserID:      testUserID,
		EventID:     testEventID,
		Capability:  testCapability,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Subject:   testExecutionID,
		},
	}
	for _, m := range mutators {
		m(claims)
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

// call performs a request against the runtime under test and decodes the
// JSON response body.
func (e *env) call(t *testing.T, method, path, authHeader string, body []byte) (int, map[string]interface{}) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, e.ts.URL+path, rdr)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var parsed map[string]interface{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &parsed); err != nil {
			t.Fatalf("%s %s: response is not JSON (%q): %v", method, path, raw, err)
		}
	}
	return resp.StatusCode, parsed
}

func bearer(tok string) string { return "Bearer " + tok }

// --- Auth guards ---------------------------------------------------------

func TestHealth_RequiresNoAuth(t *testing.T) {
	e := newEnv(t)
	status, body := e.call(t, http.MethodGet, "/health", "", nil)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["status"] != "healthy" {
		t.Errorf("body = %#v, want status healthy", body)
	}
}

// Malformed or absent credentials are a uniform 401 — never a panic/500 and
// never a request that reaches the backend.
func TestAuth_MalformedOrAbsentToken401(t *testing.T) {
	e := newEnv(t)
	inputPath := "/executions/" + testExecutionID + "/input"

	cases := []struct {
		name   string
		header string
	}{
		{"absent", ""},
		{"not bearer", "Basic dXNlcjpwYXNz"},
		{"bearer with empty token", "Bearer"},
		{"garbage token", bearer("not-a-jwt")},
		{"wrong secret", bearer(wrongSecretToken(t))},
		{"expired", bearer(token(t, func(c *auth.Claims) {
			c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
			c.IssuedAt = jwt.NewNumericDate(time.Now().Add(-2 * time.Hour))
			c.NotBefore = jwt.NewNumericDate(time.Now().Add(-2 * time.Hour))
		}))},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, body := e.call(t, http.MethodGet, inputPath, tc.header, nil)
			if status != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401 (and never a 500/panic)", status)
			}
			if body["error"] == nil {
				t.Errorf("body = %#v, want a JSON error", body)
			}
		})
	}

	if got := e.app.nonAuditHits(); got != 0 {
		t.Errorf("backend hits from rejected requests = %d, want 0", got)
	}
}

func wrongSecretToken(t *testing.T) string {
	t.Helper()
	now := time.Now()
	claims := &auth.Claims{
		JobID:       testJobID,
		ExecutionID: testExecutionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("some-other-secret"))
	if err != nil {
		t.Fatalf("signing token: %v", err)
	}
	return signed
}

// The revocation gate fails closed on tokens without a jobId claim.
func TestAuth_TokenWithoutJobID401(t *testing.T) {
	e := newEnv(t)
	tok := token(t, func(c *auth.Claims) { c.JobID = "" })
	status, _ := e.call(t, http.MethodGet, "/executions/"+testExecutionID+"/input", bearer(tok), nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (revocation gate fails closed without jobId)", status)
	}
}

// HI-14 wiring end-to-end: a valid token whose job the app marked terminal is
// rejected by the revocation middleware before any handler runs.
func TestAuth_RevokedJob403(t *testing.T) {
	e := newEnv(t)
	e.cache.RevokedJobs[testJobID] = true

	status, body := e.call(t, http.MethodGet, "/executions/"+testExecutionID+"/input", bearer(token(t)), nil)
	if status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", status)
	}
	if msg, _ := body["error"].(string); !strings.Contains(msg, "execution token revoked") {
		t.Errorf("body = %#v, want the revocation message", body)
	}
	if got := e.app.nonAuditHits(); got != 0 {
		t.Errorf("backend hits for a revoked job = %d, want 0", got)
	}
}

func TestAuth_RevocationStoreOutage503(t *testing.T) {
	e := newEnv(t)
	e.cache.RevokedErr = io.ErrUnexpectedEOF

	status, _ := e.call(t, http.MethodGet, "/executions/"+testExecutionID+"/input", bearer(token(t)), nil)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (fail closed on store outage)", status)
	}
}

// A valid token only opens ITS OWN execution: every execution-scoped endpoint
// rejects a path targeting a different execution ID.
func TestAuth_ExecutionIDMismatch403(t *testing.T) {
	e := newEnv(t)
	tok := bearer(token(t)) // token is for exec-123
	other := "/executions/exec-other"

	cases := []struct {
		method, path string
		body         []byte
	}{
		{http.MethodGet, other + "/input", nil},
		{http.MethodPost, other + "/output", []byte(`{"data":1}`)},
		{http.MethodGet, other + "/context", nil},
		{http.MethodPost, other + "/condition", []byte(`{"condition":true}`)},
		{http.MethodGet, other + "/variables/MY_KEY", nil},
		{http.MethodPut, other + "/variables/MY_KEY", []byte(`{"value":1}`)},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			status, body := e.call(t, tc.method, tc.path, tok, tc.body)
			if status != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", status)
			}
			if body["message"] != "execution ID mismatch" {
				t.Errorf("body = %#v, want the mismatch message", body)
			}
		})
	}
	if got := e.app.nonAuditHits(); got != 0 {
		t.Errorf("backend hits from mismatched requests = %d, want 0", got)
	}
}

// --- Round-trips ----------------------------------------------------------

func TestGetInput_RoundTripAndContextCaching(t *testing.T) {
	e := newEnv(t)
	tok := bearer(token(t))
	path := "/executions/" + testExecutionID + "/input"
	contextKey := "GET /api/internal/executions/" + testExecutionID + "/context"

	status, body := e.call(t, http.MethodGet, path, tok, nil)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["success"] != true {
		t.Errorf("body = %#v, want success true", body)
	}
	data, _ := body["data"].(map[string]interface{})
	if data["a"] != float64(1) {
		t.Errorf("data = %#v, want the fixture's metadata.input {a:1}", body["data"])
	}
	if got := e.app.hitCount(contextKey); got != 1 {
		t.Fatalf("backend context fetches = %d, want 1", got)
	}
	if got := e.app.capability(contextKey); got != testCapability {
		t.Errorf("context request X-Job-Capability = %q, want the token's capability %q", got, testCapability)
	}

	// Second read: served from the runtime cache, no new backend fetch.
	status, body = e.call(t, http.MethodGet, path, tok, nil)
	if status != http.StatusOK {
		t.Fatalf("second read status = %d, want 200", status)
	}
	if data, _ := body["data"].(map[string]interface{}); data["a"] != float64(1) {
		t.Errorf("cached data = %#v, want {a:1}", body["data"])
	}
	if got := e.app.hitCount(contextKey); got != 1 {
		t.Errorf("backend context fetches after cached read = %d, want 1", got)
	}
}

func TestGetContext_RoundTripAndCaching(t *testing.T) {
	e := newEnv(t)
	tok := bearer(token(t))
	path := "/executions/" + testExecutionID + "/context"
	contextKey := "GET /api/internal/executions/" + testExecutionID + "/context"

	status, body := e.call(t, http.MethodGet, path, tok, nil)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	data, _ := body["data"].(map[string]interface{})
	if data["executionId"] != testExecutionID || data["userId"] != testUserID {
		t.Errorf("data = %#v, want the fixture context's executionId/userId", data)
	}

	if _, _ = e.call(t, http.MethodGet, path, tok, nil); e.app.hitCount(contextKey) != 1 {
		t.Errorf("backend context fetches across two reads = %d, want 1", e.app.hitCount(contextKey))
	}
}

func TestSetOutput_RoundTrip(t *testing.T) {
	e := newEnv(t)
	tok := bearer(token(t))
	outKey := "POST /api/internal/executions/" + testExecutionID + "/output"

	status, body := e.call(t, http.MethodPost, "/executions/"+testExecutionID+"/output", tok,
		[]byte(`{"data":{"result":"ok","n":3}}`))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["success"] != true {
		t.Errorf("body = %#v, want success true", body)
	}

	if got := e.app.hitCount(outKey); got != 1 {
		t.Fatalf("backend output relays = %d, want 1", got)
	}
	relayed := e.app.lastBody(outKey)
	out, _ := relayed["output"].(map[string]interface{})
	if out["result"] != "ok" || out["n"] != float64(3) {
		t.Errorf("relayed output = %#v, want the script's data", relayed["output"])
	}
	if got := e.app.capability(outKey); got != testCapability {
		t.Errorf("output relay X-Job-Capability = %q, want %q", got, testCapability)
	}
}

func TestSetCondition_RoundTrip(t *testing.T) {
	e := newEnv(t)
	condKey := "POST /api/internal/executions/" + testExecutionID + "/condition"

	status, body := e.call(t, http.MethodPost, "/executions/"+testExecutionID+"/condition",
		bearer(token(t)), []byte(`{"condition":true}`))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["success"] != true {
		t.Errorf("body = %#v, want success true", body)
	}
	if got := e.app.lastBody(condKey); got["condition"] != true {
		t.Errorf("relayed condition body = %#v, want condition true", got)
	}
}

func TestVariables_RoundTripOwnerScopedAndCached(t *testing.T) {
	e := newEnv(t)
	tok := bearer(token(t))
	base := "/executions/" + testExecutionID + "/variables/MY_KEY"
	getKey := "GET /api/internal/variables/" + testUserID + "/MY_KEY"
	putKey := "PUT /api/internal/variables/" + testUserID + "/MY_KEY"

	// GET: relayed to the backend on the USER-scoped path with the capability.
	status, body := e.call(t, http.MethodGet, base, tok, nil)
	if status != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", status)
	}
	data, _ := body["data"].(map[string]interface{})
	if data["key"] != "MY_KEY" || data["value"] != "hello" {
		t.Errorf("data = %#v, want the fixture variable", data)
	}
	if got := e.app.hitCount(getKey); got != 1 {
		t.Fatalf("user-scoped backend GETs = %d, want 1 — owner scoping must come from the token", got)
	}
	if got := e.app.capability(getKey); got != testCapability {
		t.Errorf("variable GET X-Job-Capability = %q, want %q", got, testCapability)
	}

	// PUT: relayed user-scoped, refreshes the cache.
	status, body = e.call(t, http.MethodPut, base, tok, []byte(`{"value":"world"}`))
	if status != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200", status)
	}
	if body["success"] != true {
		t.Errorf("PUT body = %#v, want success true", body)
	}
	if got := e.app.hitCount(putKey); got != 1 {
		t.Fatalf("user-scoped backend PUTs = %d, want 1", got)
	}
	if relayed := e.app.lastBody(putKey); relayed["value"] != "world" {
		t.Errorf("relayed PUT body = %#v, want value world", relayed)
	}

	// Read-after-write: served from the refreshed cache, not the backend.
	status, body = e.call(t, http.MethodGet, base, tok, nil)
	if status != http.StatusOK {
		t.Fatalf("GET-after-PUT status = %d, want 200", status)
	}
	if data, _ := body["data"].(map[string]interface{}); data["value"] != "world" {
		t.Errorf("data after PUT = %#v, want the written value", body["data"])
	}
	if got := e.app.hitCount(getKey); got != 1 {
		t.Errorf("backend GETs after write = %d, want 1 (read served from cache)", got)
	}
}

// Backend failures surface as a clean script-facing 500, not a panic or a
// leaked backend body.
func TestBackendOutage_MapsTo500(t *testing.T) {
	e := newEnv(t)
	e.app.failContext = true

	status, body := e.call(t, http.MethodGet, "/executions/"+testExecutionID+"/input", bearer(token(t)), nil)
	if status != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", status)
	}
	if body["message"] != "failed to get input" {
		t.Errorf("body = %#v, want the generic script-facing message", body)
	}
}

// --- Limits ---------------------------------------------------------------

// outputBody builds a syntactically valid /output request body of exactly n
// bytes: {"data":"aab...b"}.
func outputBody(t *testing.T, n int) []byte {
	t.Helper()
	const overhead = len(`{"data":""}`)
	if n < overhead {
		t.Fatalf("cannot build a %d-byte output body", n)
	}
	var b bytes.Buffer
	b.WriteString(`{"data":"`)
	b.WriteString(strings.Repeat("a", n-overhead))
	b.WriteString(`"}`)
	if b.Len() != n {
		t.Fatalf("built %d bytes, want %d", b.Len(), n)
	}
	return b.Bytes()
}

func TestSetOutput_BodyAtLimitAccepted(t *testing.T) {
	e := newEnv(t)
	status, body := e.call(t, http.MethodPost, "/executions/"+testExecutionID+"/output",
		bearer(token(t)), outputBody(t, maxOutputBytes))
	if status != http.StatusOK {
		t.Fatalf("status for a body of exactly %d bytes = %d, want 200", maxOutputBytes, status)
	}
	if body["success"] != true {
		t.Errorf("body = %#v, want success true", body)
	}
}

func TestSetOutput_BodyOverLimit413(t *testing.T) {
	e := newEnv(t)
	status, body := e.call(t, http.MethodPost, "/executions/"+testExecutionID+"/output",
		bearer(token(t)), outputBody(t, maxOutputBytes+1))
	if status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status for %d bytes = %d, want 413", maxOutputBytes+1, status)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, "5242880-byte limit") {
		t.Errorf("body = %#v, want the byte-limit message", body)
	}
	// The oversized body must be rejected before ANY backend traffic.
	if got := e.app.nonAuditHits(); got != 0 {
		t.Errorf("backend hits for an over-limit output = %d, want 0", got)
	}
}

// --- Tool actions (FINDINGS #1: no app route exists) -----------------------

// POST /tool-actions/execute must fail loudly: there is no app route behind
// the relay (/api/internal/tools/execute does not exist), so the runtime
// answers 501 with an honest message instead of relaying into a 404.
func TestToolActions_NotImplemented501(t *testing.T) {
	e := newEnv(t)
	status, body := e.call(t, http.MethodPost, "/tool-actions/execute", bearer(token(t)),
		[]byte(`{"tool":"slack","action":"send_message","config":{"channel":"#general","text":"hi"}}`))
	if status != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", status)
	}
	if body["message"] != "tool actions are not available from scripts in this execution context" {
		t.Errorf("body = %#v, want the explicit not-available message", body)
	}
	if got := e.app.nonAuditHits(); got != 0 {
		t.Errorf("backend hits for a tool action = %d, want 0 (nothing to relay to)", got)
	}
}

func TestToolActions_Unauthenticated401(t *testing.T) {
	e := newEnv(t)
	status, _ := e.call(t, http.MethodPost, "/tool-actions/execute", "", []byte(`{"tool":"slack"}`))
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", status)
	}
}

// --- Handler-level guard (defense in depth) --------------------------------

// Even when invoked without the middleware chain (no claims in context), every
// handler answers 401 rather than panicking — pinning the prior nil-claims
// fix at the handler layer itself.
func TestHandlersWithoutClaims_401NotPanic(t *testing.T) {
	app := newFakeApp(t)
	cfg := &config.Config{}
	cfg.Backend = config.BackendConfig{URL: app.srv.URL, Timeout: time.Second, RetryDelay: time.Millisecond}
	backend := service.NewBackendClient(cfg.Backend, quietLogger())
	svc := service.NewRuntimeService(backend, testsupport.NewFakeCache(), cfg, quietLogger())
	h := handlers.NewHandler(svc, quietLogger())

	cases := []struct {
		name    string
		invoke  func(w http.ResponseWriter, r *http.Request)
		method  string
		target  string
		payload string
	}{
		{"GetInput", h.GetInput, http.MethodGet, "/executions/x/input", ""},
		{"SetOutput", h.SetOutput, http.MethodPost, "/executions/x/output", `{"data":1}`},
		{"GetVariable", h.GetVariable, http.MethodGet, "/executions/x/variables/k", ""},
		{"SetVariable", h.SetVariable, http.MethodPut, "/executions/x/variables/k", `{"value":1}`},
		{"SetCondition", h.SetCondition, http.MethodPost, "/executions/x/condition", `{"condition":true}`},
		{"GetContext", h.GetContext, http.MethodGet, "/executions/x/context", ""},
		{"ExecuteToolAction", h.ExecuteToolAction, http.MethodPost, "/tool-actions/execute", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body io.Reader
			if tc.payload != "" {
				body = strings.NewReader(tc.payload)
			}
			req := httptest.NewRequest(tc.method, tc.target, body)
			rr := httptest.NewRecorder()
			tc.invoke(rr, req) // must not panic
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", rr.Code)
			}
		})
	}
}
