//go:build integration

package container

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These run against a real Docker daemon, using a second Executor as the process
// that comes after a restart. Run with:
//
//	go test -tags integration ./internal/executors/container/ -run Leftover
//
// Skipped when Docker is unreachable or alpine:latest is not present locally.

const recoveryTestImage = "alpine:latest"

func recoveryDockerClient(t *testing.T) *client.Client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cli, err := client.New(client.FromEnv)
	if err != nil {
		t.Skipf("Docker client unavailable: %v", err)
	}
	if _, err := cli.Ping(ctx, client.PingOptions{}); err != nil {
		t.Skipf("Docker daemon unreachable: %v", err)
	}
	if _, err := cli.ImageInspect(ctx, recoveryTestImage); err != nil {
		t.Skipf("%s not present locally (test does not pull): %v", recoveryTestImage, err)
	}
	return cli
}

// recoveryProcess is an Executor scoped to this test alone, so that a test run
// can't touch anything else on the machine.
func recoveryProcess(t *testing.T, cli *client.Client, stack string) *Executor {
	t.Helper()
	e := recoveryExecutor()
	e.dockerClient = cli
	e.config.Runtime.SharedNetwork = stack
	e.timeoutConfig = config.GetDefaultTimeoutConfig()
	return e
}

// startLeftJob starts what an earlier process would have left: a job container, a
// sidecar and a network, with the labels and token that process would have given them.
func startLeftJob(t *testing.T, e *Executor, jobID, script string, timeoutSeconds int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cli := e.dockerClient

	network, err := e.sidecar.CreateJobNetwork(ctx, jobID)
	require.NoError(t, err)

	token, err := generateJWT("exec_"+jobID, jobID, "the-old-secret", "user", "event", "cap_"+jobID, time.Hour)
	require.NoError(t, err)
	job := &types.Job{ID: jobID, Execution: types.ExecutionConfig{Timeout: time.Duration(timeoutSeconds) * time.Second}}
	created, err := cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config: &container.Config{
			Image:  recoveryTestImage,
			Cmd:    []string{"sh", "-c", script},
			Env:    []string{"CRONIUM_EXECUTION_TOKEN=" + token},
			Labels: e.jobContainerLabels(job),
		},
		HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode(network)},
		Name:       jobContainerName(jobID),
	})
	require.NoError(t, err)
	sidecar, err := cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config: &container.Config{
			Image:  recoveryTestImage,
			Cmd:    []string{"sleep", "300"},
			Labels: e.managedLabels(jobID, containerTypeSidecar),
		},
		HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode(network)},
		Name:       sidecarContainerName(jobID),
	})
	require.NoError(t, err)

	t.Cleanup(func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		_, _ = cli.ContainerRemove(cleanupCtx, created.ID, client.ContainerRemoveOptions{Force: true})
		_, _ = cli.ContainerRemove(cleanupCtx, sidecar.ID, client.ContainerRemoveOptions{Force: true})
		_, _ = cli.NetworkRemove(cleanupCtx, network, client.NetworkRemoveOptions{})
	})

	_, err = cli.ContainerStart(ctx, created.ID, client.ContainerStartOptions{})
	require.NoError(t, err)
	_, err = cli.ContainerStart(ctx, sidecar.ID, client.ContainerStartOptions{})
	require.NoError(t, err)
}

func findLeftJob(t *testing.T, e *Executor, jobID string) *types.LeftoverJob {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	found, err := e.FindLeftoverJobs(ctx)
	require.NoError(t, err)
	for i := range found {
		if found[i].ID == jobID {
			return &found[i]
		}
	}
	return nil
}

// drainUpdates collects a run's stdout and final status.
func drainUpdates(t *testing.T, updates <-chan types.ExecutionUpdate) (stdout []string, final *types.StatusUpdate) {
	t.Helper()
	deadline := time.After(90 * time.Second)
	for {
		select {
		case update, open := <-updates:
			if !open {
				return stdout, final
			}
			switch data := update.Data.(type) {
			case *types.LogEntry:
				if data.Stream == "stdout" {
					stdout = append(stdout, data.Line)
				}
			case *types.StatusUpdate:
				if update.Type == types.UpdateTypeComplete {
					final = data
				}
			}
		case <-deadline:
			t.Fatal("the run never ended")
		}
	}
}

func assertResourcesGone(t *testing.T, cli *client.Client, jobID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, name := range []string{jobContainerName(jobID), sidecarContainerName(jobID)} {
		_, err := cli.ContainerInspect(ctx, name, client.ContainerInspectOptions{})
		assert.True(t, isNotFound(err), "%s should be gone (err=%v)", name, err)
	}
	_, err := cli.NetworkInspect(ctx, jobNetworkName(jobID), client.NetworkInspectOptions{})
	assert.True(t, isNotFound(err), "network should be gone (err=%v)", err)
}

func uniqueID(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("leftover-test-%d", time.Now().UnixNano())
}

func TestLeftoverStillRunningIsFollowedToItsEnd(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	startLeftJob(t, recoveryProcess(t, cli, stack), jobID, `echo before; sleep 3; echo after; exit 7`, 60)

	next := recoveryProcess(t, cli, stack)
	leftover := findLeftJob(t, next, jobID)
	require.NotNil(t, leftover)
	require.NotNil(t, leftover.Job)
	assert.Equal(t, "cap_"+jobID, leftover.Job.CapabilityToken)

	updates, err := next.ResumeJob(context.Background(), leftover.Job)
	require.NoError(t, err)
	assert.True(t, next.CanHandOver(jobID), "a later process could still take this over")

	stdout, final := drainUpdates(t, updates)
	assert.Equal(t, []string{"before", "after"}, stdout, "output from before the restart is still there")
	require.NotNil(t, final)
	assert.Equal(t, types.JobStatusFailed, final.Status)
	require.NotNil(t, final.ExitCode)
	assert.Equal(t, 7, *final.ExitCode)

	// The stopped container stays until the result is safe.
	_, err = cli.ContainerInspect(context.Background(), jobContainerName(jobID), client.ContainerInspectOptions{})
	assert.NoError(t, err)

	next.ReleaseJob(jobID)
	assertResourcesGone(t, cli, jobID)
}

func TestLeftoverThatAlreadyExitedKeepsItsResultEvenPastItsTimeout(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	startLeftJob(t, recoveryProcess(t, cli, stack), jobID, `echo done; exit 0`, 1)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	wait := cli.ContainerWait(ctx, jobContainerName(jobID), client.ContainerWaitOptions{Condition: container.WaitConditionNotRunning})
	select {
	case <-wait.Result:
	case err := <-wait.Error:
		require.NoError(t, err)
	}
	time.Sleep(1100 * time.Millisecond) // past its timeout, with nobody watching

	next := recoveryProcess(t, cli, stack)
	leftover := findLeftJob(t, next, jobID)
	require.NotNil(t, leftover)
	require.NotNil(t, leftover.Job)
	updates, err := next.ResumeJob(context.Background(), leftover.Job)
	require.NoError(t, err)

	stdout, final := drainUpdates(t, updates)
	assert.Equal(t, []string{"done"}, stdout)
	require.NotNil(t, final)
	assert.Equal(t, types.JobStatusCompleted, final.Status, "it ended in time; nobody was there to see it")
	next.ReleaseJob(jobID)
	assertResourcesGone(t, cli, jobID)
}

func TestLeftoverRunningPastItsTimeoutIsStoppedWithItsOutputKept(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	startLeftJob(t, recoveryProcess(t, cli, stack), jobID, `trap 'echo stopped; exit 143' TERM; echo before; sleep 300 & wait`, 1)
	time.Sleep(1500 * time.Millisecond)

	next := recoveryProcess(t, cli, stack)
	leftover := findLeftJob(t, next, jobID)
	require.NotNil(t, leftover)
	require.NotNil(t, leftover.Job)
	updates, err := next.ResumeJob(context.Background(), leftover.Job)
	require.NoError(t, err)

	stdout, final := drainUpdates(t, updates)
	assert.Equal(t, []string{"before", "stopped"}, stdout)
	require.NotNil(t, final)
	assert.Equal(t, types.JobStatusFailed, final.Status)
	next.ReleaseJob(jobID)
	assertResourcesGone(t, cli, jobID)
}

func TestLeftoverCancelledAfterResumingIsKilledAndRemoved(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	startLeftJob(t, recoveryProcess(t, cli, stack), jobID, `echo before; sleep 300`, 600)

	next := recoveryProcess(t, cli, stack)
	leftover := findLeftJob(t, next, jobID)
	require.NotNil(t, leftover)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	updates, err := next.ResumeJob(ctx, leftover.Job)
	require.NoError(t, err)

	time.Sleep(500 * time.Millisecond)
	cancel()
	_, final := drainUpdates(t, updates)
	require.NotNil(t, final)
	require.NotNil(t, final.ExitCode)
	assert.Equal(t, -2, *final.ExitCode)
	assert.False(t, next.CanHandOver(jobID))
	assertResourcesGone(t, cli, jobID)
}

func TestLeftoverRemovalKillsARunningScriptAndTakesEverything(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	startLeftJob(t, recoveryProcess(t, cli, stack), jobID, `sleep 300`, 600)

	next := recoveryProcess(t, cli, stack)
	require.NotNil(t, findLeftJob(t, next, jobID))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	require.NoError(t, next.RemoveLeftoverJob(ctx, jobID))
	assertResourcesGone(t, cli, jobID)

	// Nothing to find any more, and removing it again isn't an error.
	require.Nil(t, findLeftJob(t, recoveryProcess(t, cli, stack), jobID))
	require.NoError(t, next.RemoveLeftoverJob(ctx, jobID))
}

func TestLeftoverOfAnotherStackIsNotFound(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	startLeftJob(t, recoveryProcess(t, cli, jobID+"-stack"), jobID, `sleep 300`, 600)

	other := recoveryProcess(t, cli, jobID+"-other-stack")
	assert.Nil(t, findLeftJob(t, other, jobID), "same orchestrator ID, different stack: not this process's to touch")

	otherOrchestrator := recoveryProcess(t, cli, jobID+"-stack")
	otherOrchestrator.orchestratorID = "orchestrator-2"
	assert.Nil(t, findLeftJob(t, otherOrchestrator, jobID))
}

func TestLeftoverOnlyPartlySetUpHasNothingToResume(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	e := recoveryProcess(t, cli, stack)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	network, err := e.sidecar.CreateJobNetwork(ctx, jobID)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = cli.NetworkRemove(context.Background(), network, client.NetworkRemoveOptions{}) })

	next := recoveryProcess(t, cli, stack)
	leftover := findLeftJob(t, next, jobID)
	require.NotNil(t, leftover)
	assert.Nil(t, leftover.Job)
	require.NoError(t, next.RemoveLeftoverJob(ctx, jobID))
	assertResourcesGone(t, cli, jobID)
}

func TestStaleResourcesOfAnEarlierAttemptAreCleared(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	startLeftJob(t, recoveryProcess(t, cli, stack), jobID, `sleep 300`, 600)

	// Claiming the job again is what makes them stale, whoever made them.
	claimant := recoveryProcess(t, cli, jobID+"-elsewhere")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	require.NoError(t, claimant.removeStaleResources(ctx, jobID))
	assertResourcesGone(t, cli, jobID)

	// With nothing there it's a no-op.
	require.NoError(t, claimant.removeStaleResources(ctx, jobID))
}

// A lookalike whose name extends this job's must survive: name filters match substrings.
func TestStaleResourcesRemovalIsExactByName(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	stack := jobID + "-stack"
	longer := jobID + "-longer"
	startLeftJob(t, recoveryProcess(t, cli, stack), longer, `sleep 300`, 600)

	claimant := recoveryProcess(t, cli, stack)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	require.NoError(t, claimant.removeStaleResources(ctx, jobID))

	info, err := cli.ContainerInspect(ctx, jobContainerName(longer), client.ContainerInspectOptions{})
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(info.Container.Name, longer))
	assert.True(t, info.Container.State.Running)
}

// The name filter runs in the daemon, so this is the only place to see what it matches.
// This never runs the cleanup itself, which considers every container on the host.
func TestPeriodicCleanupFilterIsAnchored(t *testing.T) {
	cli := recoveryDockerClient(t)
	jobID := uniqueID(t)
	e := recoveryProcess(t, cli, jobID+"-stack")
	startLeftJob(t, e, jobID, `sleep 300`, 600)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	serviceName := "not-a-" + jobID + "-cronium-runtime-1"
	service, err := cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config: &container.Config{Image: recoveryTestImage, Cmd: []string{"sleep", "300"}},
		Name:   serviceName,
	})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = cli.ContainerRemove(context.Background(), service.ID, client.ContainerRemoveOptions{Force: true})
	})

	listed, err := cli.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: orphanContainerFilters()})
	require.NoError(t, err)
	names := make(map[string]bool)
	for _, c := range listed.Items {
		for _, name := range c.Names {
			names[strings.TrimPrefix(name, "/")] = true
		}
	}
	assert.True(t, names[jobContainerName(jobID)])
	assert.True(t, names[sidecarContainerName(jobID)])
	assert.False(t, names[serviceName], "the stack's own runtime service must never look like a sidecar")
}
