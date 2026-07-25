package main

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	logtest "github.com/sirupsen/logrus/hooks/test"
	"github.com/stretchr/testify/require"
)

// ---------- fake API client ----------

type completeRec struct {
	jobID string
	req   *api.CompleteJobRequest
}

type statusRec struct {
	jobID  string
	status types.JobStatus
	update *types.StatusUpdate
}

// fakeAPI is a channel-instrumented in-memory jobAPI implementation.
type fakeAPI struct {
	mu sync.Mutex

	claimBatches [][]*types.Job
	claimLimits  []int
	claimErr     error

	completeErrFn func(jobID string) error
	completes     []completeRec // successful deliveries only
	completeCh    chan completeRec

	statuses []statusRec
	statusCh chan statusRec

	hbFn func(ids []string) (*api.JobsHeartbeatResponse, error)
	hbCh chan []string

	heartbeatCh chan *api.HeartbeatRequest
	metricsCh   chan *api.MetricsRequest
	healthErr   error
	healthCh    chan struct{}
}

func newFakeAPI() *fakeAPI {
	return &fakeAPI{
		completeCh:  make(chan completeRec, 64),
		statusCh:    make(chan statusRec, 64),
		hbCh:        make(chan []string, 64),
		heartbeatCh: make(chan *api.HeartbeatRequest, 64),
		metricsCh:   make(chan *api.MetricsRequest, 64),
		healthCh:    make(chan struct{}, 64),
	}
}

func (f *fakeAPI) pushBatch(jobs ...*types.Job) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.claimBatches = append(f.claimBatches, jobs)
}

func (f *fakeAPI) limits() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]int, len(f.claimLimits))
	copy(out, f.claimLimits)
	return out
}

func (f *fakeAPI) successfulCompletes() []completeRec {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]completeRec, len(f.completes))
	copy(out, f.completes)
	return out
}

func (f *fakeAPI) statusReports() []statusRec {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]statusRec, len(f.statuses))
	copy(out, f.statuses)
	return out
}

func (f *fakeAPI) setCompleteErr(fn func(jobID string) error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.completeErrFn = fn
}

func (f *fakeAPI) setHB(fn func(ids []string) (*api.JobsHeartbeatResponse, error)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hbFn = fn
}

func (f *fakeAPI) ClaimJobs(_ context.Context, limit int) ([]*types.Job, error) {
	f.mu.Lock()
	f.claimLimits = append(f.claimLimits, limit)
	var batch []*types.Job
	if len(f.claimBatches) > 0 {
		batch = f.claimBatches[0]
		f.claimBatches = f.claimBatches[1:]
	}
	err := f.claimErr
	f.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return batch, nil
}

func (f *fakeAPI) JobsHeartbeat(_ context.Context, jobIDs []string) (*api.JobsHeartbeatResponse, error) {
	ids := make([]string, len(jobIDs))
	copy(ids, jobIDs)
	f.mu.Lock()
	fn := f.hbFn
	f.mu.Unlock()
	f.hbCh <- ids
	if fn != nil {
		return fn(ids)
	}
	// Default: extend everything, cancel nothing.
	return &api.JobsHeartbeatResponse{Extended: ids}, nil
}

func (f *fakeAPI) UpdateJobStatus(_ context.Context, jobID string, status types.JobStatus, details *types.StatusUpdate) error {
	rec := statusRec{jobID: jobID, status: status, update: details}
	f.mu.Lock()
	f.statuses = append(f.statuses, rec)
	f.mu.Unlock()
	f.statusCh <- rec
	return nil
}

func (f *fakeAPI) CompleteJob(_ context.Context, jobID string, req *api.CompleteJobRequest) error {
	f.mu.Lock()
	fn := f.completeErrFn
	f.mu.Unlock()
	if fn != nil {
		if err := fn(jobID); err != nil {
			return err
		}
	}
	rec := completeRec{jobID: jobID, req: req}
	f.mu.Lock()
	f.completes = append(f.completes, rec)
	f.mu.Unlock()
	f.completeCh <- rec
	return nil
}

func (f *fakeAPI) SendHeartbeat(_ context.Context, req *api.HeartbeatRequest) error {
	f.heartbeatCh <- req
	return nil
}

func (f *fakeAPI) SendMetrics(_ context.Context, req *api.MetricsRequest) error {
	f.metricsCh <- req
	return nil
}

func (f *fakeAPI) HealthCheck(_ context.Context) error {
	f.mu.Lock()
	err := f.healthErr
	f.mu.Unlock()
	f.healthCh <- struct{}{}
	return err
}

// ---------- fake executor ----------

type fakeExecutor struct {
	mu     sync.Mutex
	fn     func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error)
	starts chan *types.Job
}

func newFakeExecutor() *fakeExecutor {
	return &fakeExecutor{starts: make(chan *types.Job, 64)}
}

func (f *fakeExecutor) setFn(fn func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fn = fn
}

func (f *fakeExecutor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	f.starts <- job
	f.mu.Lock()
	fn := f.fn
	f.mu.Unlock()
	if fn == nil {
		// Default: immediate clean completion (channel closes with no updates).
		ch := make(chan types.ExecutionUpdate)
		close(ch)
		return ch, nil
	}
	return fn(ctx, job)
}

// blockingExecFn returns an executor fn whose update channel closes only when
// release is closed or the job context is cancelled.
func blockingExecFn(release <-chan struct{}) func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	return func(ctx context.Context, _ *types.Job) (<-chan types.ExecutionUpdate, error) {
		ch := make(chan types.ExecutionUpdate)
		go func() {
			defer close(ch)
			select {
			case <-release:
			case <-ctx.Done():
			}
		}()
		return ch, nil
	}
}

// preloadedUpdates builds a closed updates channel carrying the given updates.
func preloadedUpdates(updates ...types.ExecutionUpdate) <-chan types.ExecutionUpdate {
	ch := make(chan types.ExecutionUpdate, len(updates))
	for _, u := range updates {
		ch <- u
	}
	close(ch)
	return ch
}

func logUpdate(stream, line string) types.ExecutionUpdate {
	return types.ExecutionUpdate{
		Type: types.UpdateTypeLog,
		Data: &types.LogEntry{Stream: stream, Line: line, Timestamp: time.Now()},
	}
}

func completeUpdate(status types.JobStatus, exitCode int) types.ExecutionUpdate {
	ec := exitCode
	return types.ExecutionUpdate{
		Type: types.UpdateTypeComplete,
		Data: &types.StatusUpdate{Status: status, ExitCode: &ec},
	}
}

// ---------- fake log streamer ----------

type fakeSink struct {
	mu      sync.Mutex
	entries []*types.LogEntry
}

func (s *fakeSink) AddLog(logEntry *types.LogEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = append(s.entries, logEntry)
}

func (s *fakeSink) lines() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.entries))
	for _, e := range s.entries {
		out = append(out, e.Line)
	}
	return out
}

type fakeStreamer struct {
	mu      sync.Mutex
	sinks   map[string]*fakeSink
	stopped []string
}

func newFakeStreamer() *fakeStreamer {
	return &fakeStreamer{sinks: make(map[string]*fakeSink)}
}

func (f *fakeStreamer) StartJob(jobID string) jobLogSink {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := &fakeSink{}
	f.sinks[jobID] = s
	return s
}

func (f *fakeStreamer) StopJob(jobID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped = append(f.stopped, jobID)
}

func (f *fakeStreamer) sink(jobID string) *fakeSink {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sinks[jobID]
}

func (f *fakeStreamer) stoppedJobs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.stopped))
	copy(out, f.stopped)
	return out
}

// ---------- fake metrics ----------

type fakeMetrics struct {
	mu        sync.Mutex
	received  []string
	completed []string
	failed    []string // "type/reason"
	active    int
}

func (m *fakeMetrics) RecordJobReceived(jobType string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.received = append(m.received, jobType)
}

func (m *fakeMetrics) RecordJobCompleted(jobType string, _ float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.completed = append(m.completed, jobType)
}

func (m *fakeMetrics) RecordJobFailed(jobType, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failed = append(m.failed, jobType+"/"+reason)
}

func (m *fakeMetrics) IncActiveJobs() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active++
}

func (m *fakeMetrics) DecActiveJobs() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active--
}

func (m *fakeMetrics) failures() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.failed))
	copy(out, m.failed)
	return out
}

func (m *fakeMetrics) activeCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.active
}

// ---------- fixture ----------

type coreFixture struct {
	core    *daemonCore
	api     *fakeAPI
	exec    *fakeExecutor
	stream  *fakeStreamer
	metrics *fakeMetrics
	hook    *logtest.Hook
}

func newCoreFixture(t *testing.T, mutate func(cfg *daemonConfig)) *coreFixture {
	t.Helper()

	fapi := newFakeAPI()
	exec := newFakeExecutor()
	stream := newFakeStreamer()
	met := &fakeMetrics{}

	logg, hook := logtest.NewNullLogger()
	logg.SetLevel(logrus.DebugLevel)

	cfg := daemonConfig{
		orchestratorID: "orch-test",
		spoolDir:       t.TempDir(),
		maxConcurrent:  5,
		pollBatchSize:  10,
		pollInterval:   5 * time.Millisecond,
		leaseRenewal:   10 * time.Millisecond,
	}
	if mutate != nil {
		mutate(&cfg)
	}

	c := newDaemonCore(daemonDeps{
		log:      logg,
		api:      fapi,
		executor: exec,
		streamer: stream,
		metrics:  met,
	}, cfg)

	// Quiesce the background loops that individual tests don't exercise and
	// bound everything that waits, so tests stay fast and deterministic.
	c.healthCheckInterval = time.Hour
	c.heartbeatInterval = time.Hour
	c.metricsInterval = time.Hour
	c.spoolRetryInterval = time.Hour
	c.fenceAfter = time.Hour
	c.leaseHBTimeout = time.Second
	c.reportTimeout = 2 * time.Second
	c.spoolReportTimeout = time.Second
	c.shutdownWait = 500 * time.Millisecond
	c.shutdownTick = 5 * time.Millisecond

	return &coreFixture{core: c, api: fapi, exec: exec, stream: stream, metrics: met, hook: hook}
}

func testJob(id string) *types.Job {
	return &types.Job{ID: id, Type: types.JobTypeContainer, CapabilityToken: "cap-" + id}
}

func (fx *coreFixture) waitActive(t *testing.T, n int) {
	t.Helper()
	require.Eventually(t, func() bool {
		fx.core.mu.RLock()
		defer fx.core.mu.RUnlock()
		return len(fx.core.activeJobs) == n
	}, 2*time.Second, 2*time.Millisecond, "expected %d active jobs", n)
}

func (fx *coreFixture) waitComplete(t *testing.T) completeRec {
	t.Helper()
	select {
	case rec := <-fx.api.completeCh:
		return rec
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a completion report")
		return completeRec{}
	}
}

func (fx *coreFixture) waitStatus(t *testing.T) statusRec {
	t.Helper()
	select {
	case rec := <-fx.api.statusCh:
		return rec
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a status report")
		return statusRec{}
	}
}

// hasLogEntry reports whether the hook captured an entry containing msg.
func (fx *coreFixture) hasLogEntry(msg string) bool {
	for _, e := range fx.hook.AllEntries() {
		if e.Message == msg {
			return true
		}
	}
	return false
}

// waitLogEntry waits for a log entry that is emitted asynchronously (e.g. the
// completion status message, logged after the CompleteJob call returns).
func (fx *coreFixture) waitLogEntry(t *testing.T, msg string) {
	t.Helper()
	require.Eventually(t, func() bool { return fx.hasLogEntry(msg) },
		2*time.Second, 2*time.Millisecond, "log entry %q never appeared", msg)
}
