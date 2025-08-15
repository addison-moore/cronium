package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/container"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/ssh"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/logger"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/metrics"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/orchestrator"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/payload"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// SimpleOrchestrator is a minimal orchestrator for testing
type SimpleOrchestrator struct {
	config          *config.Config
	log             *logrus.Logger
	apiClient       *api.Client
	executorMgr     *executors.Manager
	logStreamer     *logger.Streamer
	metrics         *metrics.Collector
	recovery        *orchestrator.RecoveryManager
	containerExec   *container.Executor
	orchestratorID  string
	
	// Control channels
	shutdown chan struct{}
	done     chan struct{}
	
	// State
	mu             sync.RWMutex
	activeJobs     map[string]*types.Job
	isShuttingDown bool
}

// NewSimpleOrchestrator creates a new simple orchestrator instance
func NewSimpleOrchestrator(cfg *config.Config, log *logrus.Logger) (*SimpleOrchestrator, error) {
	// Create API client
	apiClient, err := api.NewClient(cfg.API, log)
	if err != nil {
		return nil, fmt.Errorf("failed to create API client: %w", err)
	}
	
	// Generate orchestrator ID
	orchestratorID := fmt.Sprintf("orchestrator-%s", cfg.Orchestrator.ID)
	
	// Create executor manager
	executorMgr := executors.NewManager()
	
	// Register container executor
	containerExec, err := container.NewExecutor(cfg.Container, apiClient, log)
	if err != nil {
		return nil, fmt.Errorf("failed to create container executor: %w", err)
	}
	executorMgr.Register(types.JobTypeContainer, containerExec)
	
	// Register SSH executor (with multi-server support)
	// TODO: Make runtime host and port configurable
	runtimeHost := os.Getenv("RUNTIME_HOST")
	if runtimeHost == "" {
		runtimeHost = "runtime-api" // Default to Docker service name
	}
	runtimePort := 8089 // Default runtime API port
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
	executorMgr.Register(types.JobTypeSSH, sshExec)
	
	// Create log streamer
	logStreamer := logger.NewStreamer(cfg.Logging.WebSocket, cfg.API.WSEndpoint, cfg.API.Token, log)
	
	// Create metrics collector
	metricsCollector := metrics.NewCollector(cfg.Monitoring, log)
	
	// Connect metrics to API client
	apiClient.WithMetrics(metricsCollector)
	
	// Create recovery manager (use container executor's cleanup manager if available)
	var cleanupMgr *container.CleanupManager
	if containerExec != nil {
		// Access the cleanup manager through a getter or make it public
		cleanupMgr = container.NewCleanupManager(containerExec, log)
	}
	recovery := orchestrator.NewRecoveryManager(apiClient, cleanupMgr, log)
	
	return &SimpleOrchestrator{
		config:         cfg,
		log:            log,
		apiClient:      apiClient,
		executorMgr:    executorMgr,
		logStreamer:    logStreamer,
		metrics:        metricsCollector,
		recovery:       recovery,
		containerExec:  containerExec,
		orchestratorID: orchestratorID,
		shutdown:       make(chan struct{}),
		done:           make(chan struct{}),
		activeJobs:     make(map[string]*types.Job),
	}, nil
}

// Run starts the orchestrator
func (o *SimpleOrchestrator) Run(ctx context.Context) error {
	o.log.Info("Starting orchestrator")
	defer close(o.done)
	
	// Perform recovery on startup
	if err := o.recovery.RecoverOnStartup(ctx, o.orchestratorID); err != nil {
		o.log.WithError(err).Error("Recovery failed on startup")
		// Continue anyway - recovery errors shouldn't prevent startup
	}
	
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

// pollAndProcessJobs polls for new jobs and processes them
func (o *SimpleOrchestrator) pollAndProcessJobs(ctx context.Context) error {
	// Check if we're at capacity
	o.mu.RLock()
	activeCount := len(o.activeJobs)
	o.mu.RUnlock()
	
	if activeCount >= o.config.Jobs.MaxConcurrent {
		o.log.Debug("At maximum concurrent jobs, skipping poll")
		return nil
	}
	
	// Calculate how many jobs we can accept
	limit := min(o.config.Jobs.MaxConcurrent - activeCount, o.config.Jobs.PollBatchSize)
	
	// Poll for jobs (pass orchestrator ID)
	jobs, err := o.apiClient.PollJobs(ctx, limit)
	if err != nil {
		return fmt.Errorf("failed to poll jobs: %w", err)
	}
	
	if len(jobs) == 0 {
		o.log.Debug("No jobs available")
		return nil
	}
	
	o.log.WithField("count", len(jobs)).Info("Received jobs from queue")
	
	// Process each job
	for _, job := range jobs {
		// Record job received
		o.metrics.RecordJobReceived(string(job.Type))
		
		// Acknowledge the job
		if err := o.apiClient.AcknowledgeJob(ctx, job.ID); err != nil {
			o.log.WithError(err).WithField("jobID", job.ID).Error("Failed to acknowledge job")
			o.metrics.RecordJobFailed(string(job.Type), "acknowledge_failed")
			continue
		}
		
		// Add to active jobs
		o.mu.Lock()
		o.activeJobs[job.ID] = job
		o.mu.Unlock()
		
		// Update active jobs metric
		o.metrics.IncActiveJobs()
		
		// Process job in goroutine
		go o.processJob(ctx, job)
	}
	
	return nil
}

// processJob handles a single job execution
func (o *SimpleOrchestrator) processJob(ctx context.Context, job *types.Job) {
	log := o.log.WithField("jobID", job.ID)
	log.Info("Starting job execution")
	
	// Remove from active jobs when done
	defer func() {
		o.mu.Lock()
		delete(o.activeJobs, job.ID)
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
		o.metrics.RecordJobFailed(string(job.Type), "execution_failed")
		
		// Update job status to failed
		o.apiClient.UpdateJobStatus(ctx, job.ID, types.JobStatusFailed, &types.StatusUpdate{
			Status:  types.JobStatusFailed,
			Message: err.Error(),
			Error:   types.ErrorDetailsFromError(err),
		})
		return
	}
	
	// Start job logging
	jobLogger := o.logStreamer.StartJob(job.ID)
	defer o.logStreamer.StopJob(job.ID)
	
	// Process execution updates
	var exitCode int
	var finalStatus types.JobStatus
	var timedOut bool
	var stdout, stderr strings.Builder
	startTime := time.Now()
	
	for update := range updates {
		switch update.Type {
		case types.UpdateTypeLog:
			if logEntry, ok := update.Data.(*types.LogEntry); ok {
				if logEntry.Stream == "stdout" {
					stdout.WriteString(logEntry.Line + "\n")
				} else {
					stderr.WriteString(logEntry.Line + "\n")
				}
				// Stream logs via WebSocket
				jobLogger.AddLog(logEntry)
			}
			
		case types.UpdateTypeStatus:
			if status, ok := update.Data.(*types.StatusUpdate); ok {
				o.apiClient.UpdateJobStatus(ctx, job.ID, status.Status, status)
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
	
	// Determine final status
	var jobStatus types.JobStatus
	var statusMessage string
	
	if timedOut || exitCode == -1 {
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
		Timestamp: time.Now().Format(time.RFC3339),
	}
	
	// Record job completion metrics
	jobDuration := time.Since(jobStartTime).Seconds()
	switch completeReq.Status {
	case types.JobStatusCompleted:
		o.metrics.RecordJobCompleted(string(job.Type), jobDuration)
	case types.JobStatusTimeout:
		o.metrics.RecordJobFailed(string(job.Type), "timeout")
	case types.JobStatusFailed:
		if exitCode >= 100 {
			o.metrics.RecordJobFailed(string(job.Type), "partial_failure")
		} else {
			o.metrics.RecordJobFailed(string(job.Type), "non_zero_exit")
		}
	default:
		o.metrics.RecordJobFailed(string(job.Type), "unknown")
	}
	
	if err := o.apiClient.CompleteJob(ctx, job.ID, completeReq); err != nil {
		log.WithError(err).Error("Failed to complete job")
		o.metrics.RecordJobFailed(string(job.Type), "complete_api_failed")
	} else {
		log.WithFields(logrus.Fields{
			"exitCode": exitCode,
			"status":   jobStatus,
			"duration": jobDuration,
		}).Info(statusMessage)
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