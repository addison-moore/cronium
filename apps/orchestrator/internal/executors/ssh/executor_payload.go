package ssh

import (
	"fmt"
	"os"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/payload"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"time"
)

// createPayloadForJob creates a payload file for the job if it doesn't exist
func (e *Executor) createPayloadForJob(job *types.Job, executionID string) (string, error) {
	// Check if payload already exists (for backwards compatibility)
	if existingPath, ok := job.Metadata["payloadPath"].(string); ok && existingPath != "" {
		// Legacy mode: payload created by cronium-app
		e.log.WithField("jobID", job.ID).Debug("Using existing payload from cronium-app")
		return existingPath, nil
	}

	// Create payload service
	payloadService := payload.NewService(e.config.Execution.PayloadStorageDir)

	// Extract script content from job
	scriptContent := ""
	scriptType := "BASH" // default
	
	if job.Execution.Script != nil {
		scriptContent = job.Execution.Script.Content
		scriptType = string(job.Execution.Script.Type)
		e.log.WithFields(map[string]interface{}{
			"jobID":       job.ID,
			"scriptType":  scriptType,
			"scriptTypeFromJob": job.Execution.Script.Type,
		}).Debug("Extracted script type from job")
	}

	if scriptContent == "" {
		return "", fmt.Errorf("no script content found in job")
	}

	// Build environment variables
	environment := make(map[string]string)
	if job.Execution.Environment != nil {
		environment = job.Execution.Environment
	}

	// Build metadata
	metadata := make(map[string]interface{})
	if job.Metadata != nil {
		for k, v := range job.Metadata {
			metadata[k] = v
		}
	}
	
	// Add standard metadata
	metadata["jobId"] = job.ID
	metadata["executionId"] = executionID
	// Extract eventId and userId from job metadata if available
	if eventId, ok := job.Metadata["eventId"]; ok {
		metadata["eventId"] = fmt.Sprintf("%v", eventId)
	}
	if userId, ok := job.Metadata["userId"]; ok {
		metadata["userId"] = fmt.Sprintf("%v", userId)
	}
	metadata["timestamp"] = time.Now().Format(time.RFC3339)

	// Create payload data
	payloadData := &payload.PayloadData{
		JobID:         job.ID,
		ExecutionID:   executionID,
		ScriptContent: scriptContent,
		ScriptType:    scriptType,
		Environment:   environment,
		Metadata:      metadata,
	}

	// Create payload file
	payloadPath, err := payloadService.CreatePayload(payloadData)
	if err != nil {
		return "", fmt.Errorf("failed to create payload: %w", err)
	}

	e.log.WithFields(map[string]interface{}{
		"jobID":       job.ID,
		"payloadPath": payloadPath,
	}).Debug("Created payload for job")

	return payloadPath, nil
}

// cleanupPayload removes the payload file after job completion
func (e *Executor) cleanupPayload(payloadPath string, job *types.Job) {
	// Only cleanup if it's a local payload (not from cronium-app)
	if payloadPath == "" {
		return
	}
	
	// Check if this is a legacy payload from cronium-app (don't delete those)
	if job.Metadata != nil {
		if _, isLegacy := job.Metadata["payloadPath"]; isLegacy {
			e.log.WithField("payloadPath", payloadPath).Debug("Keeping legacy payload from cronium-app")
			return
		}
	}
	
	// Clean up based on configuration
	if e.config.Execution.CleanupPayloads {
		// Actually remove the payload file
		if err := os.Remove(payloadPath); err != nil && !os.IsNotExist(err) {
			e.log.WithError(err).WithField("payloadPath", payloadPath).Warn("Failed to cleanup payload file")
		} else {
			e.log.WithField("payloadPath", payloadPath).Debug("Cleaned up payload file")
		}
		
		// Also remove the checksum file
		checksumPath := payloadPath + ".sha256"
		if err := os.Remove(checksumPath); err != nil && !os.IsNotExist(err) {
			e.log.WithError(err).WithField("checksumPath", checksumPath).Debug("Failed to cleanup checksum file")
		}
	} else {
		e.log.WithField("payloadPath", payloadPath).Debug("Keeping payload (cleanup disabled)")
	}
}