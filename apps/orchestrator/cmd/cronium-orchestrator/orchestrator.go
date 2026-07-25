package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/container"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/ssh"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/logger"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/metrics"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/payload"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// streamerLogAdapter adapts *logger.Streamer to the local logStream interface
// (Go has no covariant returns, so Streamer.StartJob's concrete *JobLogger
// return type cannot satisfy logStream directly). Pure forwarding — the
// JobLogger itself satisfies jobLogSink as-is.
type streamerLogAdapter struct{ s *logger.Streamer }

func (a streamerLogAdapter) StartJob(jobID string) jobLogSink { return a.s.StartJob(jobID) }
func (a streamerLogAdapter) StopJob(jobID string)             { a.s.StopJob(jobID) }

// SimpleOrchestrator wires the concrete collaborators (API client, executor
// manager, log streamer, metrics collector) into the daemon core, which owns
// the actual control loops (see core.go).
type SimpleOrchestrator struct {
	config        *config.Config
	log           *logrus.Logger
	logStreamer   *logger.Streamer
	containerExec *container.Executor
	core          *daemonCore
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
	if cfg.SSH.Execution.IsolationMode == config.SSHIsolationOperatorEnforced {
		log.Warn("SSH execution enabled with operator-enforced isolation; the operator is responsible for a separate OS identity or container for every mutually untrusted remote job")
		sshExec, err := ssh.NewMultiServerExecutor(cfg.SSH, apiClient, runtimeHost, runtimePort, jwtSecret, log)
		if err != nil {
			return nil, fmt.Errorf("failed to create SSH executor: %w", err)
		}
		// Wire the container executor in as the local branch of LOCAL_AND_REMOTE
		// jobs (events that run on the Cronium host and remote servers at once).
		sshExec.SetLocalExecutor(containerExec)
		executorMgr.Register(types.JobTypeSSH, sshExec)
	} else {
		executorMgr.MarkUnavailable(
			types.JobTypeSSH,
			"SSH execution is disabled until CRONIUM_SSH_EXECUTION_ISOLATION_MODE=operator-enforced is set for an externally isolated remote execution topology",
		)
		log.Warn("SSH execution disabled: remote jobs require operator-enforced per-job OS identity or container isolation")
	}

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

	core := newDaemonCore(daemonDeps{
		log:      log,
		api:      apiClient,
		executor: executorMgr,
		streamer: streamerLogAdapter{s: logStreamer},
		metrics:  metricsCollector,
	}, daemonConfig{
		orchestratorID: orchestratorID,
		spoolDir:       spoolDir,
		maxConcurrent:  cfg.Jobs.MaxConcurrent,
		pollBatchSize:  cfg.Jobs.PollBatchSize,
		pollInterval:   cfg.Jobs.PollInterval,
		leaseRenewal:   cfg.Jobs.LeaseRenewal,
	})

	return &SimpleOrchestrator{
		config:        cfg,
		log:           log,
		logStreamer:   logStreamer,
		containerExec: containerExec,
		core:          core,
	}, nil
}

// Run starts the orchestrator
func (o *SimpleOrchestrator) Run(ctx context.Context) error {
	o.log.Info("Starting orchestrator")
	defer close(o.core.done)

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

	// The daemon core owns everything from here: health check, telemetry,
	// lease renewal/self-fencing, spool retry, and the job polling loop.
	return o.core.run(ctx)
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

// Shutdown initiates a graceful shutdown
func (o *SimpleOrchestrator) Shutdown() {
	o.core.requestShutdown()
}
