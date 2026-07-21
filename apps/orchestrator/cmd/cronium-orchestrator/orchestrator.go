package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/container"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/ssh"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/logger"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/metrics"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/payload"
	cerrors "github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// Per-stream in-memory output cap (head + tail halves). A log-heavy job can no
// longer OOM the orchestrator or POST an unbounded completion blob; what was
// omitted is counted and reported (PLAN.md §5).
const outputStreamCapBytes = 1024 * 1024

// SimpleOrchestrator is a minimal orchestrator for testing
type SimpleOrchestrator struct {
	config         *config.Config
	log            *logrus.Logger
	apiClient      *api.Client
	executorMgr    *executors.Manager
	logStreamer    *logger.Streamer
	metrics        *metrics.Collector
	containerExec  *container.Executor
	orchestratorID string
	spoolDir       string

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

// NewSimpleOrchestrator creates a new simple orchestrator instance
func NewSimpleOrchestrator(cfg *config.Config, log *logrus.Logger) (*SimpleOrchestrator, error) {
	// Create API client
	apiClient, err := api.NewClient(cfg.API, log)
	if err != nil {
		return nil, fmt.Errorf("failed to create API client: %w", err)
	}

	// One stable identity, used verbatim everywhere (claims, heartbeats,
	// report headers). The old code prefixed it differently here than in the
	// client, so recovery could never find its own jobs (review C4).
	orchestratorID := cfg.Orchestrator.ID

	// Create executor manager
	executorMgr := executors.NewManager()

	// Register container executor
	containerExec, err := container.NewExecutor(cfg.Container, apiClient, log)
	if err != nil {
		return nil, fmt.Errorf("failed to create container executor: %w", err)
	}
	executorMgr.Register(types.JobTypeContainer, containerExec)

	// Register SSH executor (with multi-server support).
	// Runtime host/port for the shared runtime-api the SSH reverse tunnel dials.
	// MUST match the runtime service's docker name:port for remote (runner)
	// cronium.input()/output() to reach it — a mismatch closes the tunnel with no
	// response and the runner reports EOF. Configure via RUNTIME_HOST/RUNTIME_PORT;
	// the defaults match the canonical `cronium-runtime` service on 8081.
	runtimeHost := os.Getenv("RUNTIME_HOST")
	if runtimeHost == "" {
		runtimeHost = "cronium-runtime"
	}
	runtimePort := 8081
	if envPort := os.Getenv("RUNTIME_PORT"); envPort != "" {
		if port, err := strconv.Atoi(envPort); err == nil {
			runtimePort = port
		}
	}
	jwtSecret := cfg.Container.Runtime.JWTSecret
	sshExec, err := ssh.NewMultiServerExecutor(cfg.SSH, apiClient, runtimeHost, runtimePort, jwtSecret, log)
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH executor: %w", err)
	}
	// Wire the container executor in as the local branch of LOCAL_AND_REMOTE
	// jobs (events that run on the Cronium host and remote servers at once)
	sshExec.SetLocalExecutor(containerExec)
	executorMgr.Register(types.JobTypeSSH, sshExec)

	// Create log streamer
	logStreamer := logger.NewStreamer(cfg.Logging.WebSocket, cfg.API.WSEndpoint, cfg.API.Token, log)

	// Create metrics collector
	metricsCollector := metrics.NewCollector(cfg.Monitoring, log)

	// Connect metrics to API client
	apiClient.WithMetrics(metricsCollector)

	// Spool directory for completions that could not be delivered (sibling of
	// the payload dir, on the persisted orchestrator-data volume): a produced
	// result is never dropped, it is retried until the app accepts it.
	spoolDir := filepath.Join(filepath.Dir(cfg.SSH.Execution.PayloadStorageDir), "completions")
	if err := os.MkdirAll(spoolDir, 0o755); err != nil {
		log.WithError(err).Warn("Could not create completion spool dir; undeliverable completions will be lost")
		spoolDir = ""
	}

	return &SimpleOrchestrator{
		config:         cfg,
		log:            log,
		apiClient:      apiClient,
		executorMgr:    executorMgr,
		logStreamer:    logStreamer,
		metrics:        metricsCollector,
		containerExec:  containerExec,
		orchestratorID: orchestratorID,
		spoolDir:       spoolDir,
		shutdown:       make(chan struct{}),
		done:           make(chan struct{}),
		activeJobs:     make(map[string]*types.Job),
		activeCancels:  make(map[string]context.CancelFunc),
		cancelReasons:  make(map[string]string),
	}, nil
}

// Run starts the orchestrator
func (o *SimpleOrchestrator) Run(ctx context.Context) error {
	o.log.Info("Starting orchestrator")
	defer close(o.done)

	// No startup "orphan recovery": ownership is a lease in the database, and
	// the app's sweeper re-queues or fails anything whose lease expired. This
	// orchestrator's only recovery duty is retrying its own spooled results.

	// Start periodic cleanup if we have a container executor
	if o.containerExec != nil {
		cleanupMgr := o.containerExec.GetCleanupManager()
		if cleanupMgr != nil {
			cleanupMgr.StartPeriodicCleanup(ctx, 30*time.Minute)
		}
	}

	// Start periodic payload cleanup if enabled
	if o.config.SSH.Execution.CleanupPayloads {
		go o.payloadCleanupLoop(ctx)
	}

	// Start log streamer
	if err := o.logStreamer.Start(ctx); err != nil {
		o.log.WithError(err).Warn("Failed to start log streamer")
	}
	defer o.logStreamer.Stop()

	// Start API health check
	go o.healthCheckLoop(ctx)

	// Start telemetry loops (heartbeat + metrics reporting)
	o.startedAt = time.Now()
	go o.heartbeatLoop(ctx)
	go o.metricsLoop(ctx)

	// Lease renewal + cancellation channel + self-fencing (PLAN.md §4.2)
	go o.leaseHeartbeatLoop(ctx)

	// Retry spooled completions that previous runs could not deliver
	go o.spoolRetryLoop(ctx)

	// Start job polling loop
	pollTicker := time.NewTicker(o.config.Jobs.PollInterval)
	defer pollTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			o.log.Info("Context cancelled, shutting down orchestrator")
			return o.gracefulShutdown()

		case <-o.shutdown:
			o.log.Info("Shutdown requested")
			return o.gracefulShutdown()

		case <-pollTicker.C:
			if err := o.pollAndProcessJobs(ctx); err != nil {
				o.log.WithError(err).Error("Failed to poll jobs")
			}
		}
	}
}

// pollAndProcessJobs claims new jobs and processes them. The claim is atomic
// and leased app-side; there is no acknowledge step (the claim IS the ack).
func (o *SimpleOrchestrator) pollAndProcessJobs(ctx context.Context) error {
	// Check capacity / shutdown
	o.mu.RLock()
	activeCount := len(o.activeJobs)
	shuttingDown := o.isShuttingDown
	o.mu.RUnlock()

	if shuttingDown {
		return nil
	}
	if activeCount >= o.config.Jobs.MaxConcurrent {
		o.log.Debug("At maximum concurrent jobs, skipping poll")
		return nil
	}

	// Calculate how many jobs we can accept
	limit := min(o.config.Jobs.MaxConcurrent-activeCount, o.config.Jobs.PollBatchSize)

	jobs, err := o.apiClient.ClaimJobs(ctx, limit)
	if err != nil {
		return fmt.Errorf("failed to claim jobs: %w", err)
	}

	if len(jobs) == 0 {
		o.log.Debug("No jobs available")
		return nil
	}

	o.log.WithField("count", len(jobs)).Info("Claimed jobs from queue")

	// Process each job
	for _, job := range jobs {
		// Record job received
		o.metrics.RecordJobReceived(string(job.Type))

		// Per-job cancellable context: the lease heartbeat loop cancels it on
		// cancelRequested or when self-fencing
		jobCtx, cancel := context.WithCancel(ctx)

		// Add to active jobs
		o.mu.Lock()
		o.activeJobs[job.ID] = job
		o.activeCancels[job.ID] = cancel
		o.mu.Unlock()

		// Update active jobs metric
		o.metrics.IncActiveJobs()

		// Process job in goroutine
		go o.processJob(jobCtx, job)
	}

	return nil
}

// processJob handles a single job execution. Reporting uses a background
// context: a produced result must be deliverable even while the job's own
// context (timeout, cancellation, shutdown) is already dead — the old code
// reported with the cancelled context and lost every in-flight completion on
// SIGTERM (review C5).
func (o *SimpleOrchestrator) processJob(ctx context.Context, job *types.Job) {
	log := o.log.WithField("jobID", job.ID)
	log.Info("Starting job execution")

	// Remove from active jobs when done
	defer func() {
		o.mu.Lock()
		delete(o.activeJobs, job.ID)
		if cancel, ok := o.activeCancels[job.ID]; ok {
			cancel()
			delete(o.activeCancels, job.ID)
		}
		delete(o.cancelReasons, job.ID)
		o.mu.Unlock()
		o.metrics.DecActiveJobs()
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
	updates, err := o.executorMgr.Execute(jobCtx, job)
	if err != nil {
		log.WithError(err).Error("Failed to start job execution")
		o.jobsProcessed.Add(1)
		o.jobsFailed.Add(1)
		o.metrics.RecordJobFailed(string(job.Type), "execution_failed")

		// Update job status to failed — and never ignore the outcome (C5):
		// on failure the job stays claimed until the sweeper handles it, but
		// we must at least say so loudly.
		reportCtx, reportCancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer reportCancel()
		if reportErr := o.apiClient.UpdateJobStatus(reportCtx, job.ID, types.JobStatusFailed, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: err.Error(),
			Error:   types.ErrorDetailsFromError(err),
		}); reportErr != nil {
			log.WithError(reportErr).Error("Could not report execution-start failure; the sweeper will recover the job at lease expiry")
		}
		return
	}

	// Start job logging
	jobLogger := o.logStreamer.StartJob(job.ID)
	defer o.logStreamer.StopJob(job.ID)

	// Process execution updates. Output capture is bounded per stream
	// (head + tail, omitted bytes counted) — see outputStreamCapBytes.
	var exitCode int
	var finalStatus types.JobStatus
	var timedOut bool
	stdout := newCappedCapture(outputStreamCapBytes)
	stderr := newCappedCapture(outputStreamCapBytes)
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
				// Stream logs via WebSocket
				jobLogger.AddLog(logEntry)
			}

		case types.UpdateTypeStatus:
			if status, ok := update.Data.(*types.StatusUpdate); ok {
				if err := o.apiClient.UpdateJobStatus(ctx, job.ID, status.Status, status); err != nil {
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
	o.mu.RLock()
	cancelReason := o.cancelReasons[job.ID]
	o.mu.RUnlock()

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
	o.jobsProcessed.Add(1)
	switch completeReq.Status {
	case types.JobStatusCompleted:
		o.jobsSucceeded.Add(1)
		o.metrics.RecordJobCompleted(string(job.Type), jobDuration)
	case types.JobStatusTimeout:
		o.jobsFailed.Add(1)
		o.metrics.RecordJobFailed(string(job.Type), "timeout")
	case types.JobStatusFailed:
		o.jobsFailed.Add(1)
		if exitCode >= 100 {
			o.metrics.RecordJobFailed(string(job.Type), "partial_failure")
		} else {
			o.metrics.RecordJobFailed(string(job.Type), "non_zero_exit")
		}
	default:
		o.jobsFailed.Add(1)
		o.metrics.RecordJobFailed(string(job.Type), "unknown")
	}

	// Deliver the completion with a background context (survives job
	// cancellation and shutdown); if delivery still fails after the client's
	// retries, spool it to disk and keep retrying — a produced result is
	// never dropped (PLAN.md §5).
	reportCtx, reportCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer reportCancel()
	if err := o.apiClient.CompleteJob(reportCtx, job.ID, completeReq); err != nil {
		log.WithError(err).Error("Failed to deliver completion; spooling for retry")
		o.metrics.RecordJobFailed(string(job.Type), "complete_api_failed")
		o.spoolCompletion(job.ID, completeReq)
	} else {
		log.WithFields(logrus.Fields{
			"exitCode": exitCode,
			"status":   jobStatus,
			"duration": jobDuration,
		}).Info(statusMessage)
	}
}

// spooledCompletion is the on-disk form of an undeliverable completion report
type spooledCompletion struct {
	JobID    string                  `json:"jobId"`
	Complete *api.CompleteJobRequest `json:"complete"`
	SpooledA string                  `json:"spooledAt"`
}

func (o *SimpleOrchestrator) spoolCompletion(jobID string, req *api.CompleteJobRequest) {
	if o.spoolDir == "" {
		o.log.WithField("jobID", jobID).Error("No spool dir; completion lost (sweeper will finalize the job at lease expiry)")
		return
	}
	data, err := json.Marshal(&spooledCompletion{
		JobID:    jobID,
		Complete: req,
		SpooledA: time.Now().Format(time.RFC3339),
	})
	if err != nil {
		o.log.WithError(err).WithField("jobID", jobID).Error("Failed to marshal completion for spool")
		return
	}
	path := filepath.Join(o.spoolDir, fmt.Sprintf("%s-%d.json", jobID, time.Now().UnixNano()))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		o.log.WithError(err).WithField("jobID", jobID).Error("Failed to write completion spool file")
		return
	}
	o.log.WithFields(logrus.Fields{"jobID": jobID, "path": path}).Info("Completion spooled for retry")
}

// spoolRetryLoop retries spooled completions once a minute. A file is removed
// when the app accepts the report — including the idempotent "already in that
// terminal state" case; a 409 conflict (the sweeper resolved the job
// differently in the meantime) also removes it, since the authoritative state
// has moved on.
func (o *SimpleOrchestrator) spoolRetryLoop(ctx context.Context) {
	if o.spoolDir == "" {
		return
	}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			entries, err := os.ReadDir(o.spoolDir)
			if err != nil {
				o.log.WithError(err).Warn("Failed to read completion spool dir")
				continue
			}
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				path := filepath.Join(o.spoolDir, entry.Name())
				data, err := os.ReadFile(path)
				if err != nil {
					continue
				}
				var spooled spooledCompletion
				if err := json.Unmarshal(data, &spooled); err != nil {
					o.log.WithField("path", path).Warn("Removing unparseable spool file")
					_ = os.Remove(path)
					continue
				}
				reportCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				err = o.apiClient.CompleteJob(reportCtx, spooled.JobID, spooled.Complete)
				cancel()
				if err == nil {
					o.log.WithField("jobID", spooled.JobID).Info("Delivered spooled completion")
					_ = os.Remove(path)
					continue
				}
				// A conflict means the app has already finalized the job
				// differently (sweeper); our report is moot.
				var apiErr *cerrors.APIError
				if errors.As(err, &apiErr) && (apiErr.StatusCode == 409 || apiErr.StatusCode == 404) {
					o.log.WithFields(logrus.Fields{"jobID": spooled.JobID, "status": apiErr.StatusCode}).
						Warn("Spooled completion superseded; dropping")
					_ = os.Remove(path)
					continue
				}
				o.log.WithError(err).WithField("jobID", spooled.JobID).Debug("Spooled completion still undeliverable")
			}
		}
	}
}

// payloadCleanupLoop periodically cleans up old payload files
func (o *SimpleOrchestrator) payloadCleanupLoop(ctx context.Context) {
	interval := o.config.SSH.Execution.PayloadCleanupInterval
	if interval <= 0 {
		interval = time.Hour // Default to 1 hour if not set
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	payloadService := payload.NewService(o.config.SSH.Execution.PayloadStorageDir)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			retention := o.config.SSH.Execution.PayloadRetentionPeriod
			if retention <= 0 {
				retention = 24 * time.Hour // Default to 24 hours if not set
			}

			o.log.WithFields(logrus.Fields{
				"retention": retention,
				"directory": o.config.SSH.Execution.PayloadStorageDir,
			}).Debug("Running payload cleanup")

			if err := payloadService.CleanupOldPayloads(retention); err != nil {
				o.log.WithError(err).Warn("Failed to cleanup old payloads")
			} else {
				o.log.Debug("Payload cleanup completed")
			}
		}
	}
}

// healthCheckLoop periodically checks API health
func (o *SimpleOrchestrator) healthCheckLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := o.apiClient.HealthCheck(ctx); err != nil {
				o.log.WithError(err).Warn("API health check failed")
			} else {
				o.log.Debug("API health check passed")
			}
		}
	}
}

// heartbeatLoop reports orchestrator liveness and capacity every 30s
func (o *SimpleOrchestrator) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	send := func() {
		o.mu.RLock()
		running := make([]string, 0, len(o.activeJobs))
		for id := range o.activeJobs {
			running = append(running, id)
		}
		current := len(o.activeJobs)
		o.mu.RUnlock()

		maxJobs := o.config.Jobs.MaxConcurrent
		req := &api.HeartbeatRequest{
			OrchestratorID: o.orchestratorID,
			RunningJobs:    running,
			Capacity: &api.HeartbeatCapacity{
				MaxJobs:        maxJobs,
				CurrentJobs:    current,
				AvailableSlots: maxJobs - current,
			},
		}
		if err := o.apiClient.SendHeartbeat(ctx, req); err != nil {
			o.log.WithError(err).Warn("Failed to send heartbeat")
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
func (o *SimpleOrchestrator) leaseHeartbeatLoop(ctx context.Context) {
	interval := o.config.Jobs.LeaseRenewal
	if interval <= 0 {
		interval = 20 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Must match the app-side claim lease (DEFAULT_CLAIM_LEASE_MS)
	const fenceAfter = 60 * time.Second
	lastSuccess := time.Now()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			o.mu.RLock()
			ids := make([]string, 0, len(o.activeJobs))
			for id := range o.activeJobs {
				ids = append(ids, id)
			}
			o.mu.RUnlock()

			if len(ids) == 0 {
				lastSuccess = time.Now()
				continue
			}

			hbCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			resp, err := o.apiClient.JobsHeartbeat(hbCtx, ids)
			cancel()

			if err != nil {
				o.log.WithError(err).Warn("Lease heartbeat failed")
				if time.Since(lastSuccess) > fenceAfter {
					o.log.WithField("jobs", len(ids)).
						Error("Lease renewal failing past the lease window; self-fencing (aborting in-flight jobs)")
					for _, id := range ids {
						o.cancelJob(id, "fenced")
					}
					lastSuccess = time.Now() // don't re-fence every tick
				}
				continue
			}
			lastSuccess = time.Now()

			cancelSet := make(map[string]bool, len(resp.CancelRequested))
			for _, id := range resp.CancelRequested {
				cancelSet[id] = true
				o.cancelJob(id, "requested")
			}

			// Jobs the app declined to extend are no longer ours (lease
			// expired and was swept, or resolved elsewhere) — abort them.
			extended := make(map[string]bool, len(resp.Extended))
			for _, id := range resp.Extended {
				extended[id] = true
			}
			for _, id := range ids {
				if !extended[id] && !cancelSet[id] {
					o.cancelJob(id, "fenced")
				}
			}
		}
	}
}

// cancelJob aborts an in-flight job's execution, recording why
func (o *SimpleOrchestrator) cancelJob(id, reason string) {
	o.mu.Lock()
	cancel, ok := o.activeCancels[id]
	if ok {
		if _, already := o.cancelReasons[id]; !already {
			o.cancelReasons[id] = reason
		}
	}
	o.mu.Unlock()
	if ok {
		o.log.WithFields(logrus.Fields{"jobID": id, "reason": reason}).
			Info("Aborting job execution")
		cancel()
	}
}

// metricsLoop reports orchestrator-level metrics every 60s
func (o *SimpleOrchestrator) metricsLoop(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	send := func() {
		o.mu.RLock()
		queueDepth := len(o.activeJobs)
		o.mu.RUnlock()

		req := &api.MetricsRequest{
			OrchestratorID: o.orchestratorID,
			Period:         "minute",
			Metrics: api.OrchestratorStats{
				JobsProcessed:    o.jobsProcessed.Load(),
				JobsSucceeded:    o.jobsSucceeded.Load(),
				JobsFailed:       o.jobsFailed.Load(),
				ActiveContainers: queueDepth,
				QueueDepth:       queueDepth,
			},
		}
		if err := o.apiClient.SendMetrics(ctx, req); err != nil {
			o.log.WithError(err).Warn("Failed to send metrics")
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
func (o *SimpleOrchestrator) gracefulShutdown() error {
	o.log.Info("Starting graceful shutdown")

	o.mu.Lock()
	o.isShuttingDown = true
	activeCount := len(o.activeJobs)
	o.mu.Unlock()

	if activeCount > 0 {
		o.log.WithField("count", activeCount).Info("Waiting for active jobs to complete")

		// Wait for jobs to complete with timeout
		timeout := time.After(30 * time.Second)
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-timeout:
				o.log.Warn("Timeout waiting for jobs to complete")
				return nil
			case <-ticker.C:
				o.mu.RLock()
				remaining := len(o.activeJobs)
				o.mu.RUnlock()

				if remaining == 0 {
					o.log.Info("All jobs completed")
					return nil
				}
				o.log.WithField("remaining", remaining).Debug("Waiting for jobs")
			}
		}
	}

	return nil
}

// Shutdown initiates a graceful shutdown
func (o *SimpleOrchestrator) Shutdown() {
	close(o.shutdown)
	<-o.done
}

// cappedCapture keeps the first and last half of a byte budget and counts
// what was omitted between them (PLAN.md §5 bounded output).
type cappedCapture struct {
	head    []byte
	tail    []byte
	total   int64
	halfCap int
}

func newCappedCapture(capBytes int) *cappedCapture {
	return &cappedCapture{halfCap: capBytes / 2}
}

func (c *cappedCapture) WriteLine(line string) {
	b := append([]byte(line), '\n')
	c.total += int64(len(b))
	if len(c.head) < c.halfCap {
		room := c.halfCap - len(c.head)
		if len(b) <= room {
			c.head = append(c.head, b...)
			return
		}
		c.head = append(c.head, b[:room]...)
		b = b[room:]
	}
	c.tail = append(c.tail, b...)
	if over := len(c.tail) - c.halfCap; over > 0 {
		c.tail = c.tail[over:]
	}
}

func (c *cappedCapture) OmittedBytes() int64 {
	omitted := c.total - int64(len(c.head)) - int64(len(c.tail))
	if omitted < 0 {
		return 0
	}
	return omitted
}

func (c *cappedCapture) String() string {
	if c.OmittedBytes() == 0 {
		return string(c.head) + string(c.tail)
	}
	return fmt.Sprintf("%s\n... [output truncated: %d bytes omitted] ...\n%s",
		string(c.head), c.OmittedBytes(), string(c.tail))
}
