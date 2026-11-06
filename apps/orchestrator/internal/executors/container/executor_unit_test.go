package container

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus/hooks/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newUnitExecutor builds an Executor for non-Docker unit tests (no daemon, no
// API client).
func newUnitExecutor() *Executor {
	log, _ := test.NewNullLogger()
	e := &Executor{
		log: log,
		config: config.ContainerConfig{
			Runtime: config.RuntimeConfig{JWTSecret: "unit-test-secret"},
		},
		containers:   make(map[string]string),
		sidecars:     make(map[string]string),
		networks:     make(map[string]string),
		tokens:       make(map[string]string),
		executionIDs: make(map[string]string),
		leftovers:    make(map[string]jobResources),
		handOver:     make(map[string]bool),
		holds:        make(map[string]*resultHold),
	}
	e.sidecar = NewSidecarManager(e, log)
	return e
}

func scriptJob(scriptType types.ScriptType) *types.Job {
	return &types.Job{
		ID:   "job-1",
		Type: types.JobTypeContainer,
		Execution: types.ExecutionConfig{
			Script: &types.Script{Type: scriptType, Content: "echo hi"},
		},
	}
}

func TestExecutorType(t *testing.T) {
	assert.Equal(t, types.JobTypeContainer, newUnitExecutor().Type())
}

func TestValidate(t *testing.T) {
	e := newUnitExecutor()

	// Missing script configuration.
	err := e.Validate(&types.Job{ID: "job-1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing script configuration")

	// All supported script types pass.
	for _, st := range []types.ScriptType{types.ScriptTypeBash, types.ScriptTypePython, types.ScriptTypeNode} {
		assert.NoError(t, e.Validate(scriptJob(st)), "type %s must validate", st)
	}

	// Unsupported script type is rejected.
	err = e.Validate(scriptJob("RUBY"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported script type")
}

func TestGetImageForScript(t *testing.T) {
	e := newUnitExecutor()

	// Defaults when nothing configured.
	assert.Equal(t, "cronium/runner:bash-alpine", e.getImageForScript(types.ScriptTypeBash))
	assert.Equal(t, "cronium/runner:python-alpine", e.getImageForScript(types.ScriptTypePython))
	assert.Equal(t, "cronium/runner:node-alpine", e.getImageForScript(types.ScriptTypeNode))

	// Configured images win; the lookup key is the lowercased script type.
	e.config.Images = map[string]string{
		"bash":   "custom/bash:1",
		"python": "", // empty value falls back to the default
	}
	assert.Equal(t, "custom/bash:1", e.getImageForScript(types.ScriptTypeBash))
	assert.Equal(t, "cronium/runner:python-alpine", e.getImageForScript(types.ScriptTypePython))

	// Unknown type: ultimate fallback.
	assert.Equal(t, "cronium/runner:bash-alpine", e.getImageForScript("RUBY"))
}

func TestBuildEnvironment(t *testing.T) {
	e := newUnitExecutor()
	job := scriptJob(types.ScriptTypeBash)
	job.Execution.Environment = map[string]string{"FOO": "bar", "BAZ": "qux"}

	e.executionIDs[job.ID] = "exec_job-1_1234"
	e.sidecar.storeExecutionToken(job.ID, "jwt-token-here")

	env := e.buildEnvironment(job)

	for _, want := range []string{
		"FOO=bar",
		"BAZ=qux",
		"CRONIUM_JOB_ID=job-1",
		"CRONIUM_JOB_TYPE=container",
		"CRONIUM_EXECUTION_MODE=container",
		"CRONIUM_EXECUTION_ID=exec_job-1_1234",
		"CRONIUM_EXECUTION_TOKEN=jwt-token-here",
		"CRONIUM_RUNTIME_API=http://runtime-api:8081",
	} {
		assert.Contains(t, env, want)
	}
}

func TestBuildEnvironment_MissingTokenAndExecutionID(t *testing.T) {
	e := newUnitExecutor()
	job := scriptJob(types.ScriptTypeBash)

	env := e.buildEnvironment(job)

	// No stored token: the variable is exported empty (auth will fail loudly).
	assert.Contains(t, env, "CRONIUM_EXECUTION_TOKEN=")

	// No stored execution ID: a fallback exec_<jobID>_<ts> id is generated.
	found := false
	for _, kv := range env {
		if strings.HasPrefix(kv, "CRONIUM_EXECUTION_ID=exec_job-1_") {
			found = true
		}
	}
	assert.True(t, found, "expected fallback execution id, env: %v", env)
}

func TestParseMemory(t *testing.T) {
	tests := []struct {
		in      string
		want    int64
		wantErr bool
	}{
		{"512MB", 512 * 1024 * 1024, false},
		{"1GB", 1024 * 1024 * 1024, false},
		{"1.5GB", 1610612736, false},
		{"100KB", 100 * 1024, false},
		{"123B", 123, false},
		{"2048", 2048, false},                // raw number = bytes
		{"512mb", 512 * 1024 * 1024, false},  // case-insensitive
		{" 1GB ", 1024 * 1024 * 1024, false}, // whitespace trimmed
		{"", 0, true},
		{"abcMB", 0, true},
		{"12TB", 0, true}, // TB unsupported: "12T" fails to parse
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := parseMemory(tc.in)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestBuildSecurityOptions(t *testing.T) {
	e := newUnitExecutor()

	// Nothing configured: no options (Docker defaults apply).
	assert.Empty(t, e.buildSecurityOptions())

	// "default" seccomp is intentionally NOT passed through (Docker's built-in
	// default profile applies); no-new-privileges is added when enabled.
	e.config.Security = config.ContainerSecurityConfig{
		NoNewPrivileges: true,
		SeccompProfile:  "default",
	}
	assert.Equal(t, []string{"no-new-privileges"}, e.buildSecurityOptions())

	// Named seccomp and AppArmor profiles are passed through.
	e.config.Security = config.ContainerSecurityConfig{
		NoNewPrivileges: true,
		SeccompProfile:  "custom-seccomp.json",
		ApparmorProfile: "docker-cronium",
	}
	assert.Equal(t,
		[]string{"no-new-privileges", "seccomp=custom-seccomp.json", "apparmor=docker-cronium"},
		e.buildSecurityOptions())
}

// splitReader returns its input in fixed-size pieces, the way a pipe does.
type splitReader struct {
	data string
	size int
}

func (r *splitReader) Read(p []byte) (int, error) {
	if r.data == "" {
		return 0, io.EOF
	}
	n := r.size
	if n > len(r.data) {
		n = len(r.data)
	}
	n = copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func readLines(t *testing.T, e *Executor, reader io.Reader) []string {
	t.Helper()
	updates := make(chan types.ExecutionUpdate, 1000)
	e.readStream(reader, "stdout", updates)
	close(updates)
	var lines []string
	for u := range updates {
		entry, ok := u.Data.(*types.LogEntry)
		require.True(t, ok)
		lines = append(lines, entry.Line)
	}
	return lines
}

func TestReadStream_KeepsLinesWholeAcrossReads(t *testing.T) {
	e := newUnitExecutor()
	// A multi-byte character and a line break both land on read boundaries.
	lines := readLines(t, e, &splitReader{data: "héllo wörld\nsecond line\n", size: 3})
	assert.Equal(t, []string{"héllo wörld", "second line"}, lines)
}

func TestReadStream_StripsCarriageReturns(t *testing.T) {
	e := newUnitExecutor()
	assert.Equal(t, []string{"a", "b"}, readLines(t, e, strings.NewReader("a\r\nb\r\n")))
}

func TestReadStream_BoundsAnEndlessLine(t *testing.T) {
	e := newUnitExecutor()
	long := strings.Repeat("x", maxLogLineBytes*2+10)
	lines := readLines(t, e, strings.NewReader(long))
	require.Len(t, lines, 3)
	assert.Len(t, lines[0], maxLogLineBytes)
	assert.Equal(t, long, strings.Join(lines, ""))
}

func TestReadStream_SplitsLinesAndAssignsSequence(t *testing.T) {
	e := newUnitExecutor()
	updates := make(chan types.ExecutionUpdate, 100)

	e.readStream(strings.NewReader("line1\nline2\n\nline3"), "stderr", updates)
	close(updates)

	var entries []*types.LogEntry
	for u := range updates {
		require.Equal(t, types.UpdateTypeLog, u.Type)
		entry, ok := u.Data.(*types.LogEntry)
		require.True(t, ok)
		entries = append(entries, entry)
	}

	// A blank line is output like any other; sequence is monotonic from 1.
	require.Len(t, entries, 4)
	for i, wantLine := range []string{"line1", "line2", "", "line3"} {
		assert.Equal(t, wantLine, entries[i].Line)
		assert.Equal(t, "stderr", entries[i].Stream)
		assert.EqualValues(t, i+1, entries[i].Sequence)
	}
}

func TestSendUpdate_BlockedConsumerStillGetsUpdate(t *testing.T) {
	e := newUnitExecutor()
	updates := make(chan types.ExecutionUpdate, 2)

	// Fast path while there is buffer space.
	e.sendUpdate(updates, types.UpdateTypeLog, "a")
	e.sendUpdate(updates, types.UpdateTypeLog, "b")

	// Channel full: sendUpdate must block (not drop) until a consumer drains.
	delivered := make(chan struct{})
	go func() {
		e.sendUpdate(updates, types.UpdateTypeComplete, "c")
		close(delivered)
	}()

	first := <-updates // make room
	assert.Equal(t, "a", first.Data)

	select {
	case <-delivered:
	case <-time.After(5 * time.Second):
		t.Fatal("sendUpdate never delivered the blocked update")
	}

	assert.Equal(t, "b", (<-updates).Data)
	assert.Equal(t, "c", (<-updates).Data)
}

func TestSendError_StatusMapping(t *testing.T) {
	e := newUnitExecutor()
	updates := make(chan types.ExecutionUpdate, 4)

	e.sendError(updates, assert.AnError, true) // fatal
	e.sendError(updates, assert.AnError, false)

	fatal := <-updates
	require.Equal(t, types.UpdateTypeError, fatal.Type)
	fatalStatus, ok := fatal.Data.(*types.StatusUpdate)
	require.True(t, ok)
	assert.Equal(t, types.JobStatusFailed, fatalStatus.Status)
	assert.Equal(t, assert.AnError.Error(), fatalStatus.Message)
	require.NotNil(t, fatalStatus.Error)
	assert.Equal(t, assert.AnError.Error(), fatalStatus.Error.Message)

	nonFatal := <-updates
	nonFatalStatus, ok := nonFatal.Data.(*types.StatusUpdate)
	require.True(t, ok)
	assert.Equal(t, types.JobStatusRunning, nonFatalStatus.Status)
}

func TestCleanup_NilJobAndUntrackedJob(t *testing.T) {
	e := newUnitExecutor()

	// Nil job: nothing to do.
	require.NoError(t, e.Cleanup(context.Background(), nil))

	// A job with no tracked container/sidecar/network only clears bookkeeping;
	// no Docker client is touched.
	e.tokens["job-1"] = "tok"
	e.executionIDs["job-1"] = "exec-1"
	require.NoError(t, e.Cleanup(context.Background(), &types.Job{ID: "job-1"}))
	assert.NotContains(t, e.tokens, "job-1")
	assert.NotContains(t, e.executionIDs, "job-1")
}

func TestUpdateExecutionError_NoAPIClientIsNoop(t *testing.T) {
	e := newUnitExecutor() // apiClient is nil
	// Must not panic or block.
	e.updateExecutionError(context.Background(), "exec-1", assert.AnError)
}
