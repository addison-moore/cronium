//go:build integration

package container

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// holdingRuntimeScript goes before a job's script, and runHelperCalls points the helpers
// at it. fakeRuntimeScript gives every request the same answer, which can't show what
// happens to a stored value. This stand-in holds variables and answers by route, as the
// runtime does when nothing is wrong. Anything else, a route gets from `answer`.
//
// `try` runs one call in a subshell of its own, under the mode in $strict_mode, with COUNT
// holding 41 and LOG holding first. It prints what the call did as a line of JSON.
const holdingRuntimeScript = `cat > /tmp/runtime.sh <<'RUNTIME'
IFS=' ' read -r method target _
length=0
while IFS= read -r header; do
  header=${header%$'\r'}
  [ -z "$header" ] && break
  case "${header,,}" in content-length:*) length=${header#*: } ;; esac
done
body=
if [ "$length" -gt 0 ]; then
  IFS= read -r -N "$length" body
  body=$(jq -c . <<<"$body")
fi
route=${target#/executions/*/}
echo "$method $route${body:+ $body}" >> /tmp/runtime-requests

reply() {
  printf 'HTTP/1.1 %s X\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s' "$1" "${#2}" "$2"
}

answer="/tmp/runtime-answers/$method ${route//\//_}"
if [ -f "$answer" ]; then
  status=$(sed -n 1p "$answer")
  [ "$status" = drop ] && exit 0
  reply "$status" "$(sed -n '2,$p' "$answer")"
  exit 0
fi

case "$method $route" in
  'GET variables/'*)
    key=${route#variables/}
    if [ -f "/tmp/runtime-vars/$key" ]; then
      reply 200 "$(jq -cn --arg key "$key" --rawfile value "/tmp/runtime-vars/$key" '{success: true, data: {key: $key, value: $value}}')"
    else
      reply 200 "$(jq -cn --arg key "$key" '{success: true, data: {key: $key, value: null}}')"
    fi
    ;;
  'PUT variables/'*)
    if [ "$(jq -r .value <<<"$body")" = null ]; then
      reply 400 '{"error":"Bad Request","message":"variable value must not be null"}'
    else
      jq -j '.value | if type == "string" then . else tojson end' <<<"$body" > "/tmp/runtime-vars/${route#variables/}"
      reply 200 '{"success":true}'
    fi
    ;;
  'GET context') reply 200 '{"success":true,"data":{"name":"Demo","flag":false}}' ;;
  'GET input') reply 200 '{"success":true,"data":{"a":1}}' ;;
  *) reply 200 '{"success":true}' ;;
esac
RUNTIME
mkdir -p /tmp/runtime-answers
nc -lk -p 8082 -e /bin/bash /tmp/runtime.sh &
until curl -s -o /dev/null http://127.0.0.1:8082/ready; do sleep 0.1; done

# answer 'GET variables_COUNT' 500 '{"error":"..."}'. The status can be drop, which hangs up.
answer() { printf '%s\n%s\n' "$2" "$3" > "/tmp/runtime-answers/$1"; }
# Makes every read the tests use answer this.
answer_reads() {
  answer 'GET variables_COUNT' "$1" "$2"
  answer 'GET variables_LOG' "$1" "$2"
  answer 'GET context' "$1" "$2"
  answer 'GET input' "$1" "$2"
}
forget_answers() { rm -f /tmp/runtime-answers/*; }

try() {
  rm -rf /tmp/runtime-vars
  mkdir -p /tmp/runtime-vars
  printf 41 > /tmp/runtime-vars/COUNT
  printf first > /tmp/runtime-vars/LOG
  : > /tmp/runtime-requests
  stdout=$( (eval "$strict_mode"; eval "$1") 2>/tmp/try-stderr )
  status=$?
  stored=$(cd /tmp/runtime-vars && for key in *; do jq -n --arg key "$key" --rawfile value "$key" '{($key): $value}'; done | jq -cs add)
  jq -cn --arg call "$1" --argjson status "$status" --arg stdout "$stdout" --argjson stored "$stored" \
    --rawfile stderr /tmp/try-stderr --rawfile requests /tmp/runtime-requests \
    '{call: $call, status: $status, stdout: $stdout, stored: $stored,
      stderr: ($stderr | split("\n") | map(select(. != ""))),
      requests: ($requests | split("\n") | map(select(. != "")))}'
}
`

// helperCall is what one `try` reports.
type helperCall struct {
	Call     string            `json:"call"`
	Status   int               `json:"status"`
	Stdout   string            `json:"stdout"`
	Stderr   []string          `json:"stderr"`
	Requests []string          `json:"requests"`
	Stored   map[string]string `json:"stored"`
}

// storedAtFirst is what `try` starts a call with.
func storedAtFirst(changes ...string) map[string]string {
	stored := map[string]string{"COUNT": "41", "LOG": "first"}
	for i := 0; i+1 < len(changes); i += 2 {
		stored[changes[i]] = changes[i+1]
	}
	return stored
}

// runHelperCalls runs a script of `try` lines as one job, and returns what each reported.
// An execution ID in an error message comes back as EXEC.
func runHelperCalls(t *testing.T, e *Executor, strictMode, script string) []helperCall {
	t.Helper()
	run := runWithFakeRuntime(t, e, "strict_mode='"+strictMode+"'\n"+holdingRuntimeScript+script, func(job *types.Job) {
		e.runtimeAddrs[job.ID] = "127.0.0.1:8082"
	})

	assert.Empty(t, run.stderr)
	assert.Equal(t, 0, run.exitCode)
	assert.Empty(t, run.requests, "a request reached the other stand-in")
	calls := make([]helperCall, 0, len(run.stdout))
	for _, line := range run.stdout {
		var call helperCall
		require.NoError(t, json.Unmarshal([]byte(strings.ReplaceAll(line, run.executionID, "EXEC")), &call), "line: %s", line)
		if len(call.Stderr) == 0 {
			call.Stderr = nil
		}
		if len(call.Requests) == 0 {
			call.Requests = nil
		}
		calls = append(calls, call)
	}
	return calls
}

// tryLines turns calls into `try` lines. The calls may not hold a single quote.
func tryLines(calls []helperCall) string {
	var script strings.Builder
	for _, call := range calls {
		script.WriteString("try '" + call.Call + "'\n")
	}
	return script.String()
}

// strictModes are what a script might start with. The helpers run in the script's own
// shell, so these apply inside them too. The first is the control.
var strictModes = []struct{ name, mode string }{
	{"with no strict mode", ":"},
	{"under set -u", "set -u"},
	{"under set -euo pipefail", "set -euo pipefail"},
}

// TestHelpersUnderStrictModesInTheSandbox covers a script starting with `set -u`. A GET
// passed _cronium_request two arguments, and the third was read as "$3": the helper died
// without sending anything, and two of them then wrote over the stored value because they
// read it through `|| echo 0`. All of this has to come out the same in every mode.
func TestHelpersUnderStrictModesInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	want := []helperCall{
		{Call: "cronium_input", Stdout: "{\n  \"a\": 1\n}", Requests: []string{"GET input"}, Stored: storedAtFirst()},
		{Call: "cronium_output hello", Requests: []string{`POST output {"data":"hello"}`}, Stored: storedAtFirst()},
		{Call: "cronium_get_variable COUNT", Stdout: "41", Requests: []string{"GET variables/COUNT"}, Stored: storedAtFirst()},
		{Call: "cronium_get_variable NEW", Requests: []string{"GET variables/NEW"}, Stored: storedAtFirst()},
		{
			Call:     "cronium_set_variable NEW value",
			Requests: []string{`PUT variables/NEW {"value":"value"}`},
			Stored:   storedAtFirst("NEW", "value"),
		},
		{Call: "cronium_set_condition true", Requests: []string{`POST condition {"condition":true}`}, Stored: storedAtFirst()},
		{Call: "cronium_event", Stdout: "{\n  \"name\": \"Demo\",\n  \"flag\": false\n}", Requests: []string{"GET context"}, Stored: storedAtFirst()},
		{Call: "cronium_event_field name", Stdout: "Demo", Requests: []string{"GET context"}, Stored: storedAtFirst()},
		{Call: "cronium_event_field flag", Stdout: "false", Requests: []string{"GET context"}, Stored: storedAtFirst()},
		{Call: "cronium_event_field missing", Requests: []string{"GET context"}, Stored: storedAtFirst()},
		{
			Call:     "cronium_execute_tool_action sql run {}",
			Requests: []string{`POST /tool-actions/execute {"tool":"sql","action":"run","config":{}}`},
			Stored:   storedAtFirst(),
		},
		{
			Call:     "cronium_send_email to@example.com subject body --cc cc@example.com --html",
			Requests: []string{`POST /tool-actions/execute {"tool":"email","action":"send_message","config":{"to":["to@example.com"],"subject":"subject","body":"body","cc":["cc@example.com"],"html":true}}`},
			Stored:   storedAtFirst(),
		},
		{
			Call:     "cronium_send_slack_message channel text --username name",
			Requests: []string{`POST /tool-actions/execute {"tool":"slack","action":"send_message","config":{"channel":"channel","text":"text","username":"name"}}`},
			Stored:   storedAtFirst(),
		},
		{
			Call:     "cronium_send_discord_message 123 text --embed {}",
			Requests: []string{`POST /tool-actions/execute {"tool":"discord","action":"send_message","config":{"channelId":"123","content":"text","embeds":[{}]}}`},
			Stored:   storedAtFirst(),
		},
		{Call: "cronium_variable_exists COUNT", Requests: []string{"GET variables/COUNT"}, Stored: storedAtFirst()},
		{Call: "cronium_variable_exists NEW", Status: 1, Requests: []string{"GET variables/NEW"}, Stored: storedAtFirst()},
		{
			Call:     "cronium_increment_variable COUNT",
			Stdout:   "42",
			Requests: []string{"GET variables/COUNT", `PUT variables/COUNT {"value":42}`},
			Stored:   storedAtFirst("COUNT", "42"),
		},
		{
			Call:     "cronium_increment_variable COUNT 5",
			Stdout:   "46",
			Requests: []string{"GET variables/COUNT", `PUT variables/COUNT {"value":46}`},
			Stored:   storedAtFirst("COUNT", "46"),
		},
		{
			Call:     "cronium_increment_variable NEW",
			Stdout:   "1",
			Requests: []string{"GET variables/NEW", `PUT variables/NEW {"value":1}`},
			Stored:   storedAtFirst("NEW", "1"),
		},
		{
			Call:     "cronium_append_variable LOG more ,",
			Requests: []string{"GET variables/LOG", `PUT variables/LOG {"value":"first,more"}`},
			Stored:   storedAtFirst("LOG", "first,more"),
		},
		{
			Call:     "cronium_append_variable LOG more",
			Requests: []string{"GET variables/LOG", `PUT variables/LOG {"value":"firstmore"}`},
			Stored:   storedAtFirst("LOG", "firstmore"),
		},
		{
			Call:     "cronium_append_variable NEW more ,",
			Requests: []string{"GET variables/NEW", `PUT variables/NEW {"value":"more"}`},
			Stored:   storedAtFirst("NEW", "more"),
		},
		{
			Call:     "cronium_delete_variable NEW",
			Status:   1,
			Stderr:   []string{"Error: API request failed - HTTP 400 - variable value must not be null"},
			Requests: []string{`PUT variables/NEW {"value":null}`},
			Stored:   storedAtFirst(),
		},
		{
			Call:   "cronium_info",
			Stdout: "Cronium Bash SDK v2.0.0\nAPI URL: http://127.0.0.1:8082\nExecution ID: EXEC\nToken: " + childBashToken[:10] + "...",
			Stored: storedAtFirst(),
		},
	}

	for _, strict := range strictModes {
		t.Run(strict.name, func(t *testing.T) {
			assert.Equal(t, want, runHelperCalls(t, e, strict.mode, tryLines(want)))
		})
	}

	t.Run("in a child bash started with -u", func(t *testing.T) {
		calls := runHelperCalls(t, e, ":", `try "bash -u -c 'cronium_get_variable COUNT'"
try "bash -u -c 'cronium_increment_variable COUNT'"
try "bash -u -c 'cronium_append_variable LOG more ,'"
try "env -u CRONIUM_EXECUTION_ID bash -u -c cronium_info"
`)
		assert.Equal(t, []helperCall{
			{
				Call:     "bash -u -c 'cronium_get_variable COUNT'",
				Stdout:   "41",
				Requests: []string{"GET variables/COUNT"},
				Stored:   storedAtFirst(),
			},
			{
				Call:     "bash -u -c 'cronium_increment_variable COUNT'",
				Stdout:   "42",
				Requests: []string{"GET variables/COUNT", `PUT variables/COUNT {"value":42}`},
				Stored:   storedAtFirst("COUNT", "42"),
			},
			{
				Call:     "bash -u -c 'cronium_append_variable LOG more ,'",
				Requests: []string{"GET variables/LOG", `PUT variables/LOG {"value":"first,more"}`},
				Stored:   storedAtFirst("LOG", "first,more"),
			},
			{
				// It's how a script finds out what's missing, so it has to work when something is.
				Call:   "env -u CRONIUM_EXECUTION_ID bash -u -c cronium_info",
				Stdout: "Cronium Bash SDK v2.0.0\nAPI URL: http://127.0.0.1:8082\nExecution ID: \nToken: " + childBashToken[:10] + "...",
				Stored: storedAtFirst(),
			},
		}, calls)
	})

	t.Run("with nounset already on as the SDK loads", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `cronium_output x; echo "rc=$?"
echo "[$(cronium_get_variable KEY)] rc=$?"
`, func(job *types.Job) {
			job.Execution.Environment = map[string]string{"SHELLOPTS": "nounset"}
		})

		assert.Empty(t, run.stderr)
		assert.Equal(t, []string{"rc=0", "[from-runtime] rc=0"}, run.stdout)
		assert.Equal(t, 0, run.exitCode)
	})
}

// failedReadCalls are the calls that read something first, with what each must do when the
// read fails after this many tries for this reason. Most of all, Stored must not change.
func failedReadCalls(tries int, reason string) []helperCall {
	repeated := func(request string) []string {
		requests := make([]string, tries)
		for i := range requests {
			requests[i] = request
		}
		return requests
	}
	return []helperCall{
		{
			Call:     "cronium_increment_variable COUNT",
			Status:   1,
			Stderr:   []string{reason, "Error: Could not read variable 'COUNT', so it was not changed"},
			Requests: repeated("GET variables/COUNT"),
			Stored:   storedAtFirst(),
		},
		{
			Call:     "cronium_append_variable LOG more ,",
			Status:   1,
			Stderr:   []string{reason, "Error: Could not read variable 'LOG', so it was not changed"},
			Requests: repeated("GET variables/LOG"),
			Stored:   storedAtFirst(),
		},
		{
			Call:     "cronium_variable_exists COUNT",
			Status:   2,
			Stderr:   []string{reason, "Error: Could not tell whether variable 'COUNT' exists"},
			Requests: repeated("GET variables/COUNT"),
			Stored:   storedAtFirst(),
		},
		{Call: "cronium_get_variable COUNT", Status: 1, Stderr: []string{reason}, Requests: repeated("GET variables/COUNT"), Stored: storedAtFirst()},
		{Call: "cronium_event_field name", Status: 1, Stderr: []string{reason}, Requests: repeated("GET context"), Stored: storedAtFirst()},
		{Call: "cronium_event", Status: 1, Stderr: []string{reason}, Requests: repeated("GET context"), Stored: storedAtFirst()},
		{Call: "cronium_input", Status: 1, Stderr: []string{reason}, Requests: repeated("GET input"), Stored: storedAtFirst()},
	}
}

// TestFailedReadsLeaveStoredValuesAloneInTheSandbox covers the other way to the same loss,
// with no `set -u` needed: cronium_increment_variable read through `|| echo 0` and
// cronium_append_variable through `|| echo ""`, so any failed read looked like a variable
// with no value. A stored 41 became 1, and a stored value was replaced, with status 0 and
// nothing on stderr.
func TestFailedReadsLeaveStoredValuesAloneInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	answers := []struct {
		name, status, body string
		tries              int
		reason             string
	}{
		{
			name:   "a 500, after three tries",
			status: "500",
			body:   `{"error":"Internal Server Error","message":"failed to get variable"}`,
			tries:  3,
			reason: "Error: API request failed - HTTP 500 - failed to get variable",
		},
		{
			name:   "a 401",
			status: "401",
			body:   `{"error":"Unauthorized","message":"missing or invalid execution token"}`,
			tries:  1,
			reason: "Error: API request failed - HTTP 401 - missing or invalid execution token",
		},
		{name: "a 200 that isn't JSON", status: "200", body: "<html>", tries: 1, reason: "Error: API request failed - HTTP 200 - no body"},
		{name: "an empty 200", status: "200", body: "", tries: 1, reason: "Error: API request failed - HTTP 200 - no body"},
		{
			name:   "a 200 saying it failed",
			status: "200",
			body:   `{"success":false,"error":"it failed"}`,
			tries:  1,
			reason: "Error: API request failed - HTTP 200 - it failed",
		},
	}

	var script strings.Builder
	var want []helperCall
	for _, answer := range answers {
		calls := failedReadCalls(answer.tries, answer.reason)
		script.WriteString("answer_reads '" + answer.status + "' '" + answer.body + "'\n" + tryLines(calls))
		want = append(want, calls...)
	}

	for _, strict := range strictModes {
		t.Run(strict.name, func(t *testing.T) {
			assert.Equal(t, want, runHelperCalls(t, e, strict.mode, script.String()))
		})
	}

	t.Run("a dropped connection", func(t *testing.T) {
		calls := runHelperCalls(t, e, ":", `answer 'GET variables_COUNT' drop ''
try 'cronium_increment_variable COUNT'
`)
		require.Len(t, calls, 1)
		assert.Equal(t, 1, calls[0].Status)
		assert.Empty(t, calls[0].Stdout)
		assert.Equal(t, storedAtFirst(), calls[0].Stored)
		assert.Equal(t, []string{"GET variables/COUNT", "GET variables/COUNT", "GET variables/COUNT"}, calls[0].Requests)
		require.Len(t, calls[0].Stderr, 2)
		assert.Contains(t, calls[0].Stderr[0], "Error: Request failed after 3 attempts")
	})

	t.Run("a 404 still means there is no such variable, and only for a variable", func(t *testing.T) {
		notFound := `{"error":"Not Found","message":"Variable not found"}`
		calls := runHelperCalls(t, e, ":", `answer 'GET variables_COUNT' 404 '`+notFound+`'
answer 'GET context' 404 '`+notFound+`'
answer 'GET input' 404 '`+notFound+`'
try 'cronium_get_variable COUNT'
try 'cronium_increment_variable COUNT'
try 'cronium_input'
try 'cronium_event'
try 'cronium_event_field name'
`)
		reason := []string{"Error: API request failed - HTTP 404 - Variable not found"}
		assert.Equal(t, []helperCall{
			{Call: "cronium_get_variable COUNT", Requests: []string{"GET variables/COUNT"}, Stored: storedAtFirst()},
			{
				Call:     "cronium_increment_variable COUNT",
				Stdout:   "1",
				Requests: []string{"GET variables/COUNT", `PUT variables/COUNT {"value":1}`},
				Stored:   storedAtFirst("COUNT", "1"),
			},
			{Call: "cronium_input", Status: 1, Stderr: reason, Requests: []string{"GET input"}, Stored: storedAtFirst()},
			{Call: "cronium_event", Status: 1, Stderr: reason, Requests: []string{"GET context"}, Stored: storedAtFirst()},
			{Call: "cronium_event_field name", Status: 1, Stderr: reason, Requests: []string{"GET context"}, Stored: storedAtFirst()},
		}, calls)
	})
}

// TestFailedWritesAreReportedInTheSandbox covers the second half of those helpers.
// cronium_increment_variable printed the new value and returned 0 even when it couldn't
// store it, so a script went on with a number that was never saved.
func TestFailedWritesAreReportedInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	reason := []string{"Error: API request failed - HTTP 403 - nope"}
	want := []helperCall{
		{
			Call:     "cronium_increment_variable COUNT",
			Status:   1,
			Stderr:   reason,
			Requests: []string{"GET variables/COUNT", `PUT variables/COUNT {"value":42}`},
			Stored:   storedAtFirst(),
		},
		{
			Call:     "cronium_append_variable LOG more ,",
			Status:   1,
			Stderr:   reason,
			Requests: []string{"GET variables/LOG", `PUT variables/LOG {"value":"first,more"}`},
			Stored:   storedAtFirst(),
		},
	}
	script := `answer 'PUT variables_COUNT' 403 '{"message":"nope"}'
answer 'PUT variables_LOG' 403 '{"message":"nope"}'
` + tryLines(want)

	for _, strict := range strictModes {
		t.Run(strict.name, func(t *testing.T) {
			assert.Equal(t, want, runHelperCalls(t, e, strict.mode, script))
		})
	}
}

// TestRetriesUnderSetEInTheSandbox covers a helper that calls _cronium_request directly,
// rather than in $(...), which is every one that writes. Under `set -e` a refused
// connection ended the script at the curl line: status 7, no retry and no message, where a
// remote server's helpers retry. A sidecar restarting was enough.
func TestRetriesUnderSetEInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	calls := runHelperCalls(t, e, "set -euo pipefail", `export CRONIUM_RUNTIME_API=http://127.0.0.1:1
try 'cronium_output x'
try 'cronium_set_variable NEW value'
try 'cronium_set_condition true'
try 'cronium_get_variable COUNT'
try 'cronium_increment_variable COUNT'
`)

	refused := func(route string) []string {
		return []string{"Error: Request failed after 3 attempts (curl exit 7, http_code 000, url http://127.0.0.1:1" + route + ")"}
	}
	assert.Equal(t, []helperCall{
		{Call: "cronium_output x", Status: 1, Stderr: refused("/executions/EXEC/output"), Stored: storedAtFirst()},
		{Call: "cronium_set_variable NEW value", Status: 1, Stderr: refused("/executions/EXEC/variables/NEW"), Stored: storedAtFirst()},
		{Call: "cronium_set_condition true", Status: 1, Stderr: refused("/executions/EXEC/condition"), Stored: storedAtFirst()},
		{Call: "cronium_get_variable COUNT", Status: 1, Stderr: refused("/executions/EXEC/variables/COUNT"), Stored: storedAtFirst()},
		{
			Call:   "cronium_increment_variable COUNT",
			Status: 1,
			Stderr: append(refused("/executions/EXEC/variables/COUNT"), "Error: Could not read variable 'COUNT', so it was not changed"),
			Stored: storedAtFirst(),
		},
	}, calls)
}
