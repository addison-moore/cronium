package manifest

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/pkg/types"
)

// writeManifest writes content to a manifest.yaml in a fresh temp dir and
// returns the file path.
func writeManifest(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "manifest.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write manifest: %v", err)
	}
	return path
}

func TestParseValidManifestAllFields(t *testing.T) {
	path := writeManifest(t, `
version: v1
interpreter: bash
entrypoint: script.sh
environment:
  FOO: bar
  EMPTY: ""
metadata:
  jobId: job-1
  eventId: "42"
  eventVersion: 3
  createdAt: 2026-01-02T03:04:05Z
  executionId: exec-1
  eventName: Demo Event
  trigger: manual
  apiEndpoint: http://runtime:8089/api/v1
  apiToken: tok
  inputData:
    a: 1
  extra:
    b: two
`)

	m, err := Parse(path)
	if err != nil {
		t.Fatalf("expected valid manifest to parse, got: %v", err)
	}

	if m.Version != "v1" {
		t.Errorf("version = %q, want v1", m.Version)
	}
	// Interpreter is normalized to the canonical uppercase form.
	if m.Interpreter != types.ScriptTypeBash {
		t.Errorf("interpreter = %q, want %q", m.Interpreter, types.ScriptTypeBash)
	}
	if m.Entrypoint != "script.sh" {
		t.Errorf("entrypoint = %q, want script.sh", m.Entrypoint)
	}
	wantEnv := map[string]string{"FOO": "bar", "EMPTY": ""}
	if !reflect.DeepEqual(m.Environment, wantEnv) {
		t.Errorf("environment = %#v, want %#v", m.Environment, wantEnv)
	}
	md := m.Metadata
	if md.JobID != "job-1" || md.EventID != "42" || md.EventVersion != 3 {
		t.Errorf("metadata ids = %q/%q/%d, want job-1/42/3", md.JobID, md.EventID, md.EventVersion)
	}
	wantTime := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if !md.CreatedAt.Equal(wantTime) {
		t.Errorf("createdAt = %v, want %v", md.CreatedAt, wantTime)
	}
	if md.ExecutionID != "exec-1" || md.EventName != "Demo Event" || md.Trigger != "manual" {
		t.Errorf("metadata strings = %q/%q/%q", md.ExecutionID, md.EventName, md.Trigger)
	}
	if md.APIEndpoint != "http://runtime:8089/api/v1" || md.APIToken != "tok" {
		t.Errorf("api fields = %q/%q", md.APIEndpoint, md.APIToken)
	}
	input, ok := md.InputData.(map[string]interface{})
	if !ok || input["a"] != 1 {
		t.Errorf("inputData = %#v, want map with a: 1", md.InputData)
	}
	if md.Extra["b"] != "two" {
		t.Errorf("extra = %#v, want map with b: two", md.Extra)
	}
}

func TestParseNormalizesInterpreterCase(t *testing.T) {
	cases := []struct {
		raw  string
		want types.ScriptType
	}{
		{"bash", types.ScriptTypeBash},
		{"Bash", types.ScriptTypeBash},
		{"BASH", types.ScriptTypeBash},
		{"python", types.ScriptTypePython},
		{"PYTHON", types.ScriptTypePython},
		{"node", types.ScriptTypeNode},
		{"NoDe", types.ScriptTypeNode},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			path := writeManifest(t, "version: v1\ninterpreter: "+tc.raw+"\nentrypoint: run.sh\n")
			m, err := Parse(path)
			if err != nil {
				t.Fatalf("Parse(%q interpreter) failed: %v", tc.raw, err)
			}
			if m.Interpreter != tc.want {
				t.Errorf("interpreter %q normalized to %q, want %q", tc.raw, m.Interpreter, tc.want)
			}
		})
	}
}

// JobID is explicitly optional (validation of metadata.jobId is commented out
// in validate); pin that a manifest without metadata still parses.
func TestParseMinimalManifestWithoutMetadata(t *testing.T) {
	path := writeManifest(t, "version: v1\ninterpreter: bash\nentrypoint: run.sh\n")
	m, err := Parse(path)
	if err != nil {
		t.Fatalf("expected minimal manifest to parse, got: %v", err)
	}
	if m.Metadata.JobID != "" || m.Environment != nil {
		t.Errorf("expected zero metadata/env, got %#v / %#v", m.Metadata, m.Environment)
	}
}

// Unknown top-level fields are ignored (yaml.v3 is permissive by default).
func TestParseIgnoresUnknownFields(t *testing.T) {
	path := writeManifest(t, "version: v1\ninterpreter: node\nentrypoint: run.js\nsomethingElse: true\n")
	if _, err := Parse(path); err != nil {
		t.Fatalf("expected unknown fields to be ignored, got: %v", err)
	}
}

func TestParseInvalidManifests(t *testing.T) {
	cases := []struct {
		name    string
		content string
		wantErr string
	}{
		{
			name:    "empty file",
			content: "",
			wantErr: "version is required",
		},
		{
			name:    "missing version",
			content: "interpreter: bash\nentrypoint: run.sh\n",
			wantErr: "version is required",
		},
		{
			name:    "unsupported version",
			content: "version: v2\ninterpreter: bash\nentrypoint: run.sh\n",
			wantErr: "unsupported manifest version: v2",
		},
		{
			name:    "missing interpreter",
			content: "version: v1\nentrypoint: run.sh\n",
			wantErr: "unsupported interpreter",
		},
		{
			name:    "unsupported interpreter",
			content: "version: v1\ninterpreter: ruby\nentrypoint: run.rb\n",
			wantErr: "unsupported interpreter: ruby",
		},
		{
			name:    "missing entrypoint",
			content: "version: v1\ninterpreter: bash\n",
			wantErr: "entrypoint is required",
		},
		{
			name:    "malformed yaml",
			content: "version: v1\ninterpreter: [unclosed\n",
			wantErr: "failed to parse manifest",
		},
		{
			name:    "wrong type for interpreter",
			content: "version: v1\ninterpreter:\n  - bash\n  - python\nentrypoint: run.sh\n",
			wantErr: "failed to parse manifest",
		},
		{
			name:    "wrong type for environment",
			content: "version: v1\ninterpreter: bash\nentrypoint: run.sh\nenvironment: not-a-map\n",
			wantErr: "failed to parse manifest",
		},
		{
			name:    "wrong type for createdAt",
			content: "version: v1\ninterpreter: bash\nentrypoint: run.sh\nmetadata:\n  createdAt: not-a-date\n",
			wantErr: "failed to parse manifest",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeManifest(t, tc.content)
			_, err := Parse(path)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %q, want it to contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestParseMissingFile(t *testing.T) {
	_, err := Parse(filepath.Join(t.TempDir(), "does-not-exist.yaml"))
	if err == nil || !strings.Contains(err.Error(), "failed to read manifest") {
		t.Fatalf("expected read error, got: %v", err)
	}
}

func TestFindManifestPrefersYamlOverYml(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"manifest.yaml", "manifest.yml"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("version: v1\n"), 0o644); err != nil {
			t.Fatalf("failed to write %s: %v", name, err)
		}
	}
	path, err := FindManifest(dir)
	if err != nil {
		t.Fatalf("FindManifest failed: %v", err)
	}
	if path != filepath.Join(dir, "manifest.yaml") {
		t.Errorf("path = %q, want manifest.yaml preferred", path)
	}
}

func TestFindManifestFallsBackToYml(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.yml"), []byte("version: v1\n"), 0o644); err != nil {
		t.Fatalf("failed to write manifest.yml: %v", err)
	}
	path, err := FindManifest(dir)
	if err != nil {
		t.Fatalf("FindManifest failed: %v", err)
	}
	if path != filepath.Join(dir, "manifest.yml") {
		t.Errorf("path = %q, want manifest.yml", path)
	}
}

func TestFindManifestMissing(t *testing.T) {
	dir := t.TempDir()
	_, err := FindManifest(dir)
	if err == nil || !strings.Contains(err.Error(), "manifest.yaml not found") {
		t.Fatalf("expected not-found error, got: %v", err)
	}
}

func TestFindManifestStatError(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: chmod 000 does not produce a permission error")
	}
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked")
	if err := os.Mkdir(locked, 0o755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.Chmod(locked, 0o000); err != nil {
		t.Fatalf("failed to chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })

	_, err := FindManifest(locked)
	if err == nil {
		t.Fatal("expected a stat error for an unreadable directory")
	}
}
