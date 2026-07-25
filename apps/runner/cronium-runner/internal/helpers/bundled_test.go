package helpers

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func newBundledClient(t *testing.T) (*BundledClient, string) {
	t.Helper()
	workDir := t.TempDir()
	return NewBundledClient(workDir, "exec-1"), workDir
}

// Regression test for the ReadJSON not-exist fix: a missing input.json means
// "no input data" and must yield (nil, nil). Before the fix this returned an
// error, because ReadJSON's rewrapped error defeated the os.IsNotExist check.
func TestBundledGetInputMissingFileReturnsNil(t *testing.T) {
	c, _ := newBundledClient(t)
	data, err := c.GetInput()
	if err != nil {
		t.Fatalf("expected nil error for missing input.json, got: %v", err)
	}
	if data != nil {
		t.Fatalf("expected nil data, got: %#v", data)
	}
}

func TestBundledGetInputRoundTrip(t *testing.T) {
	c, workDir := newBundledClient(t)
	if err := WriteJSON(filepath.Join(workDir, ".cronium", "input.json"), InputData{
		Data: map[string]interface{}{"name": "cronium", "count": float64(3)},
	}); err != nil {
		t.Fatalf("failed to seed input.json: %v", err)
	}

	data, err := c.GetInput()
	if err != nil {
		t.Fatalf("GetInput failed: %v", err)
	}
	want := map[string]interface{}{"name": "cronium", "count": float64(3)}
	if !reflect.DeepEqual(data, want) {
		t.Errorf("input = %#v, want %#v", data, want)
	}
}

func TestBundledGetInputMalformed(t *testing.T) {
	c, workDir := newBundledClient(t)
	dir := filepath.Join(workDir, ".cronium")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "input.json"), []byte("{bad"), 0o644); err != nil {
		t.Fatalf("failed to write input.json: %v", err)
	}
	if _, err := c.GetInput(); err == nil || !strings.Contains(err.Error(), "failed to read input") {
		t.Fatalf("expected read error, got: %v", err)
	}
}

func TestBundledSetOutputWritesOutputJSON(t *testing.T) {
	c, workDir := newBundledClient(t)
	if err := c.SetOutput(map[string]interface{}{"result": "ok"}); err != nil {
		t.Fatalf("SetOutput failed: %v", err)
	}

	var out OutputData
	if err := ReadJSON(filepath.Join(workDir, ".cronium", "output.json"), &out); err != nil {
		t.Fatalf("failed to read back output.json: %v", err)
	}
	want := map[string]interface{}{"result": "ok"}
	if !reflect.DeepEqual(out.Data, want) {
		t.Errorf("output = %#v, want %#v", out.Data, want)
	}
}

// Regression test for the ReadJSON not-exist fix: SetVariable on a fresh work
// dir (no variables.json yet) must create the file. Before the fix it always
// failed with "failed to read variables".
func TestBundledSetVariableCreatesFileThenGetVariable(t *testing.T) {
	c, _ := newBundledClient(t)

	if err := c.SetVariable("greeting", "hello"); err != nil {
		t.Fatalf("SetVariable on fresh work dir failed: %v", err)
	}
	if err := c.SetVariable("count", 42); err != nil {
		t.Fatalf("second SetVariable failed: %v", err)
	}

	got, err := c.GetVariable("greeting")
	if err != nil {
		t.Fatalf("GetVariable failed: %v", err)
	}
	if got != "hello" {
		t.Errorf("greeting = %#v, want hello", got)
	}

	// Numbers come back as float64 after the JSON round trip.
	got, err = c.GetVariable("count")
	if err != nil {
		t.Fatalf("GetVariable failed: %v", err)
	}
	if got != float64(42) {
		t.Errorf("count = %#v (%T), want float64 42", got, got)
	}
}

func TestBundledSetVariableOverwritesExisting(t *testing.T) {
	c, _ := newBundledClient(t)
	if err := c.SetVariable("k", "v1"); err != nil {
		t.Fatalf("SetVariable failed: %v", err)
	}
	if err := c.SetVariable("k", "v2"); err != nil {
		t.Fatalf("SetVariable overwrite failed: %v", err)
	}
	got, err := c.GetVariable("k")
	if err != nil {
		t.Fatalf("GetVariable failed: %v", err)
	}
	if got != "v2" {
		t.Errorf("k = %#v, want v2", got)
	}
}

func TestBundledGetVariableMissing(t *testing.T) {
	c, _ := newBundledClient(t)

	// No variables.json at all: reported as variable-not-found.
	if _, err := c.GetVariable("nope"); err == nil || !strings.Contains(err.Error(), "variable 'nope' not found") {
		t.Fatalf("expected not-found error without variables.json, got: %v", err)
	}

	// File exists but the key does not.
	if err := c.SetVariable("other", 1); err != nil {
		t.Fatalf("SetVariable failed: %v", err)
	}
	if _, err := c.GetVariable("nope"); err == nil || !strings.Contains(err.Error(), "variable 'nope' not found") {
		t.Fatalf("expected not-found error for absent key, got: %v", err)
	}
}

func TestBundledGetContextRoundTrip(t *testing.T) {
	c, workDir := newBundledClient(t)
	want := EventContext{
		EventID:     "ev-1",
		EventName:   "Demo Event",
		ExecutionID: "exec-1",
		JobID:       "job-1",
		Trigger:     "manual",
		StartTime:   "2026-01-02T03:04:05Z",
		Environment: map[string]string{"FOO": "bar"},
		Metadata:    map[string]interface{}{"k": "v"},
	}
	if err := WriteJSON(filepath.Join(workDir, ".cronium", "context.json"), want); err != nil {
		t.Fatalf("failed to seed context.json: %v", err)
	}

	got, err := c.GetContext()
	if err != nil {
		t.Fatalf("GetContext failed: %v", err)
	}
	if !reflect.DeepEqual(*got, want) {
		t.Errorf("context = %#v, want %#v", *got, want)
	}
}

func TestBundledGetContextMissing(t *testing.T) {
	c, _ := newBundledClient(t)
	if _, err := c.GetContext(); err == nil || !strings.Contains(err.Error(), "failed to read context") {
		t.Fatalf("expected error for missing context.json, got: %v", err)
	}
}
