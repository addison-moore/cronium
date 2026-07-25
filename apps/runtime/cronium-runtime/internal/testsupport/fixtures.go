// Package testsupport contains test-only helpers for the runtime service's Go
// tests. It is imported exclusively from _test.go files.
//
// LoadFixture serves the repo-wide internal-API contract fixtures
// (tests/fixtures/internal-api/*.json) so the Go tests consume the exact same
// pinned wire shapes as the app-side contract tests, per the fixture README:
// both sides must fail together when the contract drifts. FakeCache (see
// fakecache.go) is an in-memory service.Cache so the service can be exercised
// without a live Valkey.
package testsupport

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// FixtureResponse is one pinned response scenario from a contract fixture:
// the HTTP status plus the (sentinel-substituted) JSON body.
type FixtureResponse struct {
	Status int
	Body   map[string]interface{}
}

// Write serves the fixture response on w.
func (f FixtureResponse) Write(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.Status)
	_ = json.NewEncoder(w).Encode(f.Body)
}

// fixtureDir resolves tests/fixtures/internal-api at the repo root, anchored
// on this source file (test working directories vary per package).
func fixtureDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("testsupport: cannot locate own source file to find the repo root")
	}
	// file = <root>/apps/runtime/cronium-runtime/internal/testsupport/fixtures.go
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", ".."))
	return filepath.Join(root, "tests", "fixtures", "internal-api")
}

// LoadFixture loads responses.<scenario> from
// tests/fixtures/internal-api/<name> and substitutes the sentinel
// placeholders (<id>, <iso-date>, <token>, <number>) with concrete values.
//
// vals maps a JSON object key (e.g. "executionId") to the concrete value to
// use when that key's fixture value is a sentinel. Sentinels for unmapped
// keys get stable defaults. Non-sentinel fixture values are literals and are
// served exactly as pinned.
func LoadFixture(t *testing.T, name, scenario string, vals map[string]interface{}) FixtureResponse {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join(fixtureDir(t), name))
	if err != nil {
		t.Fatalf("testsupport: reading fixture %s: %v", name, err)
	}

	var doc struct {
		Route     string `json:"route"`
		Responses map[string]struct {
			Status int         `json:"status"`
			Body   interface{} `json:"body"`
		} `json:"responses"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("testsupport: parsing fixture %s: %v", name, err)
	}

	resp, ok := doc.Responses[scenario]
	if !ok {
		t.Fatalf("testsupport: fixture %s has no scenario %q", name, scenario)
	}

	body, ok := substitute(resp.Body, "", vals).(map[string]interface{})
	if !ok {
		t.Fatalf("testsupport: fixture %s scenario %q body is not a JSON object", name, scenario)
	}
	return FixtureResponse{Status: resp.Status, Body: body}
}

// substitute walks the fixture body; where a string node is a sentinel it is
// replaced by vals[key] (key = the enclosing object key) or a default.
func substitute(node interface{}, key string, vals map[string]interface{}) interface{} {
	switch v := node.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(v))
		for k, child := range v {
			out[k] = substitute(child, k, vals)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(v))
		for i, child := range v {
			out[i] = substitute(child, key, vals)
		}
		return out
	case string:
		switch v {
		case "<id>", "<iso-date>", "<token>", "<number>":
			if val, ok := vals[key]; ok {
				return val
			}
			switch v {
			case "<id>":
				return "fixture-" + key
			case "<iso-date>":
				return "2026-07-25T00:00:00.000Z"
			case "<token>":
				return "cap.1.fixture-payload.fixture-sig"
			default: // "<number>"
				return float64(0)
			}
		}
		return v
	default:
		return v
	}
}
