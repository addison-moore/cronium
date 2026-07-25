package executor

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/helpers"
	"github.com/addison-moore/cronium/apps/runner/cronium-runner/pkg/types"
)

// helperBinariesEmbedded reports whether the default embed.go build carries
// helper binaries for this platform (Linux only — the runner ships to Linux
// servers). On other hosts SetupHelpers fails at the extraction step.
func helperBinariesEmbedded() bool {
	return runtime.GOOS == "linux" && (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64")
}

// runSetupHelpers invokes SetupHelpers and normalizes the platform split: on
// Linux it must fully succeed; elsewhere the only acceptable failure is the
// helper-binary extraction step, which happens after config.json is written.
func runSetupHelpers(t *testing.T, e *Executor, m *types.Manifest) {
	t.Helper()
	err := e.SetupHelpers(m)
	if helperBinariesEmbedded() {
		if err != nil {
			t.Fatalf("SetupHelpers failed: %v", err)
		}
		return
	}
	if err == nil || !strings.Contains(err.Error(), "failed to extract helpers") {
		t.Fatalf("expected extraction failure on %s/%s, got: %v", runtime.GOOS, runtime.GOARCH, err)
	}
}

func readHelperConfig(t *testing.T, workDir string) helpers.Config {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(workDir, ".cronium", "config.json"))
	if err != nil {
		t.Fatalf("config.json not written: %v", err)
	}
	var cfg helpers.Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("config.json is not valid JSON: %v", err)
	}
	return cfg
}

// pinHelperEnv pins (and restores) every env var SetupHelpers reads or
// mutates, defaulting all of them to empty.
func pinHelperEnv(t *testing.T, overrides map[string]string) {
	t.Helper()
	t.Setenv("PATH", os.Getenv("PATH"))
	for _, k := range []string{
		"CRONIUM_HELPER_MODE", "CRONIUM_EXECUTION_ID", "CRONIUM_JOB_ID",
		"CRONIUM_EVENT_ID", "CRONIUM_WORK_DIR", "CRONIUM_API_ENDPOINT", "CRONIUM_API_TOKEN",
	} {
		t.Setenv(k, overrides[k])
	}
}

func TestSetupHelpersModeSelection(t *testing.T) {
	cases := []struct {
		name         string
		env          map[string]string
		metadata     types.Metadata
		wantMode     helpers.Mode
		wantEndpoint string
		wantToken    string
		wantExecID   string
	}{
		{
			name:     "defaults to bundled with no credentials",
			metadata: types.Metadata{JobID: "job-1", EventID: "ev-1", ExecutionID: "exec-m"},
			wantMode: helpers.BundledMode,
			// No env execution ID: falls back to the manifest.
			wantExecID: "exec-m",
		},
		{
			name: "manifest credentials select api mode",
			metadata: types.Metadata{
				JobID: "job-1", EventID: "ev-1", ExecutionID: "exec-m",
				APIEndpoint: "http://manifest:8089/api", APIToken: "manifest-token",
			},
			wantMode:     helpers.APIMode,
			wantEndpoint: "http://manifest:8089/api",
			wantToken:    "manifest-token",
			wantExecID:   "exec-m",
		},
		{
			name: "environment credentials take precedence over manifest",
			env: map[string]string{
				"CRONIUM_API_ENDPOINT": "http://env:8089/api",
				"CRONIUM_API_TOKEN":    "env-token",
				"CRONIUM_EXECUTION_ID": "exec-env",
			},
			metadata: types.Metadata{
				JobID: "job-1", EventID: "ev-1", ExecutionID: "exec-m",
				APIEndpoint: "http://manifest:8089/api", APIToken: "manifest-token",
			},
			wantMode:     helpers.APIMode,
			wantEndpoint: "http://env:8089/api",
			wantToken:    "env-token",
			// The orchestrator-provided execution ID matches the JWT and wins.
			wantExecID: "exec-env",
		},
		{
			name: "endpoint without token stays bundled",
			env: map[string]string{
				"CRONIUM_API_ENDPOINT": "http://env:8089/api",
			},
			metadata:     types.Metadata{JobID: "job-1", EventID: "ev-1", ExecutionID: "exec-m"},
			wantMode:     helpers.BundledMode,
			wantEndpoint: "http://env:8089/api",
			wantExecID:   "exec-m",
		},
		{
			name: "CRONIUM_HELPER_MODE=bundled overrides api credentials",
			env: map[string]string{
				"CRONIUM_HELPER_MODE":  "bundled",
				"CRONIUM_API_ENDPOINT": "http://env:8089/api",
				"CRONIUM_API_TOKEN":    "env-token",
			},
			metadata:     types.Metadata{JobID: "job-1", EventID: "ev-1", ExecutionID: "exec-m"},
			wantMode:     helpers.BundledMode,
			wantEndpoint: "http://env:8089/api",
			wantToken:    "env-token",
			wantExecID:   "exec-m",
		},
		{
			name: "CRONIUM_HELPER_MODE=api forces api mode without credentials",
			env: map[string]string{
				"CRONIUM_HELPER_MODE": "api",
			},
			metadata:   types.Metadata{JobID: "job-1", EventID: "ev-1", ExecutionID: "exec-m"},
			wantMode:   helpers.APIMode,
			wantExecID: "exec-m",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pinHelperEnv(t, tc.env)
			e, _ := newTestExecutor(t)
			e.workDir = t.TempDir()
			m := &types.Manifest{
				Version:     "v1",
				Interpreter: types.ScriptTypeBash,
				Entrypoint:  "script.sh",
				Metadata:    tc.metadata,
			}

			runSetupHelpers(t, e, m)

			cfg := readHelperConfig(t, e.workDir)
			if cfg.Mode != tc.wantMode {
				t.Errorf("mode = %q, want %q", cfg.Mode, tc.wantMode)
			}
			if cfg.APIEndpoint != tc.wantEndpoint {
				t.Errorf("endpoint = %q, want %q", cfg.APIEndpoint, tc.wantEndpoint)
			}
			if cfg.APIToken != tc.wantToken {
				t.Errorf("token = %q, want %q", cfg.APIToken, tc.wantToken)
			}
			if cfg.ExecutionID != tc.wantExecID {
				t.Errorf("executionID = %q, want %q", cfg.ExecutionID, tc.wantExecID)
			}
			if cfg.JobID != tc.metadata.JobID || cfg.EventID != tc.metadata.EventID {
				t.Errorf("job/event = %q/%q, want %q/%q", cfg.JobID, cfg.EventID, tc.metadata.JobID, tc.metadata.EventID)
			}
			if cfg.WorkDir != e.workDir {
				t.Errorf("workDir = %q, want %q", cfg.WorkDir, e.workDir)
			}
		})
	}
}

// Full SetupHelpers pass: binaries extracted, PATH and env wired, bundled
// data files materialized, discovery script written. Needs the embedded
// Linux helper binaries, so it runs on Linux CI and is skipped elsewhere.
func TestSetupHelpersFullBundledSetup(t *testing.T) {
	if !helperBinariesEmbedded() {
		t.Skip("embedded helper binaries exist only for linux/amd64 and linux/arm64 (embed.go); full SetupHelpers cannot succeed on this host")
	}
	pinHelperEnv(t, map[string]string{"CRONIUM_EXECUTION_ID": "exec-env"})

	e, _ := newTestExecutor(t)
	e.workDir = t.TempDir()
	m := &types.Manifest{
		Version:     "v1",
		Interpreter: types.ScriptTypeBash,
		Entrypoint:  "script.sh",
		Environment: map[string]string{"FOO": "bar"},
		Metadata: types.Metadata{
			JobID:       "job-1",
			EventID:     "ev-1",
			EventName:   "Demo",
			ExecutionID: "exec-m",
			Trigger:     "manual",
			InputData:   map[string]interface{}{"in": "put"},
		},
	}

	if err := e.SetupHelpers(m); err != nil {
		t.Fatalf("SetupHelpers failed: %v", err)
	}

	croniumDir := filepath.Join(e.workDir, ".cronium")
	binDir := filepath.Join(croniumDir, "bin")

	// All five helper binaries extracted and executable.
	for _, name := range []string{"input", "output", "getVariable", "setVariable", "event"} {
		info, err := os.Stat(filepath.Join(binDir, "cronium."+name))
		if err != nil {
			t.Fatalf("helper cronium.%s not extracted: %v", name, err)
		}
		if info.Size() == 0 || info.Mode().Perm()&0o100 == 0 {
			t.Errorf("helper cronium.%s size=%d mode=%v, want non-empty executable", name, info.Size(), info.Mode())
		}
	}

	// PATH gains the helper bin dir; helper env vars are wired for children.
	if !strings.Contains(os.Getenv("PATH"), binDir) {
		t.Error("PATH does not include the helper bin dir")
	}
	for key, want := range map[string]string{
		"CRONIUM_HELPER_MODE":  "bundled",
		"CRONIUM_EXECUTION_ID": "exec-env",
		"CRONIUM_JOB_ID":       "job-1",
		"CRONIUM_EVENT_ID":     "ev-1",
		"CRONIUM_WORK_DIR":     e.workDir,
	} {
		if got := os.Getenv(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}

	// Bundled data files: event context, empty variables, provided input.
	var ctx helpers.EventContext
	if err := helpers.ReadJSON(filepath.Join(croniumDir, "context.json"), &ctx); err != nil {
		t.Fatalf("context.json missing: %v", err)
	}
	if ctx.EventID != "ev-1" || ctx.EventName != "Demo" || ctx.JobID != "job-1" ||
		ctx.Trigger != "manual" || ctx.ExecutionID != "exec-m" {
		t.Errorf("context = %#v", ctx)
	}
	if !reflect.DeepEqual(ctx.Environment, map[string]string{"FOO": "bar"}) {
		t.Errorf("context environment = %#v", ctx.Environment)
	}

	var vars map[string]interface{}
	if err := helpers.ReadJSON(filepath.Join(croniumDir, "variables.json"), &vars); err != nil {
		t.Fatalf("variables.json missing: %v", err)
	}
	if len(vars) != 0 {
		t.Errorf("variables.json = %#v, want empty object", vars)
	}

	var input helpers.InputData
	if err := helpers.ReadJSON(filepath.Join(croniumDir, "input.json"), &input); err != nil {
		t.Fatalf("input.json missing: %v", err)
	}
	if !reflect.DeepEqual(input.Data, map[string]interface{}{"in": "put"}) {
		t.Errorf("input data = %#v", input.Data)
	}

	// Discovery script for the bash interpreter.
	if _, err := os.Stat(filepath.Join(croniumDir, "discovery.sh")); err != nil {
		t.Errorf("discovery.sh missing: %v", err)
	}
}

func TestCollectHelperOutputNoFile(t *testing.T) {
	e, _ := newTestExecutor(t)
	e.workDir = t.TempDir()

	out, err := e.CollectHelperOutput()
	if err != nil {
		t.Fatalf("expected nil error with no output.json, got: %v", err)
	}
	if out != nil {
		t.Errorf("expected nil output, got: %#v", out)
	}
}

func TestCollectHelperOutputReadsData(t *testing.T) {
	e, _ := newTestExecutor(t)
	e.workDir = t.TempDir()
	if err := helpers.WriteJSON(filepath.Join(e.workDir, ".cronium", "output.json"), helpers.OutputData{
		Data: map[string]interface{}{"answer": float64(42)},
	}); err != nil {
		t.Fatalf("failed to seed output.json: %v", err)
	}

	out, err := e.CollectHelperOutput()
	if err != nil {
		t.Fatalf("CollectHelperOutput failed: %v", err)
	}
	if !reflect.DeepEqual(out, map[string]interface{}{"answer": float64(42)}) {
		t.Errorf("output = %#v, want answer=42", out)
	}
}

func TestCollectHelperOutputMalformed(t *testing.T) {
	e, _ := newTestExecutor(t)
	e.workDir = t.TempDir()
	dir := filepath.Join(e.workDir, ".cronium")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "output.json"), []byte("{bad"), 0o644); err != nil {
		t.Fatalf("failed to write output.json: %v", err)
	}

	if _, err := e.CollectHelperOutput(); err == nil || !strings.Contains(err.Error(), "failed to read output") {
		t.Fatalf("expected read error, got: %v", err)
	}
}
