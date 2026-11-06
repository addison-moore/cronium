//go:build integration

package container

import (
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests cover what loading cronium.sh does to a job's variables. They run on the
// helpers in child_bash_integration_test.go, so they take the image from
// CRONIUM_TEST_BASH_IMAGE too.

// sdkNamedEnv holds env vars named as cronium.sh's own variables used to be. An event can
// reasonably use any of them: the REST docs use $CRONIUM_TOKEN for an API token.
var sdkNamedEnv = map[string]string{
	"CRONIUM_TOKEN":   "my-api-token",
	"CRONIUM_API":     "https://cronium.example.com/api",
	"CRONIUM_EXEC_ID": "my-execution",
	"cmd":             "mine",
}

const (
	// A bash command that prints sdkNamedEnv, and what it should print.
	printSDKNamedEnv  = `echo "$CRONIUM_TOKEN $CRONIUM_API $CRONIUM_EXEC_ID $cmd"`
	sdkNamedEnvValues = "my-api-token https://cronium.example.com/api my-execution mine"
)

// withEventEnv gives a job env vars, the way an event does.
func withEventEnv(env map[string]string) func(*types.Job) {
	return func(job *types.Job) {
		job.Execution.Environment = env
	}
}

// TestSDKKeepsAnEventsEnvVarsInTheSandbox covers names cronium.sh used to assign as it
// loaded. A variable from the environment stays exported when assigned, so the new value
// also reached everything the script ran, and for CRONIUM_TOKEN that was the execution
// token.
func TestSDKKeepsAnEventsEnvVarsInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	t.Run("in the script and what it runs", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, printSDKNamedEnv+`
bash -c '`+printSDKNamedEnv+`'
sh -c '`+printSDKNamedEnv+`'
`, withEventEnv(sdkNamedEnv))

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{sdkNamedEnvValues, sdkNamedEnvValues, sdkNamedEnvValues}, run.stdout)
	})

	t.Run("while the helpers use the execution's own settings", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `cronium_output x; echo "script rc=$?"
bash -c 'cronium_output x; echo "child rc=$?"'
cronium_info
`, withEventEnv(sdkNamedEnv))

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{
			"script rc=0",
			"child rc=0",
			"Cronium Bash SDK v2.0.0",
			"API URL: http://127.0.0.1:8081",
			"Execution ID: " + run.executionID,
			"Token: " + childBashToken[:10] + "...",
		}, run.stdout)
		require.Len(t, run.requests, 2)
		for _, request := range run.requests {
			assert.Contains(t, request, "POST /executions/"+run.executionID+"/output HTTP/1.1")
			assert.Contains(t, request, "Authorization: Bearer "+childBashToken)
		}
	})

	t.Run("and env -u leaves the token out of what the script runs", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, "env -u CRONIUM_EXECUTION_TOKEN env\n", withEventEnv(sdkNamedEnv))

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Contains(t, run.stdout, "CRONIUM_TOKEN=my-api-token")
		assert.NotContains(t, strings.Join(run.stdout, "\n"), childBashToken)
	})
}

// TestSDKTokenCopyStaysPrivateInTheSandbox covers the one variable cronium.sh still keeps,
// so that a script can unset CRONIUM_EXECUTION_TOKEN and go on calling helpers.
func TestSDKTokenCopyStaysPrivateInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	t.Run("a script that unset the token sends its own copy, not the event's CRONIUM_TOKEN", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `unset CRONIUM_EXECUTION_TOKEN
cronium_output x; echo "rc=$?"
cronium_info | grep Token
`, withEventEnv(sdkNamedEnv))

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{"rc=0", "Token: " + childBashToken[:10] + "..."}, run.stdout)
		require.Len(t, run.requests, 1)
		assert.Contains(t, run.requests[0], "Authorization: Bearer "+childBashToken)
	})

	// An API token must not reach the runtime just because a helper had nothing else to send.
	t.Run("a child started without the token sends neither it nor the event's CRONIUM_TOKEN", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, "env -u CRONIUM_EXECUTION_TOKEN bash -c 'cronium_output x'\n", withEventEnv(sdkNamedEnv))

		assert.Equal(t, 0, run.exitCode)
		requests := strings.Join(run.requests, "\n")
		assert.NotContains(t, requests, childBashToken)
		assert.NotContains(t, requests, "my-api-token")
	})

	// A variable from the environment stays exported when assigned, so this name has to be
	// unexported on purpose.
	t.Run("an event's variable of the same name doesn't export it", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `env -u CRONIUM_EXECUTION_TOKEN env
unset CRONIUM_EXECUTION_TOKEN
cronium_output x; echo "rc=$?"
`, withEventEnv(map[string]string{"_cronium_token": "event-value"}))

		assert.Empty(t, run.stderr)
		assert.Equal(t, 0, run.exitCode)
		assert.NotContains(t, strings.Join(run.stdout, "\n"), childBashToken)
		assert.Contains(t, run.stdout, "rc=0")
		require.Len(t, run.requests, 1)
		assert.Contains(t, run.requests[0], "Authorization: Bearer "+childBashToken)
	})

	t.Run("a child under set -u started without the token isn't stopped by the missing copy", func(t *testing.T) {
		run := runWithFakeRuntime(t, e, `env -u CRONIUM_EXECUTION_TOKEN bash -c 'set -u
cronium_output x; echo "output returned"
cronium_info > /dev/null; echo "info returned"'
`)

		assert.NotContains(t, strings.Join(run.stderr, "\n"), "unbound variable")
		assert.Equal(t, 0, run.exitCode)
		assert.Equal(t, []string{"output returned", "info returned"}, run.stdout)
	})
}

// TestLoadingTheSDKAddsOnlyItsTokenCopyInTheSandbox measures what loading changes, by
// loading it again in a bash that hasn't. So a new variable at the top of cronium.sh fails
// here, whatever it's called. The bash gets its variables on its own command line, because
// the job's loader has already run by the time this script does, and the bash would
// inherit anything that overwrote.
func TestLoadingTheSDKAddsOnlyItsTokenCopyInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	const measure = `bash -c '
exports= names=
exports=$(export -p)
names=$(compgen -v)
source /usr/local/bin/cronium.sh
[ "$(export -p)" = "$exports" ] && echo "environment unchanged"
comm -13 <(sort <<<"$names") <(compgen -v | sort)
'
`
	tests := []struct{ name, variables string }{
		{name: "for a bash with no variables of its own"},
		{
			name:      "for a bash with variables named like the SDK's old ones",
			variables: "CRONIUM_TOKEN=mine CRONIUM_API=mine CRONIUM_EXEC_ID=mine cmd=mine ",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			run := runWithFakeRuntime(t, e, tc.variables+measure)

			assert.Empty(t, run.stderr)
			assert.Equal(t, 0, run.exitCode)
			assert.Equal(t, []string{"environment unchanged", "_cronium_token"}, run.stdout)
		})
	}
}

// TestHelpersAddNoVariablesInTheSandbox holds the helpers to the same promise. They run in
// the script's own shell, so a variable that isn't local stays behind in it. BASH_REMATCH
// is the shell's own, set by the =~ in cronium_increment_variable.
func TestHelpersAddNoVariablesInTheSandbox(t *testing.T) {
	e := childBashSandbox(t)

	run := runWithFakeRuntime(t, e, `names=
names=$(compgen -v)
{
  cronium_input
  cronium_output x
  cronium_get_variable KEY
  cronium_set_variable KEY value
  cronium_set_condition true
  cronium_event
  cronium_event_field name
  cronium_execute_tool_action sql run "{}"
  cronium_send_email to@example.com subject body --cc cc@example.com --bcc bcc@example.com --html
  cronium_send_slack_message channel text --username name --icon-emoji :x: --icon-url http://example.com
  cronium_send_discord_message channel text --embed "{}"
  cronium_variable_exists KEY
  cronium_delete_variable KEY
  cronium_increment_variable KEY
  cronium_append_variable KEY value
  cronium_info
} > /dev/null 2>&1
comm -13 <(sort <<<"$names") <(compgen -v | grep -v '^BASH_REMATCH$' | sort)
echo finished
`)

	assert.Empty(t, run.stderr)
	assert.Equal(t, 0, run.exitCode)
	assert.Equal(t, []string{"finished"}, run.stdout)
	assert.NotEmpty(t, run.requests)
}
