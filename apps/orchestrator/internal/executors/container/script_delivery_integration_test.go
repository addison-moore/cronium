//go:build integration

package container

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sandboxExecutor is the production sandbox against the real Docker daemon. Its jobs
// run with no network, so they need no sidecar or per-job network. The tests skip when
// Docker or a runner image is missing, and CI fails if they do.
func sandboxExecutor(t *testing.T, ctx context.Context) *Executor {
	t.Helper()
	cli, err := client.New(client.FromEnv)
	if err != nil {
		t.Skipf("Docker client unavailable: %v", err)
	}
	if _, err := cli.Ping(ctx, client.PingOptions{}); err != nil {
		t.Skipf("Docker daemon unreachable: %v", err)
	}
	e := hardenedExecutor()
	e.dockerClient = cli
	e.tokens = make(map[string]string)
	e.executionIDs = make(map[string]string)
	e.sidecar = NewSidecarManager(e, e.log)
	return e
}

// sandboxedJob makes a job for this language. It skips the test if the image is missing.
func sandboxedJob(t *testing.T, ctx context.Context, e *Executor, in interpreter, content string) *types.Job {
	t.Helper()
	image := e.getImageForScript(ctx, in.scriptType)
	if _, err := e.dockerClient.ImageInspect(ctx, image); err != nil {
		t.Skipf("%s not present locally (this test does not build it): %v", image, err)
	}

	suffix := make([]byte, 6)
	_, err := rand.Read(suffix)
	require.NoError(t, err)
	job := &types.Job{
		ID:        "script-delivery-" + hex.EncodeToString(suffix),
		Type:      types.JobTypeContainer,
		Execution: types.ExecutionConfig{Script: &types.Script{Type: in.scriptType, Content: content}},
	}
	// A real job has these, and the Python and Node SDKs stop at import without them.
	e.sidecar.storeExecutionToken(job.ID, "test-token")
	e.executionIDs[job.ID] = "exec-" + job.ID
	return job
}

// createJobContainer creates a job's real container, ready to be started.
func createJobContainer(t *testing.T, ctx context.Context, e *Executor, job *types.Job) string {
	t.Helper()
	id, err := e.createContainer(ctx, job, "none", nil)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = e.removeContainer(context.Background(), id)
	})
	return id
}

// jobResult is what a job reports through runContainer's updates.
type jobResult struct {
	stdout, stderr []string
	status         types.JobStatus
	exitCode       int
}

func collectUpdates(t *testing.T, updates chan types.ExecutionUpdate) jobResult {
	t.Helper()
	close(updates)
	var result jobResult
	for update := range updates {
		switch data := update.Data.(type) {
		case *types.LogEntry:
			if data.Stream == "stdout" {
				result.stdout = append(result.stdout, data.Line)
			} else {
				result.stderr = append(result.stderr, data.Line)
			}
		case *types.StatusUpdate:
			if update.Type == types.UpdateTypeComplete {
				result.status = data.Status
				require.NotNil(t, data.ExitCode, "completed without an exit code: %s", data.Message)
				result.exitCode = *data.ExitCode
			}
		}
	}
	return result
}

// runJob runs a job through the production path, stopping it when ctx ends.
func runJob(t *testing.T, ctx context.Context, e *Executor, job *types.Job) jobResult {
	t.Helper()
	id := createJobContainer(t, ctx, e, job)
	updates := make(chan types.ExecutionUpdate, 1000)
	e.runContainer(ctx, id, job, updates, "exec-"+job.ID, NewExecutionTiming())
	return collectUpdates(t, updates)
}

func runSandboxedJob(t *testing.T, ctx context.Context, e *Executor, in interpreter, content string) jobResult {
	t.Helper()
	return runJob(t, ctx, e, sandboxedJob(t, ctx, e, in, content))
}

// TestLongScriptRunsInTheSandbox covers the reason for delivering scripts on stdin:
// through the production create and run paths, past the limit on one argument, and past
// the limit of about 2 MiB on all of them together.
func TestLongScriptRunsInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := sandboxExecutor(t, ctx)

	for _, in := range interpreters {
		for _, size := range []int{132_000, 3_000_000} {
			t.Run(fmt.Sprintf("%s/%d", in.scriptType, size), func(t *testing.T) {
				result := runSandboxedJob(t, ctx, e, in, paddedScript(in, size))

				assert.Equal(t, types.JobStatusCompleted, result.status)
				assert.Equal(t, 0, result.exitCode)
				assert.Equal(t, []string{"first héllo ✓", "last wörld ✓"}, result.stdout)
				assert.Empty(t, result.stderr)
			})
		}
	}
}

// A script no longer shares the kernel's limit of about 2 MiB with the environment, so
// the longest one still runs alongside as many variables as the app accepts.
func TestLongScriptRunsWithAFullEnvironmentInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := sandboxExecutor(t, ctx)

	for _, in := range interpreters {
		t.Run(string(in.scriptType), func(t *testing.T) {
			job := sandboxedJob(t, ctx, e, in, paddedScript(in, 3_000_000))
			job.Execution.Environment = make(map[string]string)
			for i := range 8 {
				job.Execution.Environment[fmt.Sprintf("LONG_%d", i)] = strings.Repeat("x", 125_000)
			}

			result := runJob(t, ctx, e, job)

			assert.Equal(t, 0, result.exitCode)
			assert.Equal(t, []string{"first héllo ✓", "last wörld ✓"}, result.stdout)
			assert.Empty(t, result.stderr)
		})
	}
}

func TestScriptSeesTheEndOfStdinInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := sandboxExecutor(t, ctx)

	for _, in := range interpreters {
		t.Run(string(in.scriptType), func(t *testing.T) {
			result := runSandboxedJob(t, ctx, e, in, in.readStdin+"\n"+in.print("next line")+"\n"+in.exit7+"\n")

			assert.Equal(t, types.JobStatusFailed, result.status)
			assert.Equal(t, 7, result.exitCode)
			assert.Equal(t, []string{"stdin=[]", "next line"}, result.stdout)
			assert.Empty(t, result.stderr)
		})
	}
}

// A job stopped at its timeout has to go on SIGTERM. Under the bootstrap, bash stays as
// the parent of a job's last command rather than becoming it, and tini only signals bash:
// if that left the job waiting, every timeout would last until Docker's SIGKILL.
func TestTimedOutJobStopsOnSigtermInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := sandboxExecutor(t, ctx)

	for _, in := range interpreters {
		t.Run(string(in.scriptType), func(t *testing.T) {
			job := sandboxedJob(t, ctx, e, in, in.block)
			id := createJobContainer(t, ctx, e, job)
			updates := make(chan types.ExecutionUpdate, 1000)
			jobCtx, jobCancel := context.WithTimeout(ctx, 3*time.Second)
			defer jobCancel()

			started := time.Now()
			e.runContainer(jobCtx, id, job, updates, "exec-"+job.ID, NewExecutionTiming())
			elapsed := time.Since(started)
			result := collectUpdates(t, updates)

			assert.Equal(t, types.JobStatusFailed, result.status)
			assert.Equal(t, 143, result.exitCode, "128+SIGTERM")
			// runContainer gives it 10 seconds before SIGKILL, which would make this 13.
			assert.Less(t, elapsed, 10*time.Second)
		})
	}
}

// A script's line numbers mean what they did under -c and -e. On a developer's machine
// bash may be too old to agree, which is why this runs on the real images.
func TestScriptKeepsItsLineNumbersInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := sandboxExecutor(t, ctx)

	for _, in := range interpreters {
		t.Run(string(in.scriptType), func(t *testing.T) {
			result := runSandboxedJob(t, ctx, e, in, in.lineNumber)
			assert.Equal(t, 0, result.exitCode)
			assert.Contains(t, strings.Join(result.stdout, "\n"), in.lineNumberAt)

			result = runSandboxedJob(t, ctx, e, in, in.syntaxError+"\n"+strings.Repeat("\n", 100))
			assert.NotEqual(t, 0, result.exitCode)
			assert.Contains(t, strings.Join(result.stderr, "\n")+"\n", in.syntaxErrorAt)
		})
	}
}

// TestCutOffDeliveryRunsNothing cuts the connection partway, which is what stdin sees
// if the orchestrator dies: StdinOnce closes it, and the bootstrap reads a short script.
func TestCutOffDeliveryRunsNothing(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := sandboxExecutor(t, ctx)

	for _, in := range interpreters {
		t.Run(string(in.scriptType), func(t *testing.T) {
			job := sandboxedJob(t, ctx, e, in, paddedScript(in, 200_000))
			id := createJobContainer(t, ctx, e, job)

			attached, err := e.dockerClient.ContainerAttach(ctx, id, client.ContainerAttachOptions{Stream: true, Stdin: true})
			require.NoError(t, err)
			_, err = e.dockerClient.ContainerStart(ctx, id, client.ContainerStartOptions{})
			require.NoError(t, err)

			source := scriptSource(job.Execution.Script)
			_, err = attached.Conn.Write(source[:len(source)/2])
			require.NoError(t, err)
			attached.Close()

			wait := e.dockerClient.ContainerWait(ctx, id, client.ContainerWaitOptions{})
			select {
			case status := <-wait.Result:
				assert.EqualValues(t, scriptNotDeliveredExitCode, status.StatusCode)
			case err := <-wait.Error:
				t.Fatalf("waiting for the container: %v", err)
			}

			logs, err := e.dockerClient.ContainerLogs(ctx, id, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true})
			require.NoError(t, err)
			defer logs.Close()
			var output bytes.Buffer
			_, err = stdcopy.StdCopy(&output, &output, logs)
			require.NoError(t, err)
			assert.Contains(t, output.String(), scriptNotDeliveredMessage)
			assert.NotContains(t, output.String(), "first")
		})
	}
}
