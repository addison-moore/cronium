package orchestrator

import (
	"context"
	"fmt"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/executors/container"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// RecoveryManager handles recovery of jobs after orchestrator restarts
type RecoveryManager struct {
	apiClient *api.Client
	cleanup   *container.CleanupManager
	log       *logrus.Logger
}

// NewRecoveryManager creates a new recovery manager
func NewRecoveryManager(apiClient *api.Client, cleanup *container.CleanupManager, log *logrus.Logger) *RecoveryManager {
	return &RecoveryManager{
		apiClient: apiClient,
		cleanup:   cleanup,
		log:       log,
	}
}

// RecoverOnStartup performs recovery operations when the orchestrator starts
func (rm *RecoveryManager) RecoverOnStartup(ctx context.Context, orchestratorID string) error {
	rm.log.Info("Starting recovery process")

	// First, clean up any orphaned Docker resources
	if rm.cleanup != nil {
		if err := rm.cleanup.CleanupOrphanedResources(ctx); err != nil {
			rm.log.WithError(err).Error("Failed to cleanup orphaned resources during recovery")
		}
	}

	// Get all jobs that were claimed by this orchestrator
	jobs, err := rm.apiClient.GetOrphanedJobs(ctx, orchestratorID)
	if err != nil {
		return fmt.Errorf("failed to get orphaned jobs: %w", err)
	}

	if len(jobs) == 0 {
		rm.log.Info("No orphaned jobs found")
		return nil
	}

	rm.log.WithField("count", len(jobs)).Info("Found orphaned jobs to recover")

	// Process each orphaned job
	for _, job := range jobs {
		if err := rm.recoverJob(ctx, job); err != nil {
			rm.log.WithError(err).WithField("jobID", job.ID).Error("Failed to recover job")
		}
	}

	rm.log.Info("Recovery process completed")
	return nil
}

// recoverJob handles recovery of a single job
func (rm *RecoveryManager) recoverJob(ctx context.Context, job *types.Job) error {
	rm.log.WithField("jobID", job.ID).Info("Recovering job")

	// Clean up any Docker resources associated with this job
	if rm.cleanup != nil {
		if err := rm.cleanup.CleanupJobResources(ctx, job.ID); err != nil {
			rm.log.WithError(err).Warn("Failed to cleanup job resources")
		}
	}

	// Since the orchestrator's Job type doesn't have a Status field,
	// we need to infer the state from the available timestamp fields
	
	// Check how long ago the job was started
	var jobAge time.Duration
	if job.StartedAt != nil {
		jobAge = time.Since(*job.StartedAt)
		
		// If job was started, it was running
		// Check if it exceeded timeout
		if job.Timeout > 0 && jobAge > job.Timeout {
			return rm.failJob(ctx, job.ID, "Job timed out during orchestrator downtime")
		}
		return rm.failJob(ctx, job.ID, "Orchestrator restarted while job was running")
	} else if job.AcknowledgedAt != nil {
		// Job was acknowledged but not started - release it back to the queue
		return rm.releaseJob(ctx, job.ID)
	} else {
		// Job was claimed but not acknowledged - release it back to the queue
		return rm.releaseJob(ctx, job.ID)
	}
}

// failJob marks a job as failed
func (rm *RecoveryManager) failJob(ctx context.Context, jobID string, reason string) error {
	rm.log.WithFields(logrus.Fields{
		"jobID":  jobID,
		"reason": reason,
	}).Info("Marking job as failed")

	completeReq := &api.CompleteJobRequest{
		Status: types.JobStatusFailed,
		Output: api.Output{
			Stderr: fmt.Sprintf("Recovery failure: %s", reason),
		},
		ExitCode:  1,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	if err := rm.apiClient.CompleteJob(ctx, jobID, completeReq); err != nil {
		return fmt.Errorf("failed to mark job as failed: %w", err)
	}

	return nil
}

// releaseJob releases a job back to the queue
func (rm *RecoveryManager) releaseJob(ctx context.Context, jobID string) error {
	rm.log.WithField("jobID", jobID).Info("Releasing job back to queue")

	// Create a status update to release the job
	// The backend will handle resetting the job to QUEUED status
	statusUpdate := &types.StatusUpdate{
		Status:  types.JobStatusPending,
		Message: "Released back to queue after orchestrator restart",
	}

	if err := rm.apiClient.ReleaseJob(ctx, jobID, statusUpdate); err != nil {
		return fmt.Errorf("failed to release job: %w", err)
	}

	return nil
}