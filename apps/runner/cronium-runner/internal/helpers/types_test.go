package helpers

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestWriteJSONReadJSONRoundTrip(t *testing.T) {
	// Path with a nested, not-yet-existing directory: WriteJSON must create it.
	path := filepath.Join(t.TempDir(), "nested", "deeper", "data.json")

	in := map[string]interface{}{
		"str":  "value",
		"num":  float64(42),
		"list": []interface{}{"a", float64(1)},
		"obj":  map[string]interface{}{"k": true},
	}
	if err := WriteJSON(path, in); err != nil {
		t.Fatalf("WriteJSON failed: %v", err)
	}

	var out map[string]interface{}
	if err := ReadJSON(path, &out); err != nil {
		t.Fatalf("ReadJSON failed: %v", err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Errorf("round trip mismatch: wrote %#v, read %#v", in, out)
	}
}

func TestWriteJSONMarshalError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	err := WriteJSON(path, make(chan int))
	if err == nil || !strings.Contains(err.Error(), "failed to marshal data") {
		t.Fatalf("expected marshal error, got: %v", err)
	}
}

func TestWriteJSONDirCreationError(t *testing.T) {
	// A regular file where a directory is needed makes MkdirAll fail.
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatalf("failed to write blocker file: %v", err)
	}
	err := WriteJSON(filepath.Join(blocker, "sub", "data.json"), map[string]string{})
	if err == nil || !strings.Contains(err.Error(), "failed to create directory") {
		t.Fatalf("expected directory creation error, got: %v", err)
	}
}

// Regression test for the ReadJSON not-exist fix: a missing file must be
// detectable via os.IsNotExist, because BundledClient's GetInput/GetVariable/
// SetVariable all branch on it. The old rewrap ("file not found: %s" without
// %w) broke every one of those checks.
func TestReadJSONMissingFilePreservesNotExist(t *testing.T) {
	var out map[string]interface{}
	err := ReadJSON(filepath.Join(t.TempDir(), "absent.json"), &out)
	if err == nil {
		t.Fatal("expected an error for a missing file")
	}
	if !os.IsNotExist(err) {
		t.Fatalf("expected os.IsNotExist(err) to be true, got error: %v", err)
	}
}

func TestReadJSONMalformed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("failed to write file: %v", err)
	}
	var out map[string]interface{}
	err := ReadJSON(path, &out)
	if err == nil || !strings.Contains(err.Error(), "failed to unmarshal data") {
		t.Fatalf("expected unmarshal error, got: %v", err)
	}
}

func setHelperEnv(t *testing.T, vals map[string]string) {
	t.Helper()
	keys := []string{
		"CRONIUM_HELPER_MODE", "CRONIUM_EXECUTION_ID", "CRONIUM_JOB_ID",
		"CRONIUM_EVENT_ID", "CRONIUM_WORK_DIR", "CRONIUM_API_ENDPOINT",
		"CRONIUM_API_TOKEN",
	}
	for _, k := range keys {
		t.Setenv(k, vals[k]) // unset keys are pinned to "" and restored after
	}
}

func TestLoadConfigFromEnvironment(t *testing.T) {
	setHelperEnv(t, map[string]string{
		"CRONIUM_HELPER_MODE":  "api",
		"CRONIUM_EXECUTION_ID": "exec-1",
		"CRONIUM_JOB_ID":       "job-1",
		"CRONIUM_EVENT_ID":     "ev-1",
		"CRONIUM_WORK_DIR":     "/work",
		"CRONIUM_API_ENDPOINT": "http://runtime:8089/api/v1",
		"CRONIUM_API_TOKEN":    "tok",
	})

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	want := &Config{
		Mode:        APIMode,
		ExecutionID: "exec-1",
		JobID:       "job-1",
		EventID:     "ev-1",
		WorkDir:     "/work",
		APIEndpoint: "http://runtime:8089/api/v1",
		APIToken:    "tok",
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Errorf("config = %#v, want %#v", cfg, want)
	}
}

func TestLoadConfigFromEnvironmentDefaultsWorkDir(t *testing.T) {
	setHelperEnv(t, map[string]string{"CRONIUM_HELPER_MODE": "bundled"})

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if cfg.Mode != BundledMode || cfg.WorkDir != "." {
		t.Errorf("got mode %q workDir %q, want bundled / .", cfg.Mode, cfg.WorkDir)
	}
}

func TestLoadConfigFromFile(t *testing.T) {
	setHelperEnv(t, nil) // no env mode: force the file fallback
	dir := t.TempDir()
	t.Chdir(dir)

	if err := WriteJSON(filepath.Join(dir, ".cronium", "config.json"), Config{
		Mode:        APIMode,
		ExecutionID: "exec-9",
		APIEndpoint: "http://example/api",
		APIToken:    "t",
	}); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if cfg.Mode != APIMode || cfg.ExecutionID != "exec-9" {
		t.Errorf("config = %#v, want api mode / exec-9", cfg)
	}
	// Empty work_dir in the file defaults to ".".
	if cfg.WorkDir != "." {
		t.Errorf("workDir = %q, want .", cfg.WorkDir)
	}
}

func TestLoadConfigMalformedFile(t *testing.T) {
	setHelperEnv(t, nil)
	dir := t.TempDir()
	t.Chdir(dir)

	if err := os.MkdirAll(filepath.Join(dir, ".cronium"), 0o755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".cronium", "config.json"), []byte("{bad"), 0o644); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	_, err := LoadConfig()
	if err == nil || !strings.Contains(err.Error(), "failed to parse config") {
		t.Fatalf("expected parse error, got: %v", err)
	}
}

func TestLoadConfigDefaultsToBundledWhenNothingPresent(t *testing.T) {
	setHelperEnv(t, nil)
	t.Chdir(t.TempDir())

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if cfg.Mode != BundledMode || cfg.WorkDir != "." {
		t.Errorf("config = %#v, want bundled mode with workDir .", cfg)
	}
}
