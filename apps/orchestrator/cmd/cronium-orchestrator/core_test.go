package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------- claim batching / MaxConcurrent ----------

func TestPollClaimLimitRespectsMaxConcurrent(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, func(cfg *daemonConfig) {
		cfg.maxConcurrent = 3
		cfg.pollBatchSize = 10
	})
	release := make(chan struct{})
	fx.exec.setFn(blockingExecFn(release))
	ctx := context.Background()

	// 0 busy -> claims min(3-0, 10) = 3; server hands back only 2.
	fx.api.pushBatch(testJob("a"), testJob("b"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	require.Equal(t, []int{3}, fx.api.limits())
	fx.waitActive(t, 2)

	// 2 busy -> claims at most maxConcurrent-2 = 1.
	fx.api.pushBatch(testJob("c"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	require.Equal(t, []int{3, 1}, fx.api.limits())
	fx.waitActive(t, 3)

	// All slots busy -> does not call ClaimJobs at all.
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	require.Equal(t, []int{3, 1}, fx.api.limits())
	require.True(t, fx.hasLogEntry("At maximum concurrent jobs, skipping poll"))

	// Release the jobs; every one of them reports completion and frees a slot.
	close(release)
	for i := 0; i < 3; i++ {
		fx.waitComplete(t)
	}
	fx.waitActive(t, 0)

	// Capacity restored -> claims full batch again.
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	require.Equal(t, []int{3, 1, 3}, fx.api.limits())
}

func TestPollClaimLimitCappedByPollBatchSize(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, func(cfg *daemonConfig) {
		cfg.maxConcurrent = 5
		cfg.pollBatchSize = 2
	})
	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))
	require.Equal(t, []int{2}, fx.api.limits())
}

func TestPollSkipsWhenShuttingDown(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.mu.Lock()
	fx.core.isShuttingDown = true
	fx.core.mu.Unlock()

	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))
	require.Empty(t, fx.api.limits(), "shutting-down orchestrator must not claim jobs")
}

func TestPollPropagatesClaimError(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.api.claimErr = errors.New("app unreachable")
	err := fx.core.pollAndProcessJobs(context.Background())
	require.ErrorContains(t, err, "failed to claim jobs")
}

// ---------- claim-is-ack: exactly one terminal report per claimed job ----------

func TestEveryClaimedJobEndsInExactlyOneTerminalReport(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		switch job.ID {
		case "err":
			return nil, errors.New("boom-start")
		case "panic":
			panic("boom-panic")
		default:
			return preloadedUpdates(completeUpdate(types.JobStatusCompleted, 0)), nil
		}
	})

	fx.api.pushBatch(testJob("err"), testJob("panic"), testJob("ok"))
	require.NoError(t, fx.core.pollAndProcessJobs(context.Background()))

	// All three jobs settle and release their slots — none is stuck or lost.
	fx.waitActive(t, 0)

	terminalReports := map[string]int{}
	for _, s := range fx.api.statusReports() {
		if s.status == types.JobStatusFailed {
			terminalReports[s.jobID]++
		}
	}
	for _, c := range fx.api.successfulCompletes() {
		terminalReports[c.jobID]++
	}
	require.Equal(t, map[string]int{"err": 1, "panic": 1, "ok": 1}, terminalReports,
		"every claimed job must end in exactly one terminal report")

	// The failure paths reported through UpdateJobStatus with details.
	var sawErr, sawPanic bool
	for _, s := range fx.api.statusReports() {
		switch s.jobID {
		case "err":
			sawErr = true
			assert.Equal(t, "boom-start", s.update.Message)
		case "panic":
			sawPanic = true
			assert.Contains(t, s.update.Message, "executor panic: boom-panic")
		}
	}
	require.True(t, sawErr)
	require.True(t, sawPanic)

	// The success path reported through CompleteJob.
	completes := fx.api.successfulCompletes()
	require.Len(t, completes, 1)
	require.Equal(t, "ok", completes[0].jobID)
	require.Equal(t, types.JobStatusCompleted, completes[0].req.Status)

	// Slot accounting balances even across error/panic paths.
	require.Equal(t, 0, fx.metrics.activeCount())
}

// Regression test for the panic-containment fix: a panicking executor used to
// unwind the processJob goroutine and crash the entire daemon (killing every
// other in-flight job). Now the panic is contained, the job is reported
// failed, and the daemon keeps claiming and running jobs.
func TestExecutorPanicIsContainedAndDaemonStaysAlive(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		if job.ID == "kaboom" {
			panic("executor exploded")
		}
		return preloadedUpdates(completeUpdate(types.JobStatusCompleted, 0)), nil
	})
	ctx := context.Background()

	fx.api.pushBatch(testJob("kaboom"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))

	rec := fx.waitStatus(t)
	require.Equal(t, "kaboom", rec.jobID)
	require.Equal(t, types.JobStatusFailed, rec.status)
	require.Contains(t, rec.update.Message, "executor panic: executor exploded")
	fx.waitActive(t, 0)
	require.Contains(t, fx.metrics.failures(), "container/executor_panic")

	// The daemon is still functional afterwards.
	fx.api.pushBatch(testJob("after"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	rec2 := fx.waitComplete(t)
	require.Equal(t, "after", rec2.jobID)
	require.Equal(t, types.JobStatusCompleted, rec2.req.Status)
}

// ---------- processJob status mapping + reporting ----------

func TestProcessJobStatusMapping(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		update       types.ExecutionUpdate
		wantStatus   types.JobStatus
		wantFailWith string // metric reason, empty = success metric
	}{
		{"exit 0 completes", completeUpdate(types.JobStatusCompleted, 0), types.JobStatusCompleted, ""},
		{"non-zero exit fails", completeUpdate(types.JobStatusFailed, 7), types.JobStatusFailed, "non_zero_exit"},
		{"exit >= 100 is partial failure", completeUpdate(types.JobStatusFailed, 101), types.JobStatusFailed, "partial_failure"},
		{"exit -1 is timeout", completeUpdate(types.JobStatusFailed, -1), types.JobStatusTimeout, "timeout"},
		{"exit -2 is cancelled", completeUpdate(types.JobStatusFailed, -2), types.JobStatusCancelled, "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fx := newCoreFixture(t, nil)
			fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
				return preloadedUpdates(tc.update), nil
			})
			fx.core.processJob(context.Background(), testJob("j"))

			rec := fx.waitComplete(t)
			require.Equal(t, tc.wantStatus, rec.req.Status)
			if tc.wantFailWith == "" {
				require.Contains(t, fx.metrics.completed, "container")
			} else {
				require.Contains(t, fx.metrics.failures(), "container/"+tc.wantFailWith)
			}
		})
	}
}

func TestProcessJobForwardsLogsAndIntermediateStatus(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	running := types.JobStatusRunning
	fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		return preloadedUpdates(
			types.ExecutionUpdate{Type: types.UpdateTypeStatus, Data: &types.StatusUpdate{Status: running}},
			logUpdate("stdout", "out-line"),
			logUpdate("stderr", "err-line"),
			types.ExecutionUpdate{Type: types.UpdateTypeError, Data: &types.StatusUpdate{Message: "transient hiccup"}},
			completeUpdate(types.JobStatusCompleted, 0),
		), nil
	})
	fx.core.processJob(context.Background(), testJob("logs"))

	// Intermediate status reported as-is.
	st := fx.waitStatus(t)
	require.Equal(t, types.JobStatusRunning, st.status)

	rec := fx.waitComplete(t)
	require.Equal(t, types.JobStatusCompleted, rec.req.Status)
	require.Equal(t, "out-line\n", rec.req.Output.Stdout)
	require.Equal(t, "err-line\n", rec.req.Output.Stderr)
	require.Equal(t, 0, rec.req.OutputTruncatedBytes)

	// The UpdateTypeError branch logged the execution error.
	require.True(t, fx.hasLogEntry("Execution error"))
}

// ---------- output capping through processJob ----------

func TestProcessJobCapsOversizedOutput(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.outputCapBytes = 32 // halfCap = 16 per stream

	updates := make([]types.ExecutionUpdate, 0, 11)
	for i := 0; i < 10; i++ {
		updates = append(updates, logUpdate("stdout", "0123456789")) // 11 bytes per line
	}
	updates = append(updates, completeUpdate(types.JobStatusCompleted, 0))
	fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		return preloadedUpdates(updates...), nil
	})

	fx.core.processJob(context.Background(), testJob("big"))
	rec := fx.waitComplete(t)

	// 110 bytes total; head keeps the first 16, tail the last 16, 78 omitted.
	require.Equal(t,
		"0123456789\n01234\n... [output truncated: 78 bytes omitted] ...\n6789\n0123456789\n",
		rec.req.Output.Stdout)
	require.Equal(t, 78, rec.req.OutputTruncatedBytes)
	require.Empty(t, rec.req.Output.Stderr)
}

// ---------- lease heartbeat: cancellation + self-fencing ----------

func TestLeaseHeartbeatCancellationAbortsRunningJob(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.exec.setFn(blockingExecFn(nil)) // only the job context can end it
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fx.api.pushBatch(testJob("victim"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	fx.waitActive(t, 1)

	fx.api.setHB(func(ids []string) (*api.JobsHeartbeatResponse, error) {
		return &api.JobsHeartbeatResponse{CancelRequested: []string{"victim"}}, nil
	})
	go fx.core.leaseHeartbeatLoop(ctx)

	// The heartbeat carried our in-flight job.
	select {
	case ids := <-fx.api.hbCh:
		require.Equal(t, []string{"victim"}, ids)
	case <-time.After(2 * time.Second):
		t.Fatal("lease heartbeat never sent")
	}

	rec := fx.waitComplete(t)
	require.Equal(t, "victim", rec.jobID)
	require.Equal(t, types.JobStatusCancelled, rec.req.Status)
	require.True(t, fx.hasLogEntry("Aborting job execution"))
	// The status message is logged after the completion report lands.
	fx.waitLogEntry(t, "Job cancelled") // the 'requested' flavor, not a fence
	fx.waitActive(t, 0)
}

func TestLeaseNotExtendedFencesJob(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.exec.setFn(blockingExecFn(nil))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fx.api.pushBatch(testJob("stale"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	fx.waitActive(t, 1)

	// App answers but declines to extend the lease: the job is no longer ours.
	fx.api.setHB(func(ids []string) (*api.JobsHeartbeatResponse, error) {
		return &api.JobsHeartbeatResponse{Extended: []string{}}, nil
	})
	go fx.core.leaseHeartbeatLoop(ctx)

	rec := fx.waitComplete(t)
	require.Equal(t, types.JobStatusCancelled, rec.req.Status)
	// The fenced status message is logged after the completion report lands.
	fx.waitLogEntry(t,
		"Job aborted: lease renewal failed (self-fence); the scheduler will retry or fail it per policy")
	fx.waitActive(t, 0)
}

func TestLeaseRenewalFailurePastWindowSelfFences(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, func(cfg *daemonConfig) {
		cfg.leaseRenewal = 10 * time.Millisecond
	})
	fx.core.fenceAfter = 25 * time.Millisecond
	fx.exec.setFn(blockingExecFn(nil))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fx.api.pushBatch(testJob("fenced"))
	require.NoError(t, fx.core.pollAndProcessJobs(ctx))
	fx.waitActive(t, 1)

	fx.api.setHB(func(ids []string) (*api.JobsHeartbeatResponse, error) {
		return nil, errors.New("app down")
	})
	go fx.core.leaseHeartbeatLoop(ctx)

	rec := fx.waitComplete(t)
	require.Equal(t, types.JobStatusCancelled, rec.req.Status)
	require.True(t, fx.hasLogEntry(
		"Lease renewal failing past the lease window; self-fencing (aborting in-flight jobs)"))
	fx.waitActive(t, 0)
}

func TestCancelJobRecordsFirstReasonOnly(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	fx.core.mu.Lock()
	fx.core.activeJobs["j"] = testJob("j")
	fx.core.activeCancels["j"] = cancel
	fx.core.mu.Unlock()

	fx.core.cancelJob("j", "requested")
	fx.core.cancelJob("j", "fenced")

	fx.core.mu.RLock()
	defer fx.core.mu.RUnlock()
	require.Equal(t, "requested", fx.core.cancelReasons["j"])
}

func TestCancelJobUnknownIDIsNoOp(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.cancelJob("ghost", "requested")
	require.False(t, fx.hasLogEntry("Aborting job execution"))
}

// ---------- run loop + graceful shutdown ----------

func TestRunClaimsExecutesAndShutsDownOnRequest(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.api.pushBatch(testJob("run-1"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // stops the background loops run() spawned

	errCh := make(chan error, 1)
	go func() {
		errCh <- fx.core.run(ctx)
		close(fx.core.done)
	}()

	rec := fx.waitComplete(t)
	require.Equal(t, "run-1", rec.jobID)
	require.Equal(t, types.JobStatusCompleted, rec.req.Status)

	fx.core.requestShutdown() // blocks until run returned and done closed
	require.NoError(t, <-errCh)
	require.True(t, fx.hasLogEntry("Shutdown requested"))
	require.True(t, fx.hasLogEntry("Starting graceful shutdown"))
}

func TestRunStopsOnContextCancel(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() { errCh <- fx.core.run(ctx) }()

	// Let at least one poll happen so the loop is demonstrably alive.
	require.Eventually(t, func() bool { return len(fx.api.limits()) > 0 }, 2*time.Second, 2*time.Millisecond)

	cancel()
	select {
	case err := <-errCh:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("run did not stop on context cancel")
	}
	require.True(t, fx.hasLogEntry("Context cancelled, shutting down orchestrator"))
}

func TestGracefulShutdownWaitsForActiveJobThenReturns(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, func(cfg *daemonConfig) { cfg.maxConcurrent = 1 })
	release := make(chan struct{})
	fx.exec.setFn(blockingExecFn(release))
	fx.api.pushBatch(testJob("slow"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // stops the background loops run() spawned

	errCh := make(chan error, 1)
	go func() {
		errCh <- fx.core.run(ctx)
		close(fx.core.done)
	}()

	// Wait until the job is actually executing.
	select {
	case <-fx.exec.starts:
	case <-time.After(2 * time.Second):
		t.Fatal("job never started")
	}

	shutDone := make(chan struct{})
	go func() {
		fx.core.requestShutdown()
		close(shutDone)
	}()

	// Shutdown must not complete while the job is still running.
	select {
	case <-shutDone:
		t.Fatal("shutdown returned before the active job finished")
	case <-time.After(30 * time.Millisecond):
	}

	close(release)
	select {
	case <-shutDone:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown never finished after the job completed")
	}
	require.NoError(t, <-errCh)

	// The in-flight job's completion was delivered before shutdown finished.
	completes := fx.api.successfulCompletes()
	require.Len(t, completes, 1)
	require.Equal(t, "slow", completes[0].jobID)
	require.True(t, fx.hasLogEntry("All jobs completed"))
}

func TestGracefulShutdownTimesOutOnStuckJob(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.shutdownWait = 30 * time.Millisecond
	fx.core.shutdownTick = 5 * time.Millisecond

	// A job that never finishes.
	fx.core.mu.Lock()
	fx.core.activeJobs["stuck"] = testJob("stuck")
	fx.core.mu.Unlock()

	require.NoError(t, fx.core.gracefulShutdown())
	require.True(t, fx.hasLogEntry("Timeout waiting for jobs to complete"))
}

// ---------- telemetry loops ----------

func TestHeartbeatLoopReportsCapacityImmediately(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, func(cfg *daemonConfig) { cfg.maxConcurrent = 4 })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Injectable clock: pin the exact timestamp the heartbeat must carry.
	fixedNow := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	fx.core.now = func() time.Time { return fixedNow }

	fx.core.mu.Lock()
	fx.core.activeJobs["busy"] = testJob("busy")
	fx.core.mu.Unlock()

	go fx.core.heartbeatLoop(ctx) // sends once immediately, then hourly

	select {
	case req := <-fx.api.heartbeatCh:
		require.Equal(t, "orch-test", req.OrchestratorID)
		require.Equal(t, []string{"busy"}, req.RunningJobs)
		require.Equal(t, 4, req.Capacity.MaxJobs)
		require.Equal(t, 1, req.Capacity.CurrentJobs)
		require.Equal(t, 3, req.Capacity.AvailableSlots)
		// Regression (FINDINGS #38): heartbeatLoop must stamp the request
		// itself — RFC3339, from the injected clock.
		require.Equal(t, fixedNow.Format(time.RFC3339), req.Timestamp)
	case <-time.After(2 * time.Second):
		t.Fatal("heartbeat never sent")
	}
}

func TestMetricsLoopReportsLifetimeCounters(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.metricsInterval = 10 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fx.core.jobsProcessed.Add(5)
	fx.core.jobsSucceeded.Add(3)
	fx.core.jobsFailed.Add(2)

	go fx.core.metricsLoop(ctx)

	select {
	case req := <-fx.api.metricsCh:
		require.Equal(t, "orch-test", req.OrchestratorID)
		require.Equal(t, "minute", req.Period)
		require.Equal(t, int64(5), req.Metrics.JobsProcessed)
		require.Equal(t, int64(3), req.Metrics.JobsSucceeded)
		require.Equal(t, int64(2), req.Metrics.JobsFailed)
	case <-time.After(2 * time.Second):
		t.Fatal("metrics never sent")
	}
}

func TestHealthCheckLoopLogsFailures(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.healthCheckInterval = 10 * time.Millisecond
	fx.api.mu.Lock()
	fx.api.healthErr = errors.New("api down")
	fx.api.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go fx.core.healthCheckLoop(ctx)

	select {
	case <-fx.api.healthCh:
	case <-time.After(2 * time.Second):
		t.Fatal("health check never ran")
	}
	require.Eventually(t, func() bool {
		for _, e := range fx.hook.AllEntries() {
			if strings.Contains(e.Message, "API health check failed") {
				return true
			}
		}
		return false
	}, 2*time.Second, 2*time.Millisecond)
}
