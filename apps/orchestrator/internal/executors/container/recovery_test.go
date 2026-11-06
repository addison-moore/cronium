package container

import (
	"context"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/api/types/container"
	"github.com/sirupsen/logrus/hooks/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func recoveryExecutor() *Executor {
	e := newUnitExecutor()
	e.orchestratorID = "orchestrator-1"
	e.config.Runtime.SharedNetwork = "cronium"
	e.timeoutConfig = config.GetDefaultTimeoutConfig()
	return e
}

func signedToken(t *testing.T, secret, capability, executionID string) string {
	t.Helper()
	token, err := generateJWT(executionID, "job-1", secret, "user", "event", capability, time.Hour)
	require.NoError(t, err)
	return token
}

func TestEveryResourceCarriesWhatALaterProcessLooksFor(t *testing.T) {
	e := recoveryExecutor()
	job := scriptJob(types.ScriptTypeBash)
	job.Execution.Timeout = 90 * time.Second

	labels := e.jobContainerLabels(job)
	assert.Equal(t, "true", labels[labelManaged])
	assert.Equal(t, containerTypeJob, labels[labelType])
	assert.Equal(t, "job-1", labels[labelJobID])
	assert.Equal(t, "orchestrator-1", labels[labelOrchestratorID])
	assert.Equal(t, "cronium", labels[labelStack])
	assert.Equal(t, "90", labels[labelTimeoutSeconds])
	assert.NotContains(t, labels, labelResumable)

	sidecar := e.managedLabels(job.ID, containerTypeSidecar)
	assert.Equal(t, containerTypeSidecar, sidecar[labelType])
	assert.Equal(t, "orchestrator-1", sidecar[labelOrchestratorID])

	network := e.managedLabels(job.ID, "")
	assert.NotContains(t, network, labelType)
	assert.Equal(t, "cronium", network[labelStack])
}

func TestTimeoutLabelIsTheCappedTimeout(t *testing.T) {
	e := recoveryExecutor()
	e.timeoutConfig.MaxExecutionTimeout = time.Minute
	job := scriptJob(types.ScriptTypeBash)
	job.Execution.Timeout = time.Hour
	assert.Equal(t, "60", e.jobContainerLabels(job)[labelTimeoutSeconds],
		"a later process has to enforce what this one would have")
}

func TestLocalBranchIsMarkedNotResumable(t *testing.T) {
	e := recoveryExecutor()
	job := scriptJob(types.ScriptTypeBash)
	job.LocalBranch = true
	assert.Equal(t, "false", e.jobContainerLabels(job)[labelResumable])
}

func TestForeignToThisStack(t *testing.T) {
	e := recoveryExecutor()
	cases := []struct {
		name    string
		labels  map[string]string
		foreign bool
	}{
		{"ours", map[string]string{labelOrchestratorID: "orchestrator-1", labelStack: "cronium"}, false},
		{"another orchestrator", map[string]string{labelOrchestratorID: "orchestrator-2", labelStack: "cronium"}, true},
		{"another stack on the default ID", map[string]string{labelOrchestratorID: "orchestrator-1", labelStack: "staging"}, true},
		{"from before these labels: a sidecar", map[string]string{labelManaged: "true", labelJobID: "j"}, false},
		{"from before these labels: a job container", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.foreign, e.foreignToThisStack(tc.labels))
		})
	}
}

func TestPeriodicCleanupOnlyConsidersWhatIsItsOwn(t *testing.T) {
	e := recoveryExecutor()
	managed := func(id, stack string) map[string]string {
		return map[string]string{labelManaged: "true", labelOrchestratorID: id, labelStack: stack}
	}
	cases := []struct {
		name      string
		container string
		labels    map[string]string
		candidate bool
	}{
		{"this stack's job", "/cronium-job-job_1", managed("orchestrator-1", "cronium"), true},
		{"this stack's sidecar", "/cronium-runtime-job_1", managed("orchestrator-1", "cronium"), true},
		{"another stack's job", "/cronium-job-job_1", managed("orchestrator-1", "staging"), false},
		{"another orchestrator's sidecar", "/cronium-runtime-job_1", managed("orchestrator-2", "cronium"), false},
		{"a sidecar from before these labels", "/cronium-runtime-job_1", map[string]string{labelManaged: "true", labelJobID: "job_1"}, true},
		{"a job from before any labels", "/cronium-job-job_1", nil, true},
		{"the stack's own runtime service", "/cronium-runtime", map[string]string{"com.docker.compose.service": "cronium-runtime"}, false},
		{"a service in a project called cronium-runtime", "/cronium-runtime-postgres-1", map[string]string{"com.docker.compose.project": "cronium-runtime"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.candidate, e.isOrphanCandidate([]string{tc.container}, tc.labels))
		})
	}
}

func TestWhatItLabelledCountsAsOrphanedSooner(t *testing.T) {
	e := recoveryExecutor()
	e.timeoutConfig.SetupTimeout = 5 * time.Minute
	assert.Equal(t, 5*time.Minute, e.orphanedAfter(map[string]string{labelOrchestratorID: "orchestrator-1"}))
	assert.Equal(t, time.Hour, e.orphanedAfter(map[string]string{labelManaged: "true"}), "from before these labels")
	assert.Equal(t, time.Hour, e.orphanedAfter(nil))
}

func inspected(t *testing.T, status container.ContainerState, env []string, labels map[string]string) container.InspectResponse {
	t.Helper()
	if labels == nil {
		labels = map[string]string{labelTimeoutSeconds: "600"}
	}
	return container.InspectResponse{
		State:  &container.State{Status: status, StartedAt: "2026-11-05T22:00:00.5Z"},
		Config: &container.Config{Env: env, Labels: labels},
	}
}

func TestResumableJobRebuildsWhatIsNeededToReport(t *testing.T) {
	log, _ := test.NewNullLogger()
	env := []string{"A=1", "CRONIUM_EXECUTION_TOKEN=" + signedToken(t, "secret", "cap.1.token", "exec_1")}

	for _, status := range []container.ContainerState{
		container.StateRunning, container.StatePaused, container.StateRestarting,
		container.StateExited, container.StateDead,
	} {
		t.Run(string(status), func(t *testing.T) {
			job := resumableJob("job-1", inspected(t, status, env, nil), log)
			require.NotNil(t, job)
			assert.Equal(t, "job-1", job.ID)
			assert.Equal(t, types.JobTypeContainer, job.Type)
			assert.Equal(t, "cap.1.token", job.CapabilityToken)
			assert.Equal(t, "exec_1", job.Metadata["executionId"])
			assert.Equal(t, 10*time.Minute, job.Timeout)
			assert.Equal(t, 10*time.Minute, job.GetTimeout())
			require.NotNil(t, job.StartedAt)
			assert.Equal(t, time.Date(2026, 11, 5, 22, 0, 0, 500_000_000, time.UTC), job.StartedAt.UTC())
		})
	}
}

// A .env change is what restarts the orchestrator, and JWT_SECRET may be the change.
func TestResumableJobDoesNotDependOnTheCurrentJWTSecret(t *testing.T) {
	log, _ := test.NewNullLogger()
	env := []string{"CRONIUM_EXECUTION_TOKEN=" + signedToken(t, "the-secret-before-rotation", "cap", "exec")}
	job := resumableJob("job-1", inspected(t, container.StateRunning, env, nil), log)
	require.NotNil(t, job)
	assert.Equal(t, "cap", job.CapabilityToken)
}

func TestWhatALaterProcessCannotFinishIsNotResumable(t *testing.T) {
	log, _ := test.NewNullLogger()
	good := []string{"CRONIUM_EXECUTION_TOKEN=" + signedToken(t, "s", "cap", "exec")}
	timeoutOnly := map[string]string{labelTimeoutSeconds: "600"}

	cases := []struct {
		name string
		info container.InspectResponse
	}{
		{"never started", inspected(t, container.StateCreated, good, timeoutOnly)},
		{"being removed", inspected(t, container.StateRemoving, good, timeoutOnly)},
		{"half of a larger job", inspected(t, container.StateRunning, good, map[string]string{labelTimeoutSeconds: "600", labelResumable: "false"})},
		{"no token", inspected(t, container.StateRunning, []string{"A=1"}, timeoutOnly)},
		{"empty token", inspected(t, container.StateRunning, []string{"CRONIUM_EXECUTION_TOKEN="}, timeoutOnly)},
		{"unreadable token", inspected(t, container.StateRunning, []string{"CRONIUM_EXECUTION_TOKEN=not-a-jwt"}, timeoutOnly)},
		{"token without a capability", inspected(t, container.StateRunning, []string{"CRONIUM_EXECUTION_TOKEN=" + signedToken(t, "s", "", "exec")}, timeoutOnly)},
		{"no timeout label", inspected(t, container.StateRunning, good, map[string]string{"other": "x"})},
		{"no usable timeout", inspected(t, container.StateRunning, good, map[string]string{labelTimeoutSeconds: "0"})},
		{"no state", container.InspectResponse{Config: &container.Config{}}},
		{"no config", container.InspectResponse{State: &container.State{Status: container.StateRunning}}},
		{"no start time", container.InspectResponse{
			State:  &container.State{Status: container.StateRunning},
			Config: &container.Config{Env: good, Labels: timeoutOnly},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Nil(t, resumableJob("job-1", tc.info, log))
		})
	}
}

func TestResumedTimingLeavesSetupTimingAlone(t *testing.T) {
	start := time.Date(2026, 11, 5, 22, 0, 0, 0, time.UTC)
	end := start.Add(90 * time.Second)
	update := &api.ExecutionStatusUpdate{}
	addResumedTiming(update, &ExecutionTiming{ExecutionStart: start, ExecutionEnd: end})

	assert.Equal(t, &start, update.ExecutionStartedAt)
	assert.Equal(t, &end, update.ExecutionCompletedAt)
	assert.Equal(t, &end, update.CompletedAt)
	require.NotNil(t, update.ExecutionDuration)
	assert.Equal(t, int64(90_000), *update.ExecutionDuration)

	// The process that did the setup reported it, and this one doesn't know it.
	assert.Nil(t, update.StartedAt)
	assert.Nil(t, update.SetupStartedAt)
	assert.Nil(t, update.SetupCompletedAt)
	assert.Nil(t, update.SetupDuration)
	assert.Nil(t, update.TotalDuration)
}

func TestFinishedContainersWaitForTheResultToBeReported(t *testing.T) {
	e := recoveryExecutor()
	job := scriptJob(types.ScriptTypeBash)
	e.setHandOver(job.ID, true)
	updates := make(chan types.ExecutionUpdate, 1)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		e.finishRun(context.Background(), job, jobResources{}, updates, true)
	}()

	// The stream ends so the core can report...
	select {
	case _, open := <-updates:
		require.False(t, open)
	case <-time.After(2 * time.Second):
		t.Fatal("the update stream never ended")
	}
	// ...while the containers stay, and the next process could still take over.
	select {
	case <-finished:
		t.Fatal("removed the containers before the result was reported")
	case <-time.After(30 * time.Millisecond):
	}
	assert.True(t, e.CanHandOver(job.ID))

	// ReleaseJob returns only once they're gone.
	e.ReleaseJob(job.ID)
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("ReleaseJob returned with the removal still under way")
	}
	assert.False(t, e.CanHandOver(job.ID))
	assert.Empty(t, e.holds)
}

func TestReleaseWithNothingHeldReturnsAtOnceAndIsRepeatable(t *testing.T) {
	e := recoveryExecutor()
	done := make(chan struct{})
	go func() {
		e.ReleaseJob("never-held")
		e.ReleaseJob("never-held")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("ReleaseJob blocked with nothing held")
	}
}

func TestContainersDoNotWaitForAReleaseThatNeverComes(t *testing.T) {
	e := recoveryExecutor()
	e.reportHoldLimit = 10 * time.Millisecond
	job := scriptJob(types.ScriptTypeBash)
	updates := make(chan types.ExecutionUpdate, 1)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		e.finishRun(context.Background(), job, jobResources{}, updates, true)
	}()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("containers were held forever")
	}
	assert.Empty(t, e.holds)
}

func TestCancelledJobsContainersGoBeforeTheStreamEnds(t *testing.T) {
	e := recoveryExecutor()
	job := scriptJob(types.ScriptTypeBash)
	e.containers[job.ID] = "c"
	updates := make(chan types.ExecutionUpdate, 1)
	e.finishRun(context.Background(), job, jobResources{}, updates, false)
	_, open := <-updates
	assert.False(t, open)
	assert.NotContains(t, e.containers, job.ID, "nothing to keep, and a cancelled script should stop now")
}

func TestLocalBranchIsNotHeldForAReportNoLaterProcessCouldMake(t *testing.T) {
	e := recoveryExecutor()
	job := scriptJob(types.ScriptTypeBash)
	job.LocalBranch = true
	updates := make(chan types.ExecutionUpdate, 1)
	e.finishRun(context.Background(), job, jobResources{}, updates, true)
	_, open := <-updates
	assert.False(t, open)
	assert.Empty(t, e.holds)
}

func TestResumeWithoutAFoundContainerFails(t *testing.T) {
	e := recoveryExecutor()
	started := time.Now()
	_, err := e.ResumeJob(context.Background(), &types.Job{ID: "job-1", StartedAt: &started})
	assert.Error(t, err)
}

func TestContainerAndSidecarNamesDiffer(t *testing.T) {
	assert.Equal(t, "cronium-job-j", jobContainerName("j"))
	assert.Equal(t, "cronium-runtime-j", sidecarContainerName("j"))
}
