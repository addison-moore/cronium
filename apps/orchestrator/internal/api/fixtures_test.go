package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The canonical wire shapes for the orchestrator-facing internal REST routes
// live in tests/fixtures/internal-api/*.json at the repo root. These tests
// MUST load those JSON files at runtime (never copy the shapes into Go
// literals) so the TS contract tests and the Go client fail together when the
// contract drifts. See tests/fixtures/internal-api/README.md.
const fixtureDir = "../../../../tests/fixtures/internal-api"

// Deterministic substitutions for the fixture sentinel placeholders
// (README.md "Sentinel convention"). `<id>` is resolved per JSON path so that
// distinct ids in one body stay distinguishable.
const (
	fixtureISODate = "2026-07-01T12:00:00Z"
	fixtureToken   = "cap.1.payload.sig"
	fixtureNumber  = float64(42)
)

var fixtureTime = time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)

type fixtureResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

type fixture struct {
	Route     string                     `json:"route"`
	Auth      string                     `json:"auth"`
	Responses map[string]fixtureResponse `json:"responses"`
}

// loadFixture reads one canonical fixture file from the repo-root fixture dir.
func loadFixture(t *testing.T, name string) fixture {
	t.Helper()

	data, err := os.ReadFile(filepath.Join(fixtureDir, name+".json"))
	require.NoError(t, err, "fixture %s must exist (canonical contract)", name)

	var fx fixture
	require.NoError(t, json.Unmarshal(data, &fx), "fixture %s must be valid JSON", name)
	require.NotEmpty(t, fx.Responses, "fixture %s must define responses", name)
	return fx
}

// idAtPath returns the deterministic value substituted for an `<id>` sentinel
// found at the given dot-joined JSON path.
func idAtPath(path string) string {
	return "id-" + path
}

// resolveSentinels structurally walks a decoded fixture body and replaces
// sentinel placeholder strings with concrete deterministic values, so an
// httptest handler can serve the canonical body and the test can assert the
// client decoded exactly those values.
func resolveSentinels(v interface{}, path string) interface{} {
	switch node := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(node))
		for k, child := range node {
			out[k] = resolveSentinels(child, joinPath(path, k))
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(node))
		for i, child := range node {
			out[i] = resolveSentinels(child, joinPath(path, fmt.Sprintf("%d", i)))
		}
		return out
	case string:
		switch node {
		case "<id>":
			return idAtPath(path)
		case "<iso-date>":
			return fixtureISODate
		case "<token>":
			return fixtureToken
		case "<number>":
			return fixtureNumber
		}
		return node
	default:
		return v
	}
}

func joinPath(base, segment string) string {
	if base == "" {
		return segment
	}
	return base + "." + segment
}

// resolvedBody returns the scenario's body with sentinels substituted, both as
// raw JSON (for serving) and as a decoded map (for building assertions).
func resolvedBody(t *testing.T, fx fixture, scenario string) ([]byte, map[string]interface{}) {
	t.Helper()

	resp, ok := fx.Responses[scenario]
	require.True(t, ok, "fixture %s must define scenario %q", fx.Route, scenario)

	var decoded interface{}
	require.NoError(t, json.Unmarshal(resp.Body, &decoded))
	resolved := resolveSentinels(decoded, "")

	raw, err := json.Marshal(resolved)
	require.NoError(t, err)

	asMap, ok := resolved.(map[string]interface{})
	require.True(t, ok, "fixture bodies are JSON objects")
	return raw, asMap
}

// capturedRequest is one request observed by the fixture server.
type capturedRequest struct {
	Method string
	Path   string
	Header http.Header
	Body   []byte
}

// jsonBody decodes the captured request body.
func (r capturedRequest) jsonBody(t *testing.T) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(r.Body, &m), "request body must be JSON")
	return m
}

// fixtureServer is an httptest server that records every request it sees.
type fixtureServer struct {
	*httptest.Server

	mu       sync.Mutex
	requests []capturedRequest
}

func newFixtureServer(t *testing.T, handler http.HandlerFunc) *fixtureServer {
	t.Helper()

	fs := &fixtureServer{}
	fs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)

		fs.mu.Lock()
		fs.requests = append(fs.requests, capturedRequest{
			Method: r.Method,
			Path:   r.URL.Path,
			Header: r.Header.Clone(),
			Body:   body,
		})
		fs.mu.Unlock()

		handler(w, r)
	}))
	t.Cleanup(fs.Close)
	return fs
}

func (fs *fixtureServer) captured() []capturedRequest {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	out := make([]capturedRequest, len(fs.requests))
	copy(out, fs.requests)
	return out
}

func (fs *fixtureServer) lastRequest(t *testing.T) capturedRequest {
	t.Helper()
	reqs := fs.captured()
	require.NotEmpty(t, reqs, "server must have received at least one request")
	return reqs[len(reqs)-1]
}

// serveScenario returns a handler that always answers with the fixture
// scenario's canonical status and sentinel-resolved body.
func serveScenario(t *testing.T, fx fixture, scenario string) http.HandlerFunc {
	t.Helper()

	raw, _ := resolvedBody(t, fx, scenario)
	status := fx.Responses[scenario].Status
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(raw)
	}
}
