package main

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/metrics"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// Narrow, locally-defined collaborator interfaces so the daemon core can be
// exercised with fakes. The concrete types from internal/api, internal/
// executors and internal/metrics satisfy them as-is (see the compile-time
// assertions below); nothing in internal/ needed to change.

// jobAPI is the subset of *api.Client the daemon core uses.
type jobAPI interface {
	ClaimJobs(ctx context.Context, limit int) ([]*types.Job, error)
	JobsHeartbeat(ctx context.Context, jobIDs []string) (*api.JobsHeartbeatResponse, error)
	UpdateJobStatus(ctx context.Context, jobID string, status types.JobStatus, details *types.StatusUpdate) error
	CompleteJob(ctx context.Context, jobID string, req *api.CompleteJobRequest) error
	SendHeartbeat(ctx context.Context, req *api.HeartbeatRequest) error
	SendMetrics(ctx context.Context, req *api.MetricsRequest) error
	HealthCheck(ctx context.Context) error
}

// jobExecutor is the subset of *executors.Manager the daemon core uses.
type jobExecutor interface {
	Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error)
}

// jobMetrics is the subset of *metrics.Collector the daemon core uses.
type jobMetrics interface {
	RecordJobReceived(jobType string)
	RecordJobCompleted(jobType string, duration float64)
	RecordJobFailed(jobType, reason string)
	IncActiveJobs()
	DecActiveJobs()
}

// Compile-time proof the concrete collaborators satisfy the local interfaces.
var (
	_ jobAPI      = (*api.Client)(nil)
	_ jobExecutor = (*executors.Manager)(nil)
	_ jobMetrics  = (*metrics.Collector)(nil)
)

// daemonDeps are the injectable collaborators of the daemon core.
type daemonDeps struct {
	log      *logrus.Logger
	api      jobAPI
	executor jobExecutor
	metrics  jobMetrics
}

// daemonConfig carries the config knobs the daemon core actually uses.
type daemonConfig struct {
	orchestratorID string
	spoolDir       string
	maxConcurrent  int
	pollBatchSize  int
	pollInterval   time.Duration
	leaseRenewal   time.Duration
}

// daemonCore owns the orchestrator control loops: poll/claim/dispatch,
// per-job execution and reporting, lease renewal + cancellation +
// self-fencing, completion spooling, and the telemetry loops. It talks to its
// collaborators only through the narrow interfaces above.
type daemonCore struct {
	log      *logrus.Logger
	api      jobAPI
	executor jobExecutor
	metrics  jobMetrics

	orchestratorID string
	spoolDir       string
	maxConcurrent  int
	pollBatchSize  int
	pollInterval   time.Duration
	leaseRenewal   time.Duration

	// Timing knobs (previously inline constants; defaults preserve the
	// historical values, tests may shrink them).
	healthCheckInterval time.Duration // API health check loop tick
	heartbeatInterval   time.Duration // orchestrator heartbeat loop tick
	metricsInterval     time.Duration // metrics loop tick
	spoolRetryInterval  time.Duration // spool retry loop tick
	fenceAfter          time.Duration // must match app-side DEFAULT_CLAIM_LEASE_MS
	leaseHBTimeout      time.Duration // per lease-heartbeat request timeout
	reportTimeout       time.Duration // detached completion/failure report timeout
	spoolReportTimeout  time.Duration // per spooled-completion retry timeout
	shutdownWait        time.Duration // graceful shutdown bound
	shutdownTick        time.Duration // graceful shutdown poll interval

	// Per-stream in-memory output cap (see cappedCapture).
	outputCapBytes int

	// now is the clock used for wall-time stamps (heartbeat timestamps);
	// injectable so tests can pin the emitted value.
	now func() time.Time

	// withCapability decorates a context with the per-job capability token
	// (api.WithJobCapability); injectable so tests can observe which token a
	// reporting call carries.
	withCapability func(ctx context.Context, token string) context.Context

	// Control channels
	shutdown chan struct{}
	done     chan struct{}

	// State
	mu             sync.RWMutex
	activeJobs     map[string]*types.Job
	activeCancels  map[string]context.CancelFunc
	cancelReasons  map[string]string // jobID -> "requested" | "fenced"
	isShuttingDown bool

	// Lifetime counters (atomic) for heartbeat/metrics reporting
	jobsProcessed atomic.Int64
	jobsSucceeded atomic.Int64
	jobsFailed    atomic.Int64
	startedAt     time.Time
}

// newDaemonCore builds a daemon core with the historical timing defaults.
func newDaemonCore(deps daemonDeps, cfg daemonConfig) *daemonCore {
	return &daemonCore{
		log:      deps.log,
		api:      deps.api,
		executor: deps.executor,
		metrics:  deps.metrics,

		orchestratorID: cfg.orchestratorID,
		spoolDir:       cfg.spoolDir,
		maxConcurrent:  cfg.maxConcurrent,
		pollBatchSize:  cfg.pollBatchSize,
		pollInterval:   cfg.pollInterval,
		leaseRenewal:   cfg.leaseRenewal,

		healthCheckInterval: 30 * time.Second,
		heartbeatInterval:   30 * time.Second,
		metricsInterval:     60 * time.Second,
		spoolRetryInterval:  time.Minute,
		fenceAfter:          60 * time.Second,
		leaseHBTimeout:      15 * time.Second,
		reportTimeout:       60 * time.Second,
		spoolReportTimeout:  30 * time.Second,
		shutdownWait:        30 * time.Second,
		shutdownTick:        1 * time.Second,

		outputCapBytes: outputStreamCapBytes,
		now:            time.Now,
		withCapability: api.WithJobCapability,

		shutdown:      make(chan struct{}),
		done:          make(chan struct{}),
		activeJobs:    make(map[string]*types.Job),
		activeCancels: make(map[string]context.CancelFunc),
		cancelReasons: make(map[string]string),
	}
}

// run starts the daemon control loops and blocks on the job polling loop
// until the context is cancelled or a shutdown is requested. The caller owns
// closing c.done after run returns (SimpleOrchestrator.Run defers it so that
// Shutdown() only unblocks once every deferred cleanup has finished).
func (c *daemonCore) run(ctx context.Context) error {
	// Start API health check
	go c.healthCheckLoop(ctx)

	// Start telemetry loops (heartbeat + metrics reporting)
	c.startedAt = time.Now()
	go c.heartbeatLoop(ctx)
	go c.metricsLoop(ctx)

	// Lease renewal + cancellation channel + self-fencing (PLAN.md §4.2)
	go c.leaseHeartbeatLoop(ctx)

	// Retry spooled completions that previous runs could not deliver
	go c.spoolRetryLoop(ctx)

	// Start job polling loop
	pollTicker := time.NewTicker(c.pollInterval)
	defer pollTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			c.log.Info("Context cancelled, shutting down orchestrator")
			return c.gracefulShutdown()

		case <-c.shutdown:
			c.log.Info("Shutdown requested")
			return c.gracefulShutdown()

		case <-pollTicker.C:
			if err := c.pollAndProcessJobs(ctx); err != nil {
				c.log.WithError(err).Error("Failed to poll jobs")
			}
		}
	}
}

// requestShutdown initiates a graceful shutdown and waits for run's caller to
// finish (done is closed by the caller after run returns).
func (c *daemonCore) requestShutdown() {
	close(c.shutdown)
	<-c.done
}

// pollAndProcessJobs claims new jobs and processes them. The claim is atomic
// and leased app-side; there is no acknowledge step (the claim IS the ack).
func (c *daemonCore) pollAndProcessJobs(ctx context.Context) error {
	// Check capacity / shutdown
	c.mu.RLock()
	activeCount := len(c.activeJobs)
	shuttingDown := c.isShuttingDown
	c.mu.RUnlock()

	if shuttingDown {
		return nil
	}
	if activeCount >= c.maxConcurrent {
		c.log.Debug("At maximum concurrent jobs, skipping poll")
		return nil
	}

	// Calculate how many jobs we can accept
	limit := min(c.maxConcurrent-activeCount, c.pollBatchSize)

	jobs, err := c.api.ClaimJobs(ctx, limit)
	if err != nil {
		return fmt.Errorf("failed to claim jobs: %w", err)
	}

	if len(jobs) == 0 {
		c.log.Debug("No jobs available")
		return nil
	}

	c.log.WithField("count", len(jobs)).Info("Claimed jobs from queue")

	// Process each job
	for _, job := range jobs {
		// Record job received
		c.metrics.RecordJobReceived(string(job.Type))

		// Per-job cancellable context: the lease heartbeat loop cancels it on
		// cancelRequested or when self-fencing
		jobCtx, cancel := context.WithCancel(ctx)

		// Add to active jobs
		c.mu.Lock()
		c.activeJobs[job.ID] = job
		c.activeCancels[job.ID] = cancel
		c.mu.Unlock()

		// Update active jobs metric
		c.metrics.IncActiveJobs()

		// Process job in goroutine
		go c.processJob(jobCtx, job)
	}

	return nil
}

// processJob handles a single job execution. Reporting uses a background
// context: a produced result must be deliverable even while the job's own
// context (timeout, cancellation, shutdown) is already dead — the old code
// reported with the cancelled context and lost every in-flight completion on
// SIGTERM (review C5).
func (c *daemonCore) processJob(ctx context.Context, job *types.Job) {
	log := c.log.WithField("jobID", job.ID)
	log.Info("Starting job execution")

	// Carry the per-job capability token (HI-10) on every context derived from
	// here — including the detached completion/report contexts, which use
	// context.WithoutCancel(ctx) precisely so they keep this value while
	// surviving job cancellation. The job-scoped app routes verify it in place
	// of the shared internal key.
	ctx = c.withCapability(ctx, job.CapabilityToken)

	// A panicking executor must not take the whole daemon down (killing every
	// other in-flight job with it): contain the panic, report this job failed,
	// and let the deferred bookkeeping below release the slot. Registered
	// before the cleanup defer so the slot is already released when it runs.
	defer func() {
		if r := recover(); r != nil {
			log.WithField("panic", r).Error("Job execution panicked; reporting job as failed")
			c.jobsProcessed.Add(1)
			c.jobsFailed.Add(1)
			c.metrics.RecordJobFailed(string(job.Type), "executor_panic")

			reportCtx, reportCancel := context.WithTimeout(context.WithoutCancel(ctx), c.reportTimeout)
			defer reportCancel()
			if reportErr := c.api.UpdateJobStatus(reportCtx, job.ID, types.JobStatusFailed, &types.StatusUpdate{
				Status:  types.JobStatusFailed,
				Message: fmt.Sprintf("executor panic: %v", r),
			}); reportErr != nil {
				log.WithError(reportErr).Error("Could not report executor panic; the sweeper will recover the job at lease expiry")
			}
		}
	}()

	// Remove from active jobs when done
	defer func() {
		c.mu.Lock()
		delete(c.activeJobs, job.ID)
		if cancel, ok := c.activeCancels[job.ID]; ok {
			cancel()
			delete(c.activeCancels, job.ID)
		}
		delete(c.cancelReasons, job.ID)
		c.mu.Unlock()
		c.metrics.DecActiveJobs()
	}()

	// Create job context with timeout
	jobCtx := ctx
	if job.Timeout > 0 {
		var cancel context.CancelFunc
		jobCtx, cancel = context.WithTimeout(ctx, job.Timeout)
		defer cancel()
	}

	// Track job start time
	jobStartTime := time.Now()

	// Execute job using executor manager
	updates, err := c.executor.Execute(jobCtx, job)
	if err != nil {
		log.WithError(err).Error("Failed to start job execution")
		c.jobsProcessed.Add(1)
		c.jobsFailed.Add(1)
		c.metrics.RecordJobFailed(string(job.Type), "execution_failed")

		// Update job status to failed — and never ignore the outcome (C5):
		// on failure the job stays claimed until the sweeper handles it, but
		// we must at least say so loudly. WithoutCancel keeps the capability
		// token (HI-10) while detaching from the cancelled job context.
		reportCtx, reportCancel := context.WithTimeout(context.WithoutCancel(ctx), c.reportTimeout)
		defer reportCancel()
		if reportErr := c.api.UpdateJobStatus(reportCtx, job.ID, types.JobStatusFailed, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: err.Error(),
			Error:   types.ErrorDetailsFromError(err),
		}); reportErr != nil {
			log.WithError(reportErr).Error("Could not report execution-start failure; the sweeper will recover the job at lease expiry")
		}
		return
	}

	// Process execution updates. Output capture is bounded per stream
	// (head + tail, omitted bytes counted) — see outputStreamCapBytes.
	var exitCode int
	var finalStatus types.JobStatus
	var timedOut bool
	stdout := newCappedCapture(c.outputCapBytes)
	stderr := newCappedCapture(c.outputCapBytes)
	startTime := time.Now()

	for update := range updates {
		switch update.Type {
		case types.UpdateTypeLog:
			if logEntry, ok := update.Data.(*types.LogEntry); ok {
				if logEntry.Stream == "stdout" {
					stdout.WriteLine(logEntry.Line)
				} else {
					stderr.WriteLine(logEntry.Line)
				}
			}

		case types.UpdateTypeStatus:
			if status, ok := update.Data.(*types.StatusUpdate); ok {
				if err := c.api.UpdateJobStatus(ctx, job.ID, status.Status, status); err != nil {
					log.WithError(err).Warn("Failed to report status update")
				}
			}

		case types.UpdateTypeComplete:
			if status, ok := update.Data.(*types.StatusUpdate); ok {
				if status.ExitCode != nil {
					exitCode = *status.ExitCode
				}
				finalStatus = status.Status
				// Check for timeout based on exit code
				if exitCode == -1 {
					timedOut = true
				}
			}

		case types.UpdateTypeError:
			if status, ok := update.Data.(*types.StatusUpdate); ok {
				log.WithField("error", status.Message).Error("Execution error")
			}
		}
	}

	// Calculate execution metrics
	endTime := time.Now()
	duration := endTime.Sub(startTime)

	// Was this job cancelled on purpose (UI request / self-fence)?
	c.mu.RLock()
	cancelReason := c.cancelReasons[job.ID]
	c.mu.RUnlock()

	// Determine final status. Exit code -1 = timeout, -2 = cancelled — both
	// real statuses now, not overloaded failure codes (review H8).
	var jobStatus types.JobStatus
	var statusMessage string

	if cancelReason != "" || exitCode == -2 {
		jobStatus = types.JobStatusCancelled
		switch cancelReason {
		case "fenced":
			statusMessage = "Job aborted: lease renewal failed (self-fence); the scheduler will retry or fail it per policy"
		default:
			statusMessage = "Job cancelled"
		}
	} else if timedOut || exitCode == -1 {
		// Timeout detected
		jobStatus = types.JobStatusTimeout
		statusMessage = fmt.Sprintf("Job execution timed out after %v", job.Timeout)
	} else if finalStatus != "" {
		// Use status from executor
		jobStatus = finalStatus
	} else if exitCode != 0 {
		// Non-zero exit code
		jobStatus = types.JobStatusFailed
		statusMessage = fmt.Sprintf("Job failed with exit code %d", exitCode)
	} else {
		// Success
		jobStatus = types.JobStatusCompleted
		statusMessage = "Job completed successfully"
	}

	// Mark job as completed
	completeReq := &api.CompleteJobRequest{
		Status:   jobStatus,
		ExitCode: exitCode,
		Output: api.Output{
			Stdout: stdout.String(),
			Stderr: stderr.String(),
		},
		Metrics: types.ExecutionMetrics{
			StartTime: startTime,
			EndTime:   endTime,
			Duration:  duration.Milliseconds(),
			// TODO: Collect real resource usage metrics
		},
		OutputTruncatedBytes: int(stdout.OmittedBytes() + stderr.OmittedBytes()),
		Timestamp:            time.Now().Format(time.RFC3339),
	}

	// Record job completion metrics
	jobDuration := time.Since(jobStartTime).Seconds()
	c.jobsProcessed.Add(1)
	switch completeReq.Status {
	case types.JobStatusCompleted:
		c.jobsSucceeded.Add(1)
		c.metrics.RecordJobCompleted(string(job.Type), jobDuration)
	case types.JobStatusTimeout:
		c.jobsFailed.Add(1)
		c.metrics.RecordJobFailed(string(job.Type), "timeout")
	case types.JobStatusFailed:
		c.jobsFailed.Add(1)
		if exitCode >= 100 {
			c.metrics.RecordJobFailed(string(job.Type), "partial_failure")
		} else {
			c.metrics.RecordJobFailed(string(job.Type), "non_zero_exit")
		}
	default:
		c.jobsFailed.Add(1)
		c.metrics.RecordJobFailed(string(job.Type), "unknown")
	}

	// Deliver the completion with a detached context (survives job
	// cancellation and shutdown) that still carries the capability token via
	// WithoutCancel (HI-10); if delivery still fails after the client's
	// retries, spool it to disk and keep retrying — a produced result is
	// never dropped (PLAN.md §5).
	reportCtx, reportCancel := context.WithTimeout(context.WithoutCancel(ctx), c.reportTimeout)
	defer reportCancel()
	if err := c.api.CompleteJob(reportCtx, job.ID, completeReq); err != nil {
		log.WithError(err).Error("Failed to deliver completion; spooling for retry")
		c.metrics.RecordJobFailed(string(job.Type), "complete_api_failed")
		c.spoolCompletion(job.ID, completeReq, job.CapabilityToken)
	} else {
		log.WithFields(logrus.Fields{
			"exitCode": exitCode,
			"status":   jobStatus,
			"duration": jobDuration,
		}).Info(statusMessage)
	}
}

// healthCheckLoop periodically checks API health
func (c *daemonCore) healthCheckLoop(ctx context.Context) {
	ticker := time.NewTicker(c.healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.api.HealthCheck(ctx); err != nil {
				c.log.WithError(err).Warn("API health check failed")
			} else {
				c.log.Debug("API health check passed")
			}
		}
	}
}

// heartbeatLoop reports orchestrator liveness and capacity every 30s
func (c *daemonCore) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(c.heartbeatInterval)
	defer ticker.Stop()

	send := func() {
		c.mu.RLock()
		running := make([]string, 0, len(c.activeJobs))
		for id := range c.activeJobs {
			running = append(running, id)
		}
		current := len(c.activeJobs)
		c.mu.RUnlock()

		maxJobs := c.maxConcurrent
		req := &api.HeartbeatRequest{
			OrchestratorID: c.orchestratorID,
			// Stamp the heartbeat here (FINDINGS #38): the request must carry a
			// timestamp regardless of which jobAPI implementation sends it.
			Timestamp:   c.now().UTC().Format(time.RFC3339),
			RunningJobs: running,
			Capacity: &api.HeartbeatCapacity{
				MaxJobs:        maxJobs,
				CurrentJobs:    current,
				AvailableSlots: maxJobs - current,
			},
		}
		if err := c.api.SendHeartbeat(ctx, req); err != nil {
			c.log.WithError(err).Warn("Failed to send heartbeat")
		}
	}

	send() // report immediately on startup
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			send()
		}
	}
}

// leaseHeartbeatLoop renews the leases of in-flight jobs and applies the two
// return signals (PLAN.md §4.2): cancellation requests (UI cancel reaches the
// running container here) and lease loss. Self-fencing is mandatory: if
// renewal keeps failing past the lease window, or the app declines to extend a
// job we think is ours, we ABORT that execution — the alternative is the same
// job running in two places once the sweeper re-queues it.
func (c *daemonCore) leaseHeartbeatLoop(ctx context.Context) {
	interval := c.leaseRenewal
	if interval <= 0 {
		interval = 20 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Must match the app-side claim lease (DEFAULT_CLAIM_LEASE_MS)
	fenceAfter := c.fenceAfter
	lastSuccess := time.Now()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.RLock()
			ids := make([]string, 0, len(c.activeJobs))
			for id := range c.activeJobs {
				ids = append(ids, id)
			}
			c.mu.RUnlock()

			if len(ids) == 0 {
				lastSuccess = time.Now()
				continue
			}

			hbCtx, cancel := context.WithTimeout(ctx, c.leaseHBTimeout)
			resp, err := c.api.JobsHeartbeat(hbCtx, ids)
			cancel()

			if err != nil {
				c.log.WithError(err).Warn("Lease heartbeat failed")
				if time.Since(lastSuccess) > fenceAfter {
					c.log.WithField("jobs", len(ids)).
						Error("Lease renewal failing past the lease window; self-fencing (aborting in-flight jobs)")
					for _, id := range ids {
						c.cancelJob(id, "fenced")
					}
					lastSuccess = time.Now() // don't re-fence every tick
				}
				continue
			}
			lastSuccess = time.Now()

			cancelSet := make(map[string]bool, len(resp.CancelRequested))
			for _, id := range resp.CancelRequested {
				cancelSet[id] = true
				c.cancelJob(id, "requested")
			}

			// Jobs the app declined to extend are no longer ours (lease
			// expired and was swept, or resolved elsewhere) — abort them.
			extended := make(map[string]bool, len(resp.Extended))
			for _, id := range resp.Extended {
				extended[id] = true
			}
			for _, id := range ids {
				if !extended[id] && !cancelSet[id] {
					c.cancelJob(id, "fenced")
				}
			}
		}
	}
}

// cancelJob aborts an in-flight job's execution, recording why
func (c *daemonCore) cancelJob(id, reason string) {
	c.mu.Lock()
	cancel, ok := c.activeCancels[id]
	if ok {
		if _, already := c.cancelReasons[id]; !already {
			c.cancelReasons[id] = reason
		}
	}
	c.mu.Unlock()
	if ok {
		c.log.WithFields(logrus.Fields{"jobID": id, "reason": reason}).
			Info("Aborting job execution")
		cancel()
	}
}

// metricsLoop reports orchestrator-level metrics every 60s
func (c *daemonCore) metricsLoop(ctx context.Context) {
	ticker := time.NewTicker(c.metricsInterval)
	defer ticker.Stop()

	send := func() {
		c.mu.RLock()
		queueDepth := len(c.activeJobs)
		c.mu.RUnlock()

		req := &api.MetricsRequest{
			OrchestratorID: c.orchestratorID,
			Period:         "minute",
			Metrics: api.OrchestratorStats{
				JobsProcessed:    c.jobsProcessed.Load(),
				JobsSucceeded:    c.jobsSucceeded.Load(),
				JobsFailed:       c.jobsFailed.Load(),
				ActiveContainers: queueDepth,
				QueueDepth:       queueDepth,
			},
		}
		if err := c.api.SendMetrics(ctx, req); err != nil {
			c.log.WithError(err).Warn("Failed to send metrics")
		}
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			send()
		}
	}
}

// gracefulShutdown performs a graceful shutdown
func (c *daemonCore) gracefulShutdown() error {
	c.log.Info("Starting graceful shutdown")

	c.mu.Lock()
	c.isShuttingDown = true
	activeCount := len(c.activeJobs)
	c.mu.Unlock()

	if activeCount > 0 {
		c.log.WithField("count", activeCount).Info("Waiting for active jobs to complete")

		// Wait for jobs to complete with timeout
		timeout := time.After(c.shutdownWait)
		ticker := time.NewTicker(c.shutdownTick)
		defer ticker.Stop()

		for {
			select {
			case <-timeout:
				c.log.Warn("Timeout waiting for jobs to complete")
				return nil
			case <-ticker.C:
				c.mu.RLock()
				remaining := len(c.activeJobs)
				c.mu.RUnlock()

				if remaining == 0 {
					c.log.Info("All jobs completed")
					return nil
				}
				c.log.WithField("remaining", remaining).Debug("Waiting for jobs")
			}
		}
	}

	return nil
}
