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
		{
			name:   "an increment that isn't an integer",
			script: "cronium_increment_variable NOPE\ncronium_increment_variable NOPE abc 2>/dev/null\necho not reached\n",
			stdout: "1\n",
		},
		{
			name:   "a stored value that isn't an integer",
			script: "cronium_set_variable TEXT abc\ncronium_increment_variable TEXT 2>/dev/null\necho not reached\n",
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

// A variable has to read back as the script set it. The container's SDK went by jq, which
// reads 010, +5, .5, inf and nan as numbers and writes them its own way, so they were stored
// as 10, 5, 0.5 and 1.7976931348623157e+308, and nan was refused because jq writes it as null.
// Even a number JSON allows could change, as 1e3 became 1E+3. A remote server's helpers go
// by Go's JSON parser and kept them all, so one script stored different values on each side.
func TestParityBashVariablesReadBackAsSet(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")

	// value is one shell word, and stored is what it should read back as if that isn't the
	// value itself.
	cases := []struct{ value, stored string }{
		// Numbers JSON doesn't allow, which jq reads anyway. They go as strings.
		{value: "010"},
		{value: "09"},
		{value: "00"},
		{value: "-010"},
		{value: "-00"},
		{value: "+5"},
		{value: ".5"},
		{value: "-.5"},
		{value: "5."},
		{value: "1.e3"},
		{value: "nan"},
		{value: "NaN"},
		{value: "-nan"},
		{value: "nan1"},
		{value: "sNaN"},
		{value: "inf"},
		{value: "Infinity"},
		{value: "-Infinity"},
		{value: "' 010 '"},
		{value: "0x10"},
		{value: "1_000"},

		// Numbers JSON allows. They go as written, and the runtime stores that text.
		{value: "0"},
		{value: "-0"},
		{value: "42"},
		{value: "1e3"},
		{value: "1E3"},
		{value: "1e+3"},
		{value: "1E+3"},
		{value: "1e-3"},
		{value: "1.0"},
		{value: "1.50"},
		{value: "0.10"},
		{value: "1e1000"},
		{value: "9007199254740993"},
		{value: "12345678901234567890"},
		{value: "100000000000000000000"},
		{value: "' 42 '", stored: "42"},

		// The same inside a value. The first three aren't JSON, so they stay as typed.
		{value: `'{"a":010}'`},
		{value: `'{"a": 010}'`},
		{value: `'[nan, +5]'`},
		{value: `'{"a": 1e3, "b": [1.50, 2]}'`, stored: `{"a":1e3,"b":[1.50,2]}`},
		{value: `'{"a":1,"a":2}'`},

		// A number in a string, or anything like one, isn't one.
		{value: `'"010"'`, stored: "010"},
		{value: `'{"a":"010, 1e3 or nan"}'`},
		{value: `'{"a":"say \"010\""}'`},
	}

	var script, want strings.Builder
	for i, tc := range cases {
		stored := tc.stored
		if stored == "" {
			stored = strings.Trim(tc.value, "'")
		}
		fmt.Fprintf(&script, "cronium_set_variable V%d %s; echo \"%d rc=$? [$(cronium_get_variable V%d)]\"\n", i, tc.value, i, i)
		fmt.Fprintf(&want, "%d rc=0 [%s]\n", i, stored)
	}

	for _, tc := range []struct{ name, mode string }{
		{"with no strict mode", ""},
		{"under set -euo pipefail", "set -euo pipefail\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compareRuns(t, types.ScriptTypeBash, tc.mode+script.String())
			if result.stdout != want.String() {
				t.Errorf("read back\n%s", lineDiff(want.String(), result.stdout))
			}
			if result.stderr != "" {
				t.Errorf("stderr = %q", result.stderr)
			}
			if !strings.Contains(strings.Join(result.requests, "\n"), `PUT /executions/exec-parity/variables/V0 {"value":"010"}`) {
				t.Errorf("010 wasn't sent as a string:\n%s", strings.Join(result.requests, "\n"))
			}
		})
	}
}

// What a script appends can make a number too, and a bash a script starts has the helpers too.
func TestParityBashAppendsAndChildrenKeepNumbers(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")

	result := compareRuns(t, types.ScriptTypeBash, `cronium_append_variable ZERO 0
cronium_append_variable ZERO 10
echo "zero [$(cronium_get_variable ZERO)]"
cronium_append_variable ONE 1
cronium_append_variable ONE 3 e
echo "one [$(cronium_get_variable ONE)]"
bash -c 'cronium_set_variable CHILD 010'
echo "child [$(cronium_get_variable CHILD)]"
bash -c 'cronium_increment_variable CHILD'
bash -c 'cronium_increment_variable CHILD abc'; echo "child rc=$?"
`)

	want := "zero [010]\none [1e3]\nchild [010]\n11\nchild rc=1\n"
	if result.stdout != want {
		t.Errorf("stdout = %q, want %q", result.stdout, want)
	}
	if want := "Error: Increment 'abc' is not a 64-bit integer, so variable 'CHILD' was not changed\n"; result.stderr != want {
		t.Errorf("stderr = %q, want %q", result.stderr, want)
	}
}

// Output and a tool action's config are the same question: only JSON is sent as JSON. A
// config that isn't JSON worked in a container, with 010 sent as 10 and nan as null, and
// failed on a remote server.
func TestParityBashOutputAndToolConfigGoByJSON(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")

	result := compareRuns(t, types.ScriptTypeBash, `for value in 010 +5 .5 nan inf 42 1.5 '{"a":010}' '{"a":1}'; do
  cronium_output "$value"; echo "output $value rc=$?"
done
for config in '{"n":010}' '[nan]' '{"n":+5}' '1 2' ''; do
  cronium_execute_tool_action sql run_query "$config" 2>&1; echo "tool $config rc=$?"
done
cronium_execute_tool_action sql run_query '{"n":1}' >/dev/null; echo "good config rc=$?"
`)

	requests := strings.Join(result.requests, "\n")
	for _, want := range []string{
		`output {"data":"010"}`,
		`output {"data":"+5"}`,
		`output {"data":".5"}`,
		`output {"data":"nan"}`,
		`output {"data":"inf"}`,
		`output {"data":42}`,
		`output {"data":1.5}`,
		`output {"data":"{\"a\":010}"}`,
		`output {"data":{"a":1}}`,
		`POST /tool-actions/execute {"action":"run_query","config":{"n":1},"tool":"sql"}`,
	} {
		if !strings.Contains(requests, want) {
			t.Errorf("requests are missing %q:\n%s", want, requests)
		}
	}
	if got := strings.Count(requests, "/tool-actions/execute"); got != 1 {
		t.Errorf("%d tool actions sent, want only the good one:\n%s", got, requests)
	}
	if got := strings.Count(result.stdout, "Error: Invalid JSON configuration for tool action\n"); got != 5 {
		t.Errorf("%d configs refused, want 5:\n%s", got, result.stdout)
	}
	if !strings.Contains(result.stdout, "good config rc=0") {
		t.Errorf("stdout:\n%s", result.stdout)
	}
}

// bashJSONCheckCorpus is everything up to two characters from what JSON is made of, then
// what jq reads and JSON doesn't allow, on its own and inside values.
func bashJSONCheckCorpus() []string {
	alphabet := []string{"0", "1", "-", "+", ".", "e", `"`, "[", "]", "{", "}", ":", ",", " ", "\n", "x"}
	corpus := []string{""}
	for _, first := range alphabet {
		corpus = append(corpus, first)
		for _, second := range alphabet {
			corpus = append(corpus, first+second)
		}
	}
	for _, leaf := range []string{
		"0", "-0", "42", "-42", "1.5", "1.50", "0.5", "1e3", "1E3", "1e+3", "1e-3", "1.5E-3", "1e1000",
		"12345678901234567890", "true", "false", "null", `"a"`, `"010"`, `"[1,010]"`, `"a\"b"`, `"a\\"`,
		`"\u00e9"`, `"é✓"`, `"a,b:c"`, `{}`, `[]`, `{"a":{"b":[1,{"c":null}]}}`,

		"010", "00", "01.5", "-010", "-00", "+5", "+0", ".5", "-.5", "5.", "-5.", "1.e3", ".5e3", "1e", "1e+", "--5", "1-",
		"nan", "NaN", "NAN", "-nan", "nan1", "sNaN", "inf", "-inf", "Inf", "Infinity", "-Infinity", "infinity", "True", "NULL",
		"nul", "0x10", "1_000", "'a'", `"a`, `a"`, `"\q"`, "\"a\tb\"", "\"a\nb\"", "1 2", `"a" "b"`, "[1 2]", "[1,]", "[,1]",
		`{"a":1,}`, `{"a" 1}`, `{a:1}`, `{1:2}`, "[1]]", "[[1]", "{", "}", "#", "// x", "é",
	} {
		corpus = append(corpus,
			leaf,
			" "+leaf+" ",
			"\n"+leaf+"\n",
			"["+leaf+"]",
			"[1, "+leaf+"]",
			"["+leaf+",\n1]",
			`{"a":`+leaf+`}`,
			`{"a": [`+leaf+`], "b": "010"}`,
		)
	}
	return corpus
}

// TestBashJSONCheckGoesByTheRunnersRule holds the container's check to what a remote server's
// helpers do with the same text, in helpers.jsonOrString. jq's parser is the reason this
// needs a test: what it accepts has changed between versions, and it isn't what JSON allows.
func TestBashJSONCheckGoesByTheRunnersRule(t *testing.T) {
	requireTools(t, "bash", "jq")

	sdk, err := filepath.Abs(repoPath("apps", "runtime", "runtime-helpers", "bash", "cronium.sh"))
	if err != nil {
		t.Fatalf("failed to resolve the SDK path: %v", err)
	}

	corpus := bashJSONCheckCorpus()
	var values bytes.Buffer
	for _, value := range corpus {
		values.WriteString(value + "\x00")
	}
	cmd := exec.Command("bash", "-c", `source "$1"
while IFS= read -r -d '' value; do
  if _cronium_is_json "$value"; then echo json; else echo text; fi
done`, "bash", sdk)
	cmd.Stdin = &values
	cmd.Dir = t.TempDir()
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("failed to run the check: %v", err)
	}

	verdicts := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(verdicts) != len(corpus) {
		t.Fatalf("%d verdicts for %d values", len(verdicts), len(corpus))
	}
	counts := map[string]int{}
	for i, value := range corpus {
		want := "text"
		if trimmed := bytes.TrimSpace([]byte(value)); len(trimmed) > 0 && json.Valid(trimmed) {
			want = "json"
		}
		counts[want]++
		if verdicts[i] != want {
			t.Errorf("%q is %s in a container and %s on a remote server", value, verdicts[i], want)
		}
	}
	if counts["json"] < 100 || counts["text"] < 100 {
		t.Errorf("corpus has too little of one kind: %v", counts)
	}
}

// incrementCase is one call to cronium_increment_variable.
type incrementCase struct {
	stored string // Nothing stored if empty.
	args   string // Shell words after the key.
	output string // What the call prints, stderr included. KEY stands for its key.
	status int    // A call that fails has to leave stored as it was.
}

func incrementRefused(increment string) string {
	return "Error: Increment '" + increment + "' is not a 64-bit integer, so variable 'KEY' was not changed"
}

const storedRefused = "Error: Variable 'KEY' is not a 64-bit integer, so it was not changed"

// TestParityBashIncrementCountsInDecimal covers what $((current + increment)) did with the text
// it was given, on both sides. A stored 010 was octal and became 9, with status 0 and no
// message, and 09 failed with `value too great for base`. An increment was an expression, so
// abc counted as 0, or ended a `set -u` script, and a[$(command)] ran the command. Past 64
// bits a number wrapped: a stored 99999999999999999999 became 7766279631452241920.
func TestParityBashIncrementCountsInDecimal(t *testing.T) {
	requireTools(t, "bash", "curl", "jq")

	cases := []incrementCase{
		// A stored number counts in decimal, whatever it starts with.
		{stored: "010", output: "11"},
		{stored: "09", output: "10"},
		{stored: "0009", output: "10"},
		{stored: "00", output: "1"},
		{stored: "-010", output: "-9"},
		{stored: "-09", output: "-8"},
		{stored: "-0", output: "1"},
		{stored: "+5", output: "6"},
		{stored: "000000000000000000000000000005", output: "6"},

		// So does an increment.
		{stored: "5", args: "010", output: "15"},
		{stored: "5", args: "09", output: "14"},
		{stored: "5", args: "00", output: "5"},
		{stored: "5", args: "-010", output: "-5"},
		{stored: "5", args: "-09", output: "-4"},
		{stored: "5", args: "+010", output: "15"},
		{stored: "5", args: "+3", output: "8"},
		{stored: "5", args: "-3", output: "2"},
		{stored: "5", args: "0", output: "5"},
		{stored: "5", args: "-0", output: "5"},
		{stored: "010", args: "010", output: "20"},
		{stored: "-010", args: "-010", output: "-20"},
		{stored: "-010", args: "010", output: "0"},

		// A variable with no value starts from 0.
		{output: "1"},
		{args: "010", output: "10"},
		{args: "-010", output: "-10"},

		// An increment that isn't an integer. Each of these changes nothing and returns 1,
		// and most used to work in some way or other.
		{stored: "5", args: "abc", output: incrementRefused("abc"), status: 1},
		{stored: "5", args: "shell_number", output: incrementRefused("shell_number"), status: 1},
		{stored: "5", args: "null", output: incrementRefused("null"), status: 1},
		{stored: "5", args: "''", output: incrementRefused(""), status: 1},
		{stored: "5", args: "' 5'", output: incrementRefused(" 5"), status: 1},
		{stored: "5", args: "'5 '", output: incrementRefused("5 "), status: 1},
		{stored: "5", args: "1.5", output: incrementRefused("1.5"), status: 1},
		{stored: "5", args: "1e3", output: incrementRefused("1e3"), status: 1},
		{stored: "5", args: "0x10", output: incrementRefused("0x10"), status: 1},
		{stored: "5", args: "'2#101'", output: incrementRefused("2#101"), status: 1},
		{stored: "5", args: "1+1", output: incrementRefused("1+1"), status: 1},
		{stored: "5", args: "-", output: incrementRefused("-"), status: 1},
		{stored: "5", args: "+", output: incrementRefused("+"), status: 1},
		{stored: "5", args: "--5", output: incrementRefused("--5"), status: 1},
		{stored: "5", args: "+-5", output: incrementRefused("+-5"), status: 1},
		{stored: "5", args: "'a[$(echo ran > injected)]'", output: incrementRefused("a[$(echo ran > injected)]"), status: 1},

		// A stored value that isn't one.
		{stored: "abc", output: storedRefused, status: 1},
		{stored: "1.5", output: storedRefused, status: 1},
		{stored: "1e3", output: storedRefused, status: 1},
		{stored: "0x10", output: storedRefused, status: 1},
		{stored: " 5", output: storedRefused, status: 1},
		{stored: "-", output: storedRefused, status: 1},
		{stored: "shell_number", output: storedRefused, status: 1},

		// As far as 64 bits go, and no further.
		{stored: "9223372036854775806", output: "9223372036854775807"},
		{stored: "9223372036854775807", output: "Error: Adding 1 to variable 'KEY' goes past 64 bits, so it was not changed", status: 1},
		{stored: "9223372036854775807", args: "-1", output: "9223372036854775806"},
		{stored: "-9223372036854775807", args: "-1", output: "-9223372036854775808"},
		{stored: "-9223372036854775808", args: "1", output: "-9223372036854775807"},
		{stored: "-9223372036854775808", args: "-1", output: "Error: Adding -1 to variable 'KEY' goes past 64 bits, so it was not changed", status: 1},
		{stored: "-1", args: "-9223372036854775808", output: "Error: Adding -9223372036854775808 to variable 'KEY' goes past 64 bits, so it was not changed", status: 1},
		{stored: "0", args: "-9223372036854775808", output: "-9223372036854775808"},
		{stored: "9223372036854775808", output: storedRefused, status: 1},
		{stored: "-9223372036854775809", output: storedRefused, status: 1},
		{stored: "18446744073709551616", output: storedRefused, status: 1},
		{stored: "99999999999999999999", output: storedRefused, status: 1},
		{stored: "5", args: "9223372036854775808", output: incrementRefused("9223372036854775808"), status: 1},
		{stored: "5", args: "18446744073709551616", output: incrementRefused("18446744073709551616"), status: 1},
	}

	script := "shell_number=3\n"
	var want strings.Builder
	for i, tc := range cases {
		key := fmt.Sprintf("V%d", i)
		if tc.stored != "" {
			// As a JSON string, so that this doesn't depend on how a number is stored.
			script += fmt.Sprintf("cronium_set_variable %s '\"%s\"'\n", key, tc.stored)
		}
		script += fmt.Sprintf("out=$(cronium_increment_variable %s %s 2>&1); echo \"%s [$out] rc=$? now [$(cronium_get_variable %s)]\"\n", key, tc.args, key, key)
		after := tc.output
		if tc.status != 0 {
			after = tc.stored
		}
		fmt.Fprintf(&want, "%s [%s] rc=%d now [%s]\n", key, strings.ReplaceAll(tc.output, "KEY", key), tc.status, after)
	}
	script += "if [ -e injected ]; then echo \"an increment ran a command\"; fi\n"

	for _, mode := range []struct{ name, line string }{
		{"with no strict mode", ""},
		{"under set -u", "set -u\n"},
	} {
		t.Run(mode.name, func(t *testing.T) {
			result := compareRuns(t, types.ScriptTypeBash, mode.line+script)

			if result.stdout != want.String() {
				t.Errorf("results\n%s", lineDiff(want.String(), result.stdout))
			}
			if result.stderr != "" {
				t.Errorf("stderr = %q", result.stderr)
			}
			if result.exitCode != 0 {
				t.Errorf("exit code = %d", result.exitCode)
			}

			// A value rewritten as itself would pass the check above, and abc used to do
			// that. So count the writes.
			requests := strings.Join(result.requests, "\n")
			for i, tc := range cases {
				writes := strings.Count(requests, fmt.Sprintf("PUT /executions/exec-parity/variables/V%d ", i))
				wantWrites := 0
				if tc.stored != "" {
					wantWrites++
				}
				if tc.status == 0 {
					wantWrites++
				}
				if writes != wantWrites {
					t.Errorf("V%d (%q, %q): %d writes, want %d", i, tc.stored, tc.args, writes, wantWrites)
				}
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
