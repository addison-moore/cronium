//go:build integration

package container

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests run bash jobs in the real image, through the production create and run
// paths. What they check is in cronium.sh, which is baked into the image, so an image
// built before a change to that file gives a misleading result. The default tag is shared
// by every checkout on a machine: build your own and name it in CRONIUM_TEST_BASH_IMAGE.

const (
	// The token sandboxedJob gives a job.
	childBashToken = "test-token"
	// Per job, not per test: the tests below run several, and a busy daemon takes a while.
	childBashJobTimeout = 8 * time.Minute
)

// fakeRuntimeScript goes before a job's script. It starts a stand-in for the runtime
// sidecar on loopback, the only network these jobs have, which records each request and
// gives them all the same answer. nc takes one connection at a time, so a helper can
// arrive between two. It then retries, as it would for a sidecar that's still starting.
const fakeRuntimeScript = `fake_runtime_body='{"data":{"value":"from-runtime"}}'
while :; do
  echo '--- request' >> /tmp/requests
  printf 'HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s' "${#fake_runtime_body}" "$fake_runtime_body" |
    nc -l -p 8081 >> /tmp/requests
  echo >> /tmp/requests
done &
`

// fakeRuntimeReportScript goes after a job's script, and prints what the stand-in
// recorded. Its own request is what makes that complete: nc takes one connection at a
// time, so once this one is answered, everything before it has been written down.
const fakeRuntimeReportScript = `
until curl -s -o /dev/null http://127.0.0.1:8081/end-of-script; do sleep 0.1; done
echo '--- recorded'
cat /tmp/requests
`

// fakeRuntimeRun is what a job reported, with the requests it made taken out of stdout.
type fakeRuntimeRun struct {
	jobResult
	requests    []string
	executionID string
}

// routes returns the first line of each request.
func (r fakeRuntimeRun) routes() []string {
	routes := make([]string, 0, len(r.requests))
	for _, request := range r.requests {
		route, _, _ := strings.Cut(request, "\n")
		routes = append(routes, route)
	}
	return routes
}

// childBashSandbox is the production sandbox, using the bash image CRONIUM_TEST_BASH_IMAGE
// names, if it names one.
func childBashSandbox(t *testing.T) *Executor {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), childBashJobTimeout)
	defer cancel()
	e := sandboxExecutor(t, ctx)
	e.runtimeAddrs = make(map[string]string)
	if image := os.Getenv("CRONIUM_TEST_BASH_IMAGE"); image != "" {
		e.config.Images = map[string]string{"bash": image}
	}
	return e
}

// runWithFakeRuntime runs a bash script as a job on no network, with the environment a
// real job gets, pointed at the stand-in for the runtime.
func runWithFakeRuntime(t *testing.T, e *Executor, script string) fakeRuntimeRun {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), childBashJobTimeout)
	defer cancel()
	job := sandboxedJob(t, ctx, e, interpreter{scriptType: types.ScriptTypeBash}, fakeRuntimeScript+script+fakeRuntimeReportScript)
	e.runtimeAddrs[job.ID] = "127.0.0.1:8081"
	run := fakeRuntimeRun{jobResult: runJob(t, ctx, e, job), executionID: e.executionIDs[job.ID]}

	stdout := run.stdout
	report := -1
	for i, line := range stdout {
		if line == "--- recorded" {
			report = i
		}
	}
	require.GreaterOrEqual(t, report, 0, "the job did not reach its report\nstdout: %v\nstderr: %v", stdout, run.stderr)
	run.stdout = stdout[:report]
	for _, request := range strings.Split(strings.Join(stdout[report+1:], "\n"), "--- request\n") {
		request = strings.TrimSpace(request)
		if strings.HasPrefix(request, "GET /end-of-script ") {
			break
		}
		if request != "" {
			run.requests = append(run.requests, request)
		}
	}
	return run
}

// TestChildBashCanCallHelpersInTheSandbox covers the promise that the helpers are there
// without any loading, in a bash the job's script starts as well as in the script. A
// child has always inherited the functions, because cronium.sh exports them. It used to
// lack the plain shell variables they read, so each call failed before making a request.
func TestChildBashCanCallHelpersInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	t.Run("it sends what the script itself would", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `cronium_output '{"n":1}'; echo "script rc=$?"
bash -c 'cronium_output "{\"n\":1}"; echo "child rc=$?"'
`)

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{"script rc=0", "child rc=0"}, run.stdout)
		require.Len(t, run.requests, 2)
		assert.Equal(t, run.requests[0], run.requests[1])
		assert.Contains(t, run.requests[1], "POST /executions/"+run.executionID+"/output HTTP/1.1")
		assert.Contains(t, run.requests[1], "Authorization: Bearer "+childBashToken)
	})

	t.Run("each route the helpers use", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `bash -c '
cronium_input
cronium_output x
cronium_get_variable KEY
cronium_set_variable KEY value
cronium_set_condition true
cronium_event
cronium_execute_tool_action sql run "{}"
'
`)

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Contains(t, run.stdout, "from-runtime")
		root := "/executions/" + run.executionID
		assert.Equal(t, []string{
			"GET " + root + "/input HTTP/1.1",
			"POST " + root + "/output HTTP/1.1",
			"GET " + root + "/variables/KEY HTTP/1.1",
			"PUT " + root + "/variables/KEY HTTP/1.1",
			"POST " + root + "/condition HTTP/1.1",
			"GET " + root + "/context HTTP/1.1",
			"POST /tool-actions/execute HTTP/1.1",
		}, run.routes())
		for _, request := range run.requests {
			assert.Contains(t, request, "Authorization: Bearer "+childBashToken)
		}
	})

	t.Run("a script file started through sh", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `printf '%s\n' 'cronium_set_variable KEY value; echo "rc=$?"' > /tmp/child.sh
sh -c 'bash /tmp/child.sh'
`)

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{"rc=0"}, run.stdout)
		assert.Equal(t, []string{"PUT /executions/" + run.executionID + "/variables/KEY HTTP/1.1"}, run.routes())
	})

	t.Run("cronium_info", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, "bash -c cronium_info\n")

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{
			"Cronium Bash SDK v2.0.0",
			"API URL: http://127.0.0.1:8081",
			"Execution ID: " + run.executionID,
			"Token: " + childBashToken[:10] + "...",
		}, run.stdout)
	})
}

// TestChildBashStartsUntouchedInTheSandbox covers why a child gets the helpers by
// inheriting them and not through BASH_ENV: nothing of the SDK runs when it starts. Run
// at that point, cronium.sh ends a child with no token or no curl, overwrites variables
// the child was given, and writes the token into a `bash -x` trace.
func TestChildBashStartsUntouchedInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	tests := []struct {
		name, script string
		want         []string
	}{
		{
			name:   "with the token and execution ID removed",
			script: "env -u CRONIUM_EXECUTION_TOKEN -u CRONIUM_EXECUTION_ID bash -c 'echo ran'\n",
			want:   []string{"ran"},
		},
		{
			name:   "with no curl or jq on its PATH",
			script: "PATH=/nonexistent /bin/bash -c 'echo ran'\n",
			want:   []string{"ran"},
		},
		{
			name:   "with variables named like the SDK's",
			script: `cmd=mine MAX_RETRIES=7 RETRY_DELAY=9 bash -c 'echo "$cmd $MAX_RETRIES $RETRY_DELAY"'` + "\n",
			want:   []string{"mine 7 9"},
		},
		{
			name:   "under a trace",
			script: "bash -x -c 'echo mine' 2>&1\n",
			want:   []string{"+ echo mine", "mine"},
		},
		{
			// The image's HEALTHCHECK, as Docker runs it.
			name:   "as the image's health check",
			script: `/bin/sh -c '/usr/local/bin/healthcheck.sh || exit 1'; echo "rc=$?"` + "\n",
			want:   []string{"Health check passed", "rc=0"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			run := runWithFakeRuntime(t, e, tc.script)

			assert.Empty(t, run.stderr)
			assert.Equal(t, 0, run.exitCode)
			assert.Equal(t, tc.want, run.stdout)
			assert.Empty(t, run.requests)
		})
	}
}

// TestChildBashGetsNoCopyOfTheTokenInTheSandbox covers why the functions read the
// environment, where exporting cronium.sh's own variables would have been simpler: a
// script can keep the token from what it runs, and has to be able to go on doing so.
func TestChildBashGetsNoCopyOfTheTokenInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	t.Run("started without it", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `env -u CRONIUM_EXECUTION_TOKEN bash -c 'env; cronium_output x; echo "rc=$?"'
`)

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.NotContains(t, strings.Join(run.stdout, "\n"), childBashToken)
		require.Len(t, run.requests, 1)
		assert.NotContains(t, run.requests[0], childBashToken)
	})

	t.Run("the script unset it, and can still call helpers", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `unset CRONIUM_EXECUTION_TOKEN
bash -c 'env'
cronium_output x; echo "rc=$?"
`)

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.NotContains(t, strings.Join(run.stdout, "\n"), childBashToken)
		assert.Contains(t, run.stdout, "rc=0")
		require.Len(t, run.requests, 1)
		assert.Contains(t, run.requests[0], "Authorization: Bearer "+childBashToken)
	})
}

// TestHelpersIgnoreAScriptsOwnVariablesInTheSandbox covers names common enough for a
// script to use itself. The helpers used to read these as their own settings.
func TestHelpersIgnoreAScriptsOwnVariablesInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	run := runWithFakeRuntime(t, e, `MAX_RETRIES=none RETRY_DELAY=none
cronium_output x; echo "rc=$?"
`)

	assert.Empty(t, run.stderr)
	assert.Equal(t, 0, run.exitCode)
	assert.Equal(t, []string{"rc=0"}, run.stdout)
	assert.Len(t, run.requests, 1)
}
