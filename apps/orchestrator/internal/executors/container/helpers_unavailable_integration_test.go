//go:build integration

package container

import (
	"context"
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests run bash jobs in the real image, through the production create and run
// paths, with something the SDK needs missing. It's the script that has to run, and each
// helper that has to say why it can't work. cronium.sh used to run `exit 1` as it loaded,
// which ended the job's shell before its first line, and the loader hid the message.
//
// What they check is baked into the image, so build your own and name it in
// CRONIUM_TEST_BASH_IMAGE: see child_bash_integration_test.go.

const (
	noTokenError       = "Error: CRONIUM_EXECUTION_TOKEN environment variable not set"
	noExecutionIDError = "Error: CRONIUM_EXECUTION_ID environment variable not set"
	noCurlError        = "Error: Required command 'curl' not found"
	noJqError          = "Error: Required command 'jq' not found"
)

// withoutToken takes back the token sandboxedJob gave a job, which sends buildEnvironment
// down its path for a job with none: the job gets an empty CRONIUM_EXECUTION_TOKEN.
func withoutToken(e *Executor) func(*types.Job) {
	return func(job *types.Job) {
		e.mu.Lock()
		defer e.mu.Unlock()
		delete(e.tokens, job.ID)
	}
}

// runBashJob runs a bash script as a job, on no network and with no runtime to call.
func runBashJob(t *testing.T, e *Executor, script string, prepare ...func(*types.Job)) jobResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), childBashJobTimeout)
	defer cancel()
	job := sandboxedJob(t, ctx, e, interpreter{scriptType: types.ScriptTypeBash}, script)
	for _, change := range prepare {
		change(job)
	}
	return runJob(t, ctx, e, job)
}

func TestBashJobRunsWithoutATokenInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	tests := []struct {
		name, script string
		exitCode     int
		stdout       []string
		stderr       []string
	}{
		{
			name:   "calling no helper",
			script: `echo "token=[$CRONIUM_EXECUTION_TOKEN]"` + "\n",
			stdout: []string{"token=[]"},
		},
		{
			name:     "ending with its own status",
			script:   "echo ran\nexit 7\n",
			exitCode: 7,
			stdout:   []string{"ran"},
		},
		{
			name:   "going on after a helper fails",
			script: `cronium_output x; echo "rc=$?"` + "\n",
			stdout: []string{"rc=1"},
			stderr: []string{noTokenError},
		},
		{
			name:     "stopping at a helper under set -e",
			script:   "set -e\necho before\ncronium_output x\necho after\n",
			exitCode: 1,
			stdout:   []string{"before"},
			stderr:   []string{noTokenError},
		},
		{
			name:   "reading a helper's output",
			script: `input=$(cronium_input); echo "rc=$? input=[$input]"` + "\n",
			stdout: []string{"rc=1 input=[]"},
			stderr: []string{noTokenError},
		},
		{
			name:   "calling a helper from a bash it starts",
			script: `bash -c 'cronium_output x; echo "rc=$?"'` + "\n",
			stdout: []string{"rc=1"},
			stderr: []string{noTokenError},
		},
		{
			// It inherits the functions but not the SDK's copy of the token, so with
			// nounset on, reading that can't be what ends the shell.
			name:   "calling a helper from a bash it starts under set -u",
			script: `bash -uc 'cronium_input; echo "rc=$?"'` + "\n",
			stdout: []string{"rc=1"},
			stderr: []string{noTokenError},
		},
		{
			name:   "loading the SDK itself",
			script: `source /usr/local/bin/cronium.sh; echo "rc=$?"` + "\n",
			stdout: []string{"rc=0"},
		},
		{
			// Unset rather than empty, and with nounset on, so that reading them can't
			// be what ends the shell.
			name: "loading the SDK with the variables unset under set -eu",
			script: `env -u CRONIUM_EXECUTION_TOKEN -u CRONIUM_EXECUTION_ID bash -euc '
source /usr/local/bin/cronium.sh
echo loaded
cronium_input
echo after
'; echo "rc=$?"` + "\n",
			stdout: []string{"loaded", "rc=1"},
			stderr: []string{noTokenError},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := runBashJob(t, e, tc.script, withoutToken(e))

			assert.Equal(t, tc.exitCode, result.exitCode)
			if tc.exitCode == 0 {
				assert.Equal(t, types.JobStatusCompleted, result.status)
			} else {
				assert.Equal(t, types.JobStatusFailed, result.status)
			}
			assert.Equal(t, tc.stdout, result.stdout)
			assert.Equal(t, tc.stderr, result.stderr)
		})
	}
}

// callEveryHelperScript defines a function that calls every cronium_* function the job
// can see and prints each one's name, status and output. compgen finds them, so a helper
// added later is covered. cronium_info is left out because it makes no request and needs
// nothing, which is what makes it useful here.
const callEveryHelperScript = `call_every_helper() {
  local helper output
  for helper in $(compgen -A function cronium_); do
    [ "$helper" = cronium_info ] && continue
    output=$("$helper" KEY value '{}' 2>&1)
    echo "$helper rc=$? $output"
  done
}
`

// TestHelpersSayWhyTheyCannotWorkInTheSandbox expects the same from every helper, because
// some would otherwise lose the reason. cronium_variable_exists hides what the call under
// it prints, cronium_increment_variable would go on to report a new value, and the ones
// that run jq first would say "Invalid JSON" or "command not found".
func TestHelpersSayWhyTheyCannotWorkInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	tests := []struct {
		name, script string
		message      string
		prepare      []func(*types.Job)
	}{
		{
			name:    "with no token",
			script:  "call_every_helper\n",
			message: noTokenError,
			prepare: []func(*types.Job){withoutToken(e)},
		},
		{
			name:    "with no execution ID",
			script:  "CRONIUM_EXECUTION_ID= call_every_helper\n",
			message: noExecutionIDError,
		},
		{
			name:    "with no curl",
			script:  "mkdir /tmp/tools; ln -s /usr/bin/jq /tmp/tools/\nPATH=/tmp/tools call_every_helper\n",
			message: noCurlError,
		},
		{
			name:    "with no jq",
			script:  "mkdir /tmp/tools; ln -s /usr/bin/curl /tmp/tools/\nPATH=/tmp/tools call_every_helper\n",
			message: noJqError,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			run := runWithFakeRuntime(t, e, callEveryHelperScript+tc.script, tc.prepare...)

			assert.Equal(t, 0, run.exitCode)
			assert.Empty(t, run.stderr)
			assert.Empty(t, run.requests, "a helper that can't work shouldn't try")
			// All of them but cronium_info, which shows that compgen found them.
			require.GreaterOrEqual(t, len(run.stdout), 15, "stdout: %v", run.stdout)
			assert.Contains(t, run.stdout, "cronium_output rc=1 "+tc.message)
			for _, line := range run.stdout {
				helper, outcome, _ := strings.Cut(line, " ")
				assert.Equal(t, "rc=1 "+tc.message, outcome, helper)
			}
		})
	}

	t.Run("cronium_info still answers", func(t *testing.T) {
		result := runBashJob(t, e, "cronium_info\n", withoutToken(e))

		assert.Equal(t, 0, result.exitCode)
		assert.Empty(t, result.stderr)
		assert.Contains(t, result.stdout, "Cronium Bash SDK v2.0.0")
	})
}

// TestBashJobRunsWithoutCurlOrJqInTheSandbox sets PATH the way an event's env var would.
// That reaches this path with no fault anywhere in the orchestrator.
func TestBashJobRunsWithoutCurlOrJqInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	result := runBashJob(t, e, "echo ran\n"+`cronium_output x; echo "rc=$?"`+"\n", func(job *types.Job) {
		job.Execution.Environment = map[string]string{"PATH": "/bin"}
	})

	assert.Equal(t, types.JobStatusCompleted, result.status)
	assert.Equal(t, 0, result.exitCode)
	assert.Equal(t, []string{"ran", "rc=1"}, result.stdout)
	assert.Equal(t, []string{noCurlError}, result.stderr)
}

// TestBashJobRunsInAnImageWithoutTheSDKInTheSandbox covers why the loader shows stderr:
// nothing else tells the job why its helpers aren't there. The Python image stands in for
// an image someone configured for bash jobs. It has bash, but no cronium.sh.
func TestBashJobRunsInAnImageWithoutTheSDKInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)
	e.config.Images = map[string]string{"bash": e.getImageForScript(types.ScriptTypePython)}

	result := runBashJob(t, e, "echo ran\n"+`cronium_output x; echo "rc=$?"`+"\n")

	assert.Equal(t, types.JobStatusCompleted, result.status)
	assert.Equal(t, 0, result.exitCode)
	assert.Equal(t, []string{"ran", "rc=127"}, result.stdout)
	stderr := strings.Join(result.stderr, "\n")
	assert.Contains(t, stderr, "/usr/local/bin/cronium.sh: No such file or directory")
	assert.Contains(t, stderr, "cronium_output: command not found")
}

// TestHealthCheckWithoutATokenInTheSandbox runs the image's HEALTHCHECK as Docker does. A
// container has no token unless it's a job's, and that is no fault in the image, but a
// missing command still is, now that loading the SDK doesn't look for them.
func TestHealthCheckWithoutATokenInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	tests := []struct {
		name, script string
		want         []string
	}{
		{
			name:   "passes",
			script: `/bin/sh -c '/usr/local/bin/healthcheck.sh || exit 1'; echo "rc=$?"` + "\n",
			want:   []string{"Health check passed", "rc=0"},
		},
		{
			name:   "fails with no curl",
			script: `PATH=/bin /bin/sh -c '/usr/local/bin/healthcheck.sh || exit 1'; echo "rc=$?"` + "\n",
			want:   []string{noCurlError, "rc=1"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := runBashJob(t, e, tc.script, withoutToken(e))

			assert.Equal(t, 0, result.exitCode)
			assert.Empty(t, result.stderr)
			assert.Equal(t, tc.want, result.stdout)
		})
	}
}
