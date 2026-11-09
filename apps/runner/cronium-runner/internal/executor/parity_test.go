package executor

// A script has to behave the same in a container and on a remote server. These
// tests run one script both ways against the same fake runtime and compare what
// the script printed, how it exited, and what it asked the runtime to do:
//
//   - the container path is the real SDK from apps/runtime/runtime-helpers, loaded
//     the way the orchestrator's container executor loads it
//   - the remote path is the real executor, helper binaries and generated bindings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/pkg/types"
)

const (
	parityExecutionID = "exec-parity"
	parityToken       = "parity-token-0123456789"

	// Written the way the runtime's Go encoder writes it, HTML escapes included.
	parityInput   = `{"z":1,"a":"\u003cb\u003e \u0026 c","unicode":"é✓","flag":false,"none":null,"f":1.5,"list":[1,"two",{"three":3}],"empty":{},"blank":[]}`
	parityContext = `{"executionId":"exec-parity","eventId":"7","eventName":"Demo \u003cevent\u003e","eventType":"BASH","userId":"u1","startTime":"0001-01-01T00:00:00Z","metadata":{"retry":0,"logId":12},"event":{"id":"7","name":"Demo \u003cevent\u003e","type":"BASH","runLocation":"REMOTE"}}`
)

// failingReads are variables whose reads go wrong in these ways. Their writes work, which
// is what makes the failure dangerous: a helper that takes one for a variable with no
// value goes on to replace it.
var failingReads = map[string]struct {
	status int
	body   string
}{
	"BROKEN":      {http.StatusInternalServerError, `{"error":"Internal Server Error","message":"failed to get variable"}`},
	"DENIED":      {http.StatusForbidden, `{"error":"Forbidden","message":"execution ID mismatch"}`},
	"NOT_JSON":    {http.StatusOK, `<html>`},
	"EMPTY_BODY":  {http.StatusOK, ``},
	"SAYS_FAILED": {http.StatusOK, `{"success":false,"error":"it failed"}`},
}

// fakeRuntime answers as the runtime service does, and records each request it
// accepted. A rejected request may never be sent by the side that can tell in
// advance, so those are not part of the comparison. A read that fails is recorded: it
// has to have been sent, and both sides make the same number of tries.
type fakeRuntime struct {
	mu        sync.Mutex
	variables map[string]string
	requests  []string
}

func newFakeRuntime(t *testing.T) (*fakeRuntime, string) {
	t.Helper()
	runtime := &fakeRuntime{variables: map[string]string{}}
	server := httptest.NewServer(runtime)
	t.Cleanup(server.Close)
	return runtime, server.URL
}

func (f *fakeRuntime) reply(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body+"\n")
}

func (f *fakeRuntime) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	body, _ := io.ReadAll(r.Body)
	path := r.URL.EscapedPath()
	root := "/executions/" + parityExecutionID + "/"

	if r.Header.Get("Authorization") != "Bearer "+parityToken {
		f.reply(w, http.StatusUnauthorized, `{"error":"Unauthorized","message":"bad token"}`)
		return
	}

	record := func() {
		canonical := ""
		if len(body) > 0 {
			var value interface{}
			if err := json.Unmarshal(body, &value); err != nil {
				canonical = "unparsable:" + string(body)
			} else {
				encoded, _ := json.Marshal(value)
				canonical = string(encoded)
			}
		}
		f.requests = append(f.requests, r.Method+" "+path+" "+canonical)
	}

	// A script sets BREAK_READS to the status it wants the input and context routes to
	// answer, so that it can see what its helpers do when those fail.
	if status, err := strconv.Atoi(f.variables["BREAK_READS"]); err == nil && r.Method == http.MethodGet &&
		(path == root+"input" || path == root+"context") {
		record()
		f.reply(w, status, `{"error":"Failed","message":"broken"}`)
		return
	}

	switch {
	case r.Method == http.MethodGet && path == root+"input":
		record()
		f.reply(w, http.StatusOK, `{"success":true,"data":`+parityInput+`}`)

	case r.Method == http.MethodPost && path == root+"output":
		record()
		f.reply(w, http.StatusOK, `{"success":true}`)

	case r.Method == http.MethodGet && path == root+"context":
		record()
		f.reply(w, http.StatusOK, `{"success":true,"data":`+parityContext+`}`)

	case r.Method == http.MethodPost && path == root+"condition":
		var request struct {
			Condition bool `json:"condition"`
		}
		if err := json.Unmarshal(body, &request); err != nil {
			f.reply(w, http.StatusBadRequest, `{"error":"Bad Request","message":"invalid request body"}`)
			return
		}
		record()
		f.reply(w, http.StatusOK, `{"success":true}`)

	case strings.HasPrefix(path, root+"variables/"):
		key := strings.TrimPrefix(path, root+"variables/")
		if r.Method == http.MethodGet {
			record()
			value, found := f.variables[key]
			if key == "GONE" {
				f.reply(w, http.StatusNotFound, `{"message":"Variable not found"}`)
				return
			}
			if failure, failing := failingReads[key]; failing {
				f.reply(w, failure.status, failure.body)
				return
			}
			encoded := "null"
			if found {
				raw, _ := json.Marshal(value)
				encoded = string(raw)
			}
			f.reply(w, http.StatusOK, `{"success":true,"data":{"key":"`+key+`","value":`+encoded+`}}`)
			return
		}
		var request struct {
			Value json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(body, &request); err != nil {
			f.reply(w, http.StatusBadRequest, `{"error":"Bad Request","message":"invalid request body"}`)
			return
		}
		if key == "READ_ONLY" {
			record()
			f.reply(w, http.StatusForbidden, `{"error":"Forbidden","message":"not yours"}`)
			return
		}
		value, ok := variableText(request.Value)
		if !ok {
			// The app accepts only strings, and null is not one.
			f.reply(w, http.StatusBadRequest, `{"error":"Bad Request","message":"Value must be a string"}`)
			return
		}
		record()
		f.variables[key] = value
		f.reply(w, http.StatusOK, `{"success":true}`)

	case r.Method == http.MethodPost && path == "/tool-actions/execute":
		var request struct {
			Tool   string          `json:"tool"`
			Action string          `json:"action"`
			Config json.RawMessage `json:"config"`
		}
		_ = json.Unmarshal(body, &request)
		if request.Tool == "broken" {
			// Not a 5xx, which makes the container's SDK retry and the test wait.
			f.reply(w, http.StatusBadRequest, `{"error":"Bad Request","message":"tool action failed: no such tool"}`)
			return
		}
		record()
		f.reply(w, http.StatusOK, `{"success":true,"data":{"tool":"`+request.Tool+`","config":`+string(request.Config)+`}}`)

	default:
		f.reply(w, http.StatusNotFound, `{"error":"Not Found","message":"no such route"}`)
	}
}

// variableText turns a value into the string the runtime stores for it.
func variableText(raw json.RawMessage) (string, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return "", false
	}
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(trimmed, &text); err != nil {
			return "", false
		}
		return text, true
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, trimmed); err != nil {
		return "", false
	}
	return compact.String(), true
}

// parityResult is everything a script's run is compared on.
type parityResult struct {
	stdout   string
	stderr   string
	exitCode int
	requests []string
}

func repoPath(parts ...string) string {
	return filepath.Join(append([]string{"..", "..", "..", "..", ".."}, parts...)...)
}

// runInContainerSDK runs a script the way the orchestrator's container executor
// does (internal/executors/container/executor.go, buildCommand), minus the container.
func runInContainerSDK(t *testing.T, interpreter types.ScriptType, script string) parityResult {
	t.Helper()
	runtime, url := newFakeRuntime(t)

	sdk, err := filepath.Abs(repoPath("apps", "runtime", "runtime-helpers"))
	if err != nil {
		t.Fatalf("failed to resolve the SDK path: %v", err)
	}

	var cmd *exec.Cmd
	env := append(os.Environ(),
		"CRONIUM_RUNTIME_API="+url,
		"CRONIUM_EXECUTION_TOKEN="+parityToken,
		"CRONIUM_EXECUTION_ID="+parityExecutionID,
	)
	switch interpreter {
	case types.ScriptTypeBash:
		sdkScript := filepath.Join(sdk, "bash", "cronium.sh")
		cmd = exec.Command("bash", "-c", "source "+sdkScript+" || true\n"+script)
	case types.ScriptTypePython:
		cmd = exec.Command("python3", "-c", "import cronium\n"+script)
		env = append(env, "PYTHONPATH="+filepath.Join(sdk, "python"), "PYTHONDONTWRITEBYTECODE=1")
	case types.ScriptTypeNode:
		cmd = exec.Command("node", "-e", "globalThis.cronium = require('cronium');\n"+script)
		env = append(env, "NODE_PATH="+filepath.Join(sdk, "nodejs"))
	default:
		t.Fatalf("unsupported interpreter %s", interpreter)
	}
	cmd.Env = env
	cmd.Dir = t.TempDir()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	exitCode := 0
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			t.Fatalf("failed to run the container SDK script: %v", err)
		}
		exitCode = exitErr.ExitCode()
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return parityResult{stdout.String(), stderr.String(), exitCode, runtime.requests}
}

// runOnRunner runs a script through the real executor and helper binaries.
func runOnRunner(t *testing.T, interpreter types.ScriptType, script string) parityResult {
	t.Helper()
	realHelpers(t)
	runtime, url := newFakeRuntime(t)
	pinHelperEnv(t, map[string]string{
		"CRONIUM_API_ENDPOINT": url,
		"CRONIUM_API_TOKEN":    parityToken,
		"CRONIUM_EXECUTION_ID": parityExecutionID,
	})

	e, hook := newTestExecutor(t)
	e.workDir = t.TempDir()
	entrypoint := map[types.ScriptType]string{
		types.ScriptTypeBash:   "script.sh",
		types.ScriptTypePython: "script.py",
		types.ScriptTypeNode:   "script.js",
	}[interpreter]
	if err := os.WriteFile(filepath.Join(e.workDir, entrypoint), []byte(script), 0o755); err != nil {
		t.Fatalf("failed to write the script: %v", err)
	}
	e.manifest = &types.Manifest{
		Version:     "v1",
		Interpreter: interpreter,
		Entrypoint:  entrypoint,
		Metadata:    types.Metadata{JobID: "job-parity", EventID: "7"},
	}
	if err := e.SetupHelpers(e.manifest); err != nil {
		t.Fatalf("SetupHelpers failed: %v", err)
	}

	exitCode := 0
	if err := e.executeScript(); err != nil {
		var scriptExit *ScriptExitError
		if !errors.As(err, &scriptExit) {
			t.Fatalf("failed to run the script: %v", err)
		}
		exitCode = scriptExit.Code
	}

	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return parityResult{hook.stdout.String(), hook.stderr.String(), exitCode, runtime.requests}
}

func compareRuns(t *testing.T, interpreter types.ScriptType, script string) parityResult {
	t.Helper()
	container := runInContainerSDK(t, interpreter, script)
	runner := runOnRunner(t, interpreter, script)

	// Each run has its own fake runtime on its own port.
	portPattern := regexp.MustCompile(`http://127\.0\.0\.1:\d+`)
	normalize := func(text string) string { return portPattern.ReplaceAllString(text, "http://runtime") }

	if got, want := normalize(runner.stdout), normalize(container.stdout); got != want {
		t.Errorf("stdout differs\n%s", lineDiff(want, got))
	}
	if got, want := normalize(runner.stderr), normalize(container.stderr); got != want {
		t.Errorf("stderr differs\n%s", lineDiff(want, got))
	}
	if runner.exitCode != container.exitCode {
		t.Errorf("exit code on the runner = %d, in a container = %d", runner.exitCode, container.exitCode)
	}
	if got, want := strings.Join(runner.requests, "\n"), strings.Join(container.requests, "\n"); got != want {
		t.Errorf("requests differ\n%s", lineDiff(want, got))
	}
	return container
}

func lineDiff(container, runner string) string {
	containerLines := strings.Split(container, "\n")
	runnerLines := strings.Split(runner, "\n")
	var out strings.Builder
	for i := 0; i < len(containerLines) || i < len(runnerLines); i++ {
		var c, r string
		if i < len(containerLines) {
			c = containerLines[i]
		}
		if i < len(runnerLines) {
			r = runnerLines[i]
		}
		if c != r {
			fmt.Fprintf(&out, "line %d\n  container: %q\n  runner:    %q\n", i+1, c, r)
		}
	}
	return out.String()
}

func requireTools(t *testing.T, tools ...string) {
	t.Helper()
	for _, tool := range tools {
		requireTool(t, tool)
	}
}

const parityBashScript = `
echo "input: $(cronium_input)"
cronium_output '{"result":"ok","n":1}'; echo "output rc=$?"
cronium_output 'plain text'; echo "output text rc=$?"
cronium_output 42; echo "output number rc=$?"
cronium_output ''; echo "output empty rc=$?"

cronium_set_variable STR "hello world"; echo "set string rc=$?"
echo "string: [$(cronium_get_variable STR)]"
cronium_set_variable NUM 42; echo "set number rc=$?"
echo "number: [$(cronium_get_variable NUM)]"
cronium_set_variable OBJ '{"b": 1, "a": [1,2]}'; echo "set object rc=$?"
echo "object: [$(cronium_get_variable OBJ)]"
cronium_set_variable BOOL true; echo "set bool rc=$?"
echo "bool: [$(cronium_get_variable BOOL)]"
cronium_set_variable EMPTY ''; echo "set empty rc=$?"
echo "empty: [$(cronium_get_variable EMPTY)]"
cronium_set_variable TWO '1 2'; echo "set two values rc=$?"
echo "two values: [$(cronium_get_variable TWO)]"
cronium_set_variable 'a b' spaced; echo "set spaced key rc=$?"
echo "spaced key: [$(cronium_get_variable 'a b')]"
echo "unset: [$(cronium_get_variable NOPE)] rc=$?"
echo "gone: [$(cronium_get_variable GONE)] rc=$?"

cronium_variable_exists STR && echo "STR exists" || echo "STR missing"
cronium_variable_exists NOPE && echo "NOPE exists" || echo "NOPE missing"
cronium_increment_variable COUNT
cronium_increment_variable COUNT 5
cronium_increment_variable STR 2>/dev/null; echo "increment text rc=$?"
cronium_append_variable LOG one
cronium_append_variable LOG two ","
echo "log: [$(cronium_get_variable LOG)]"
cronium_delete_variable STR 2>/dev/null; echo "delete rc=$?"

cronium_set_condition true; echo "condition rc=$?"
cronium_set_condition no; echo "condition rc=$?"
cronium_set_condition maybe 2>&1; echo "bad condition rc=$?"

cronium_event; echo "event rc=$?"
cronium_event_field eventName
cronium_event_field event.runLocation
cronium_event_field metadata.retry
cronium_event_field missing; echo "missing field rc=$?"

cronium_execute_tool_action sql run_query '{"query":"select 1"}'; echo "tool rc=$?"
cronium_execute_tool_action sql run_query 'not json' 2>&1; echo "bad tool config rc=$?"
cronium_execute_tool_action broken nope '{}' 2>&1; echo "failed tool rc=$?"
echo; echo "after a blank line"
cronium_send_email "a@x.io, b@x.io" Subject Body --cc c@x.io --bcc "d@x.io,e@x.io" --html
cronium_send_slack_message "#ops" hello --username bot --icon-emoji :x: --icon-url http://i
cronium_send_discord_message 123 hello --embed '{"title":"t"}'
cronium_info

bash -c 'echo "in a subshell: [$(cronium_get_variable NUM)]"'
`

func TestParityBash(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")
	pinParityBash(t, compareRuns(t, types.ScriptTypeBash, parityBashScript))
}

// TestParityBashUnderSetU runs the same script under `set -u`, which applies inside the
// helpers because they run in the script's own shell. In a container, every helper that
// reads used to die on an unset "$3", and two of them then overwrote the stored value. The
// runner's functions never had the problem, so this is where the two differed.
func TestParityBashUnderSetU(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")
	pinParityBash(t, compareRuns(t, types.ScriptTypeBash, "set -u\n"+parityBashScript))
}

// pinParityBash pins the behavior itself, so the two cannot drift together unnoticed.
func pinParityBash(t *testing.T, result parityResult) {
	t.Helper()
	for _, want := range []string{
		"string: [hello world]",
		"number: [42]",
		`object: [{"b":1,"a":[1,2]}]`,
		"empty: []",
		"two values: [1 2]",
		"unset: [] rc=0",
		"in a subshell: [42]",
		"Error: Invalid condition value. Use true/false, 1/0, yes/no, or on/off",
		"Error: API request failed - HTTP 400 - tool action failed: no such tool",
		"<event>",
		"Demo <event>",
		"REMOTE",
	} {
		if !strings.Contains(result.stdout, want) {
			t.Errorf("stdout is missing %q:\n%s", want, result.stdout)
		}
	}
	for _, want := range []string{
		`POST /executions/exec-parity/condition {"condition":true}`,
		`POST /executions/exec-parity/condition {"condition":false}`,
		`POST /tool-actions/execute {"action":"run_query","config":{"query":"select 1"},"tool":"sql"}`,
	} {
		if !strings.Contains(strings.Join(result.requests, "\n"), want) {
			t.Errorf("requests are missing %q:\n%s", want, strings.Join(result.requests, "\n"))
		}
	}
}

// A failed read looked like a variable with no value on both sides, because both read
// through `|| echo 0`: the stored value was replaced, and the helper reported success.
const parityBashFailedReadsScript = `
cronium_increment_variable BROKEN; echo "increment after a 500 rc=$?"
cronium_increment_variable DENIED; echo "increment after a 403 rc=$?"
cronium_append_variable DENIED more ","; echo "append after a 403 rc=$?"
cronium_variable_exists DENIED; echo "exists after a 403 rc=$?"
cronium_variable_exists NOPE; echo "exists with no value rc=$?"
out=$(cronium_get_variable DENIED); echo "read after a 403 [$out] rc=$?"

# Hiding stderr, because these don't word it the same. Neither may count as no value.
for key in NOT_JSON EMPTY_BODY SAYS_FAILED; do
  cronium_increment_variable "$key" 2>/dev/null; echo "increment $key rc=$?"
  cronium_append_variable "$key" more 2>/dev/null; echo "append $key rc=$?"
  cronium_variable_exists "$key" 2>/dev/null; echo "exists $key rc=$?"
  out=$(cronium_get_variable "$key" 2>/dev/null); echo "read $key [$out] rc=$?"
done

# Only these may start from nothing.
cronium_increment_variable NOPE; echo "increment with no value rc=$?"
cronium_increment_variable GONE; echo "increment after a 404 rc=$?"
cronium_append_variable NOPE2 more; echo "append with no value rc=$?"
echo "stored: [$(cronium_get_variable NOPE)] [$(cronium_get_variable NOPE2)]"

# A write that fails is a failure too, with no new value to go on with.
cronium_increment_variable READ_ONLY; echo "increment refused rc=$?"
cronium_append_variable READ_ONLY more; echo "append refused rc=$?"

# 404 means no such variable, not that anything else is missing.
cronium_set_variable BREAK_READS 404
out=$(cronium_input); echo "input after a 404 [$out] rc=$?"
out=$(cronium_event); echo "event after a 404 [$out] rc=$?"
out=$(cronium_event_field eventName); echo "field after a 404 [$out] rc=$?"
cronium_set_variable BREAK_READS 403
out=$(cronium_event_field eventName); echo "field after a 403 [$out] rc=$?"
`

func TestParityBashFailedReads(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")

	for _, tc := range []struct{ name, script string }{
		{"with no strict mode", parityBashFailedReadsScript},
		{"under set -u", "set -u\n" + parityBashFailedReadsScript},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compareRuns(t, types.ScriptTypeBash, tc.script)

			for _, want := range []string{
				"increment after a 500 rc=1",
				"increment after a 403 rc=1",
				"append after a 403 rc=1",
				"exists after a 403 rc=2",
				"exists with no value rc=1",
				"read after a 403 [] rc=1",
				"increment NOT_JSON rc=1",
				"append EMPTY_BODY rc=1",
				"exists SAYS_FAILED rc=2",
				"read SAYS_FAILED [] rc=1",
				"1\nincrement with no value rc=0",
				"1\nincrement after a 404 rc=0",
				"append with no value rc=0",
				"stored: [1] [more]",
				"increment refused rc=1",
				"append refused rc=1",
				"input after a 404 [] rc=1",
				"event after a 404 [] rc=1",
				"field after a 404 [] rc=1",
				"field after a 403 [] rc=1",
			} {
				if !strings.Contains(result.stdout, want) {
					t.Errorf("stdout is missing %q:\n%s", want, result.stdout)
				}
			}
			for _, want := range []string{
				"Error: API request failed - HTTP 500 - failed to get variable\nError: Could not read variable 'BROKEN', so it was not changed\n",
				"Error: API request failed - HTTP 403 - execution ID mismatch\nError: Could not tell whether variable 'DENIED' exists\n",
				"Error: API request failed - HTTP 403 - not yours\n",
				"Error: API request failed - HTTP 404 - broken\n",
			} {
				if !strings.Contains(result.stderr, want) {
					t.Errorf("stderr is missing %q:\n%s", want, result.stderr)
				}
			}

			requests := strings.Join(result.requests, "\n")
			for _, key := range []string{"BROKEN", "DENIED", "NOT_JSON", "EMPTY_BODY", "SAYS_FAILED"} {
				if strings.Contains(requests, "PUT /executions/exec-parity/variables/"+key+" ") {
					t.Errorf("wrote to %s after failing to read it:\n%s", key, requests)
				}
			}
			if got := strings.Count(requests, "GET /executions/exec-parity/variables/BROKEN "); got != 3 {
				t.Errorf("%d reads of BROKEN, want 3 tries:\n%s", got, requests)
			}
		})
	}
}

// Under `set -e`, a helper that fails ends the script with status 1 on either side. In a
// container one that writes used to end it at the first refused connection, with curl's
// status and no retry, so a sidecar restarting was enough.
func TestParityBashFailuresUnderSetE(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")

	for _, tc := range []struct {
		name, script, stdout string
	}{
		{
			name:   "a failed read",
			script: "cronium_increment_variable NOPE\ncronium_increment_variable DENIED 2>/dev/null\necho not reached\n",
			stdout: "1\n",
		},
		{
			name:   "a refused connection",
			script: "export CRONIUM_RUNTIME_API=http://127.0.0.1:1 CRONIUM_API_ENDPOINT=http://127.0.0.1:1\ncronium_output x 2>/dev/null\necho not reached\n",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compareRuns(t, types.ScriptTypeBash, "set -euo pipefail\n"+tc.script)

			if result.exitCode != 1 {
				t.Errorf("exit code = %d, want 1", result.exitCode)
			}
			if result.stdout != tc.stdout {
				t.Errorf("stdout = %q, want %q", result.stdout, tc.stdout)
			}
		})
	}
}

// With no API token to show, as in bundled mode, this used to end a `set -u` script on the
// runner. The container's cronium_info always guarded its token, so this one has no parity
// to compare with: the two would print different tokens.
func TestRunnerBashInfoWithoutATokenUnderSetU(t *testing.T) {
	requireTools(t, "bash")
	result := runOnRunner(t, types.ScriptTypeBash, "unset CRONIUM_API_TOKEN\nset -u\ncronium_info >/dev/null\necho \"rc=$?\"\n")
	if result.stdout != "rc=0\n" || result.exitCode != 0 {
		t.Errorf("stdout = %q, exit code = %d\nstderr: %s", result.stdout, result.exitCode, result.stderr)
	}
}

// TestParityBashKeepsAnEventsEnvVars covers names the container SDK used to assign as it
// loaded, overwriting an event's env vars. The runner never did. The fake runtime refuses
// any token but the execution's, so rc=0 also shows what each side's helpers send.
func TestParityBashKeepsAnEventsEnvVars(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")
	t.Setenv("CRONIUM_TOKEN", "my-api-token")
	t.Setenv("CRONIUM_API", "https://cronium.example.com/api")
	t.Setenv("CRONIUM_EXEC_ID", "my-execution")
	t.Setenv("cmd", "mine")

	result := compareRuns(t, types.ScriptTypeBash, `echo "$CRONIUM_TOKEN $CRONIUM_API $CRONIUM_EXEC_ID $cmd"
bash -c 'echo "$CRONIUM_TOKEN $CRONIUM_API $CRONIUM_EXEC_ID $cmd"'
cronium_output x; echo "rc=$?"
`)

	const values = "my-api-token https://cronium.example.com/api my-execution mine\n"
	if want := values + values + "rc=0\n"; result.stdout != want {
		t.Errorf("stdout = %q, want %q", result.stdout, want)
	}
}

func TestParityBashFailingScript(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")
	result := compareRuns(t, types.ScriptTypeBash, "echo before\necho problem >&2\ncronium_set_condition false\nexit 3\necho after\n")
	if result.exitCode != 3 {
		t.Errorf("exit code = %d, want 3", result.exitCode)
	}
}

const parityPythonScript = `
import json

print("input:", json.dumps(cronium.input()))
print("output:", cronium.output({"result": "ok", "n": 1}))
print("output text:", cronium.output("plain text"))

print("set:", cronium.set_variable("STR", "hello world"))
print("string:", repr(cronium.get_variable("STR")))
cronium.set_variable("NUM", 42)
print("number:", repr(cronium.get_variable("NUM")))
cronium.set_variable("OBJ", {"b": 1, "a": [1, 2]})
print("object:", repr(cronium.get_variable("OBJ")))
cronium.set_variable("TEXTNUM", "42")
print("text number:", repr(cronium.get_variable("TEXTNUM")))
cronium.set_variable("a b", "spaced")
print("spaced key:", repr(cronium.get_variable("a b")))
print("unset:", repr(cronium.get_variable("NOPE")))
print("gone:", repr(cronium.get_variable("GONE")))

print("condition:", cronium.set_condition(True))
print("condition:", cronium.set_condition(False))
try:
    cronium.set_condition(1)
    print("not rejected")
except cronium.CroniumError:
    print("rejected a non-boolean")
try:
    cronium.set_variable("NULL", None)
    print("not rejected")
except cronium.CroniumError:
    print("rejected null")

event = cronium.event()
print("event:", json.dumps(event))
print("event name:", event["event"]["name"])

print("tool:", cronium.execute_tool_action("sql", "run_query", {"query": "select 1"}))
print("email:", cronium.send_email("a@x.io", "Subject", "Body", cc=["c@x.io"]))
print("email list:", cronium.send_email(["a@x.io", "b@x.io"], "Subject", "Body"))
print("slack:", cronium.send_slack_message("#ops", "hello", username="bot"))
print("discord:", cronium.send_discord_message("123", "hello", embeds=[{"title": "t"}]))

import cronium as imported
print("import cronium:", imported.get_variable("NUM"))
from cronium import get_variable, set_condition, CroniumError, CroniumAPIError, CroniumTimeoutError, Cronium, AsyncCronium
print("from cronium import:", get_variable("NUM"), issubclass(CroniumAPIError, CroniumError))

if __name__ == "__main__":
    print("running as main")
`

func TestParityPython(t *testing.T) {
	requireTools(t, "python3")
	result := compareRuns(t, types.ScriptTypePython, parityPythonScript)

	for _, want := range []string{
		"string: 'hello world'",
		"number: '42'",
		`object: '{"b":1,"a":[1,2]}'`,
		"unset: None",
		"gone: None",
		"condition: None",
		"rejected a non-boolean",
		"event name: Demo <event>",
		"running as main",
	} {
		if !strings.Contains(result.stdout, want) {
			t.Errorf("stdout is missing %q:\n%s", want, result.stdout)
		}
	}
}

func TestParityPythonFailingScript(t *testing.T) {
	requireTools(t, "python3")
	result := compareRuns(t, types.ScriptTypePython, "import sys\nprint('before')\ncronium.set_condition(True)\nprint('problem', file=sys.stderr)\nsys.exit(4)\n")
	if result.exitCode != 4 {
		t.Errorf("exit code = %d, want 4", result.exitCode)
	}
}

// A container's AsyncCronium needs aiohttp, so this runs only on the runner.
func TestRunnerPythonAsyncCronium(t *testing.T) {
	requireTools(t, "python3")
	result := runOnRunner(t, types.ScriptTypePython, `
import asyncio
from cronium import AsyncCronium

async def main():
    async with AsyncCronium() as client:
        print("input:", (await client.input())["z"])
        print("set:", await client.set_variable("STR", "hello"))
        print("string:", await client.get_variable("STR"))
        print("condition:", await client.set_condition(True))
        print("output:", await client.output({"done": True}))
        await client.close()

asyncio.run(main())
`)
	if result.exitCode != 0 {
		t.Fatalf("exit code = %d\nstderr: %s", result.exitCode, result.stderr)
	}
	want := "input: 1\nset: None\nstring: hello\ncondition: None\noutput: None\n"
	if result.stdout != want {
		t.Errorf("stdout = %q, want %q", result.stdout, want)
	}
	if !strings.Contains(strings.Join(result.requests, "\n"), `POST /executions/exec-parity/condition {"condition":true}`) {
		t.Errorf("no condition request in:\n%s", strings.Join(result.requests, "\n"))
	}
}

const parityNodeScript = `
(async () => {
  console.log("input:", JSON.stringify(await cronium.input()));
  console.log("output:", await cronium.output({ result: "ok", n: 1 }));
  console.log("output text:", await cronium.output("plain text"));

  console.log("set:", await cronium.setVariable("STR", "hello world"));
  console.log("string:", await cronium.getVariable("STR"));
  await cronium.setVariable("NUM", 42);
  console.log("number:", await cronium.getVariable("NUM"));
  await cronium.setVariable("OBJ", { b: 1, a: [1, 2] });
  console.log("object:", await cronium.getVariable("OBJ"));
  await cronium.setVariable("a b/c", "spaced");
  console.log("spaced key:", await cronium.getVariable("a b/c"));
  console.log("unset:", await cronium.getVariable("NOPE"));
  console.log("gone:", await cronium.getVariable("GONE"));

  console.log("condition:", await cronium.setCondition(true));
  console.log("condition:", await cronium.setCondition(false));
  await cronium.setCondition(1).then(
    () => console.log("not rejected"),
    (error) => console.log("rejected a non-boolean:", error instanceof cronium.CroniumError),
  );
  await cronium.setVariable("NULL", null).then(
    () => console.log("not rejected"),
    (error) => console.log("rejected null:", error instanceof cronium.CroniumError),
  );

  const event = await cronium.event();
  console.log("event:", JSON.stringify(event));
  console.log("event name:", event.event.name);

  console.log("tool:", JSON.stringify(await cronium.executeToolAction("sql", "run_query", { query: "select 1" })));
  console.log("email:", JSON.stringify(await cronium.sendEmail({ to: "a@x.io", subject: "Subject", body: "Body", cc: ["c@x.io"] })));
  console.log("email list:", JSON.stringify(await cronium.sendEmail({ to: ["a@x.io", "b@x.io"], subject: "Subject", body: "Body" })));
  console.log("slack:", JSON.stringify(await cronium.sendSlackMessage({ channel: "#ops", text: "hello", username: "bot" })));
  console.log("discord:", JSON.stringify(await cronium.sendDiscordMessage({ channelId: "123", content: "hello", embeds: [{ title: "t" }] })));

  console.log("then:", await cronium.getVariable("NUM").then((value) => "got " + value));
  const pending = cronium.input();
  console.log("returns a promise:", pending instanceof Promise);
  await pending;

  const required = require("cronium");
  console.log("require:", await required.getVariable("NUM"));
  const Cronium = require("cronium");
  console.log("new Cronium():", await new Cronium().getVariable("NUM"));
  console.log("errors:", required.CroniumAPIError.prototype instanceof required.CroniumError, typeof required.CroniumTimeoutError);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`

func TestParityNode(t *testing.T) {
	requireTools(t, "node")
	result := compareRuns(t, types.ScriptTypeNode, parityNodeScript)

	for _, want := range []string{
		"string: hello world",
		"number: 42",
		`object: {"b":1,"a":[1,2]}`,
		"unset: null",
		"gone: null",
		"condition: undefined",
		"rejected a non-boolean: true",
		"event name: Demo <event>",
		"returns a promise: true",
		"new Cronium(): 42",
	} {
		if !strings.Contains(result.stdout, want) {
			t.Errorf("stdout is missing %q:\n%s", want, result.stdout)
		}
	}
}

func TestParityNodeFailingScript(t *testing.T) {
	requireTools(t, "node")
	result := compareRuns(t, types.ScriptTypeNode, "(async () => {\n  console.log('before');\n  await cronium.setCondition(true);\n  console.error('problem');\n  process.exit(5);\n})();\n")
	if result.exitCode != 5 {
		t.Errorf("exit code = %d, want 5", result.exitCode)
	}
}
