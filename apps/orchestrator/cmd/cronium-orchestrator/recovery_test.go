package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/require"
)

// ---------- fake recovery ----------

// fakeRecovery stands in for the container executor's side of a restart.
type fakeRecovery struct {
	mu        sync.Mutex
	leftovers []types.LeftoverJob
	findErr   error
	removeErr error
	finds     int
	removed   []string
	resumed   []string
	released  []string
	canHand   map[string]bool
	resumeFn  func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error)
	onRelease func(jobID string)
}

func (f *fakeRecovery) FindLeftoverJobs(_ context.Context) ([]types.LeftoverJob, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.finds++
	return f.leftovers, f.findErr
}

func (f *fakeRecovery) ResumeJob(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	f.mu.Lock()
	f.resumed = append(f.resumed, job.ID)
	fn := f.resumeFn
	f.mu.Unlock()
	if fn == nil {
		return preloadedUpdates(completeUpdate(types.JobStatusCompleted, 0)), nil
	}
	return fn(ctx, job)
}

func (f *fakeRecovery) RemoveLeftoverJob(_ context.Context, jobID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, jobID)
	return f.removeErr
}

func (f *fakeRecovery) CanHandOver(jobID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.canHand[jobID]
}

func (f *fakeRecovery) ReleaseJob(jobID string) {
	f.mu.Lock()
	f.released = append(f.released, jobID)
	fn := f.onRelease
	f.mu.Unlock()
	if fn != nil {
		fn(jobID)
	}
}

func (f *fakeRecovery) snapshot() (removed, resumed, released []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.removed...), append([]string(nil), f.resumed...), append([]string(nil), f.released...)
}

func newRecoveryFixture(t *testing.T, leftovers ...types.LeftoverJob) (*coreFixture, *fakeRecovery) {
	t.Helper()
	fx := newCoreFixture(t, nil)
	rec := &fakeRecovery{leftovers: leftovers, canHand: make(map[string]bool)}
	fx.core.recovery = rec
	return fx, rec
}

func leftoverJob(id string) types.LeftoverJob {
	startedAt := time.Now().Add(-90 * time.Second)
	return types.LeftoverJob{ID: id, Job: &types.Job{
		ID:              id,
		Type:            types.JobTypeContainer,
		CapabilityToken: "cap-" + id,
		StartedAt:       &startedAt,
		Timeout:         time.Hour,
	}}
}

func extendNothing(_ []string) (*api.JobsHeartbeatResponse, error) {
	return &api.JobsHeartbeatResponse{}, nil
}

// ---------- after a restart ----------

func TestLeftoverWithItsLeaseIsFollowedAndReported(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t, leftoverJob("kept"))
	rec.resumeFn = func(context.Context, *types.Job) (<-chan types.ExecutionUpdate, error) {
		return preloadedUpdates(
			logUpdate("stdout", "written before the restart"),
			logUpdate("stdout", "written after it"),
			completeUpdate(types.JobStatusCompleted, 0),
		), nil
	}

	var usedCapability sync.Map
	fx.core.withCapability = func(ctx context.Context, token string) context.Context {
		usedCapability.Store(token, true)
		return api.WithJobCapability(ctx, token)
	}

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	got := fx.waitComplete(t)
	require.Equal(t, "kept", got.jobID)
	require.Equal(t, types.JobStatusCompleted, got.req.Status)
	require.Contains(t, got.req.Output.Stdout, "written before the restart")
	require.Contains(t, got.req.Output.Stdout, "written after it")

	_, ok := usedCapability.Load("cap-kept")
	require.True(t, ok, "the report must use the capability recovered from the container")

	removed, resumed, _ := rec.snapshot()
	require.Equal(t, []string{"kept"}, resumed)
	require.Empty(t, removed, "a job whose lease is still ours must not be removed")
	fx.waitActive(t, 0)
}

func TestReportedDurationCoversTheWholeRun(t *testing.T) {
	t.Parallel()
	fx, _ := newRecoveryFixture(t, leftoverJob("timed"))
	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	got := fx.waitComplete(t)
	require.GreaterOrEqual(t, got.req.Metrics.Duration, (90 * time.Second).Milliseconds(),
		"a job found after a restart started before this process")
}

func TestLeftoverWithoutItsLeaseIsRemovedAndNothingIsReported(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t, leftoverJob("gone"))
	fx.api.setHB(extendNothing)

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	removed, resumed, _ := rec.snapshot()
	require.Equal(t, []string{"gone"}, removed)
	require.Empty(t, resumed)
	require.Empty(t, fx.api.successfulCompletes(), "the sweeper already decided how this job ended")
	fx.waitActive(t, 0)
}

func TestLeftoverThatNeverStartedIsRemovedWithoutRenewingItsLease(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t, types.LeftoverJob{ID: "unstarted"})

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	removed, resumed, _ := rec.snapshot()
	require.Equal(t, []string{"unstarted"}, removed)
	require.Empty(t, resumed)
	select {
	case ids := <-fx.api.hbCh:
		t.Fatalf("renewed %v: its lease has to run out so the sweeper can fail or re-queue it", ids)
	default:
	}
}

func TestNothingIsTouchedOrClaimedUntilTheAppAnswers(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t, leftoverJob("waiting"))
	down := errors.New("app is restarting")
	fx.api.setHB(func([]string) (*api.JobsHeartbeatResponse, error) { return nil, down })

	err := fx.core.pollAndProcessJobs(context.Background())
	require.ErrorIs(t, err, down)

	removed, resumed, _ := rec.snapshot()
	require.Empty(t, removed, "an unanswered renewal says nothing about the lease")
	require.Empty(t, resumed)
	require.Empty(t, fx.api.limits(), "must not claim before leftovers are resolved")

	// The next poll tries again, and goes on to claim.
	fx.api.setHB(nil)
	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))
	require.Eventually(t, func() bool {
		_, resumed, _ = rec.snapshot()
		return len(resumed) == 1 && resumed[0] == "waiting"
	}, 2*time.Second, 2*time.Millisecond)
	require.NotEmpty(t, fx.api.limits())
}

func TestDockerFailureHoldsClaimsAndIsRetried(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	rec.findErr = errors.New("daemon restarting")

	require.Error(t, fx.core.pollAndProcessJobs(context.Background()))
	require.Empty(t, fx.api.limits())

	rec.mu.Lock()
	rec.findErr = nil
	rec.mu.Unlock()
	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))
	require.NotEmpty(t, fx.api.limits())
}

func TestLeftoversAreOnlyLookedForOnce(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	for range 3 {
		require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))
	}
	require.Equal(t, 1, rec.finds)
}

func TestRemovalFailureDoesNotHoldUpTheRest(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t, leftoverJob("a"), leftoverJob("b"))
	fx.api.setHB(extendNothing)
	rec.removeErr = errors.New("device busy")

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	removed, _, _ := rec.snapshot()
	require.ElementsMatch(t, []string{"a", "b"}, removed)
	require.NotEmpty(t, fx.api.limits())
}

func TestCancelRequestedWhileDownReachesTheResumedJob(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t, leftoverJob("to-cancel"))
	fx.api.setHB(func(ids []string) (*api.JobsHeartbeatResponse, error) {
		return &api.JobsHeartbeatResponse{Extended: ids, CancelRequested: ids}, nil
	})
	rec.resumeFn = func(ctx context.Context, _ *types.Job) (<-chan types.ExecutionUpdate, error) {
		ch := make(chan types.ExecutionUpdate, 1)
		go func() {
			defer close(ch)
			<-ctx.Done()
			ch <- completeUpdate(types.JobStatusFailed, -2)
		}()
		return ch, nil
	}

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	got := fx.waitComplete(t)
	require.Equal(t, "to-cancel", got.jobID)
	require.Equal(t, types.JobStatusCancelled, got.req.Status)
}

func TestResumedJobsCountTowardsTheConcurrencyLimit(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, func(cfg *daemonConfig) { cfg.maxConcurrent = 2; cfg.pollBatchSize = 10 })
	release := make(chan struct{})
	defer close(release)
	rec := &fakeRecovery{
		leftovers: []types.LeftoverJob{leftoverJob("x"), leftoverJob("y"), leftoverJob("z")},
		canHand:   make(map[string]bool),
		resumeFn: func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
			return blockingExecFn(release)(ctx, job)
		},
	}
	fx.core.recovery = rec

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	fx.waitActive(t, 3)
	require.Empty(t, fx.api.limits(), "over the limit: every running job is adopted, and nothing new is claimed")
}

func TestLeftoverRenewalsStayUnderWhatOneHeartbeatCarries(t *testing.T) {
	t.Parallel()
	var leftovers []types.LeftoverJob
	for i := range leftoverHeartbeatBatch*2 + 1 {
		leftovers = append(leftovers, types.LeftoverJob{ID: fmt.Sprintf("many-%d", i), Job: leftoverJob(fmt.Sprintf("many-%d", i)).Job})
	}
	fx, rec := newRecoveryFixture(t, leftovers...)
	release := make(chan struct{})
	defer close(release)
	rec.resumeFn = func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		return blockingExecFn(release)(ctx, job)
	}
	// Quiet: this test only counts the renewal the restart itself makes.
	fx.core.leaseRenewal = time.Hour

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	renewed := 0
	for range 3 {
		ids := <-fx.api.hbCh
		require.LessOrEqual(t, len(ids), leftoverHeartbeatBatch)
		renewed += len(ids)
	}
	require.Equal(t, len(leftovers), renewed)
	fx.waitActive(t, len(leftovers))
}

func TestResultIsReportedBeforeTheContainersAreReleased(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	reportedAtRelease := make(chan int, 1)
	rec.onRelease = func(string) { reportedAtRelease <- len(fx.api.successfulCompletes()) }

	fx.core.processJob(context.Background(), testJob("ordered"))

	select {
	case n := <-reportedAtRelease:
		require.Equal(t, 1, n, "the container is the only copy of the result until it's reported")
	case <-time.After(2 * time.Second):
		t.Fatal("containers were never released")
	}
}

func TestSpooledResultIsAlsoSafeToRelease(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	fx.api.setCompleteErr(func(string) error { return errors.New("app down") })
	spooledAtRelease := make(chan int, 1)
	rec.onRelease = func(string) { spooledAtRelease <- len(spoolFiles(t, fx.core.spoolDir)) }

	fx.core.processJob(context.Background(), testJob("spooled"))

	select {
	case n := <-spooledAtRelease:
		require.Equal(t, 1, n)
	case <-time.After(2 * time.Second):
		t.Fatal("containers were never released")
	}
}

// ---------- stopping ----------

func TestStoppingLeavesJobsTheNextProcessCanTakeOver(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	fx.core.shutdownWait = time.Minute
	release := make(chan struct{})
	defer close(release)
	cancelled := make(chan struct{})
	fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		go func() {
			<-ctx.Done()
			close(cancelled)
		}()
		return blockingExecFn(release)(ctx, job)
	})
	rec.canHand["running"] = true
	fx.api.pushBatch(testJob("running"))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		errCh <- fx.core.run(ctx)
		close(fx.core.done)
	}()
	select {
	case <-fx.exec.starts:
	case <-time.After(2 * time.Second):
		t.Fatal("job never started")
	}

	started := time.Now()
	fx.core.requestShutdown()
	require.NoError(t, <-errCh)
	require.Less(t, time.Since(started), 5*time.Second, "must not wait for a job that needs nothing from this process")

	// What main does next. The job's script has to survive it.
	cancel()
	select {
	case <-cancelled:
		t.Fatal("stopping cancelled a job left for the next process, which kills its container")
	case <-time.After(100 * time.Millisecond):
	}
	require.Empty(t, fx.api.successfulCompletes())
	require.True(t, fx.hasLogEntry("Leaving running jobs for the next orchestrator process to pick up"))
}

func TestStoppingWaitsForJobsItCannotLeave(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	fx.core.shutdownWait = time.Minute
	release := make(chan struct{})
	fx.exec.setFn(blockingExecFn(release))
	rec.canHand["handed-over"] = true
	fx.core.trackJob(context.Background(), testJob("handed-over"))
	go fx.core.processJob(fx.core.trackJob(context.Background(), testJob("remote")), testJob("remote"))
	select {
	case <-fx.exec.starts:
	case <-time.After(2 * time.Second):
		t.Fatal("job never started")
	}

	done := make(chan error, 1)
	go func() { done <- fx.core.gracefulShutdown() }()
	select {
	case <-done:
		t.Fatal("returned while a job that can't be left was running")
	case <-time.After(30 * time.Millisecond):
	}

	close(release)
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("never returned after the job ended")
	}
	require.Len(t, fx.api.successfulCompletes(), 1)
	require.True(t, fx.hasLogEntry("All jobs completed"))
}

func TestStoppingGivesUpOnJobsThatOutlastTheWaitWithoutReportingThem(t *testing.T) {
	t.Parallel()
	fx, rec := newRecoveryFixture(t)
	fx.core.shutdownWait = 30 * time.Millisecond
	fx.core.shutdownSettle = 2 * time.Second
	cleanedUp := make(chan struct{})
	fx.exec.setFn(func(ctx context.Context, _ *types.Job) (<-chan types.ExecutionUpdate, error) {
		ch := make(chan types.ExecutionUpdate, 1)
		go func() {
			defer close(ch)
			<-ctx.Done()
			close(cleanedUp)
			ch <- completeUpdate(types.JobStatusFailed, -2)
		}()
		return ch, nil
	})
	job := testJob("slow-remote")
	go fx.core.processJob(fx.core.trackJob(context.Background(), job), job)
	select {
	case <-fx.exec.starts:
	case <-time.After(2 * time.Second):
		t.Fatal("job never started")
	}

	require.NoError(t, fx.core.gracefulShutdown())

	select {
	case <-cleanedUp:
	default:
		t.Fatal("a job given up on must be told, so it can clean up")
	}
	fx.waitActive(t, 0)
	require.Empty(t, fx.api.successfulCompletes(), "reporting would pre-empt the sweeper, and 'cancelled' would be false")
	_, _, released := rec.snapshot()
	require.Equal(t, []string{"slow-remote"}, released)
	require.True(t, fx.hasLogEntry("Timeout waiting for jobs to complete"))
}

func TestStoppingDoesNotOutlastItsBoundsOnAJobThatIgnoresBeingCancelled(t *testing.T) {
	t.Parallel()
	fx, _ := newRecoveryFixture(t)
	fx.core.shutdownWait = 10 * time.Millisecond
	fx.core.shutdownSettle = 20 * time.Millisecond
	fx.core.trackJob(context.Background(), testJob("stuck"))

	started := time.Now()
	require.NoError(t, fx.core.gracefulShutdown())
	require.Less(t, time.Since(started), 2*time.Second)
}

// ---------- spool ----------

func TestSpoolIsDeliveredOnStartingNotOnTheFirstTick(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.spoolCompletion("from-last-run", &api.CompleteJobRequest{Status: types.JobStatusCompleted}, "cap")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go fx.core.spoolRetryLoop(ctx) // the fixture's tick is an hour

	require.Equal(t, "from-last-run", fx.waitComplete(t).jobID)
}
