package ssh

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// MultiServerExecutor handles SSH execution across multiple servers
type MultiServerExecutor struct {
	executor *Executor
	log      *logrus.Logger
}

// NewMultiServerExecutor creates a new multi-server SSH executor
func NewMultiServerExecutor(cfg config.SSHConfig, apiClient *api.Client, runtimeHost string, runtimePort int, jwtSecret string, log *logrus.Logger) (*MultiServerExecutor, error) {
	executor, err := NewExecutor(cfg, apiClient, runtimeHost, runtimePort, jwtSecret, log)
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH executor: %w", err)
	}

	return &MultiServerExecutor{
		executor: executor,
		log:      log,
	}, nil
}

// Type returns the executor type
func (m *MultiServerExecutor) Type() types.JobType {
	return types.JobTypeSSH
}

// Validate checks if the job can be executed
func (m *MultiServerExecutor) Validate(job *types.Job) error {
	// Check if we have servers in metadata
	servers, ok := job.Metadata["servers"].([]interface{})
	if !ok || len(servers) == 0 {
		// Fall back to single server validation
		return m.executor.Validate(job)
	}

	// Validate we have payload path
	if job.Metadata == nil || job.Metadata["payloadPath"] == nil {
		return fmt.Errorf("payload path required in job metadata for runner execution")
	}

	return nil
}

// Execute runs the job on all specified servers
func (m *MultiServerExecutor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	// Check if this is a multi-server job
	servers, ok := job.Metadata["servers"].([]interface{})
	if !ok || len(servers) == 0 {
		// Fall back to single server execution
		return m.executor.Execute(ctx, job)
	}

	// Create aggregated updates channel
	updates := make(chan types.ExecutionUpdate, 100*len(servers))
	
	// Create wait group for parallel execution
	var wg sync.WaitGroup
	
	// Track results from each server
	results := make(map[string]*ServerResult)
	resultsMu := sync.Mutex{}
	
	// Execute on all servers in parallel
	go func() {
		defer close(updates)
		
		// Send initial status
		m.sendUpdate(updates, types.UpdateTypeStatus, &types.StatusUpdate{
			Status:  types.JobStatusRunning,
			Message: fmt.Sprintf("Starting execution on %d servers", len(servers)),
		})
		
		// Start execution on each server
		for i, serverData := range servers {
			serverMap, ok := serverData.(map[string]interface{})
			if !ok {
				m.log.Warn("Invalid server data in job metadata")
				continue
			}
			
			// Extract server details
			serverDetails, err := m.extractServerDetails(serverMap)
			if err != nil {
				m.log.WithError(err).Warn("Failed to extract server details")
				continue
			}
			
			wg.Add(1)
			go func(idx int, server *types.ServerDetails) {
				defer wg.Done()
				
				// Create a copy of the job for this server
				serverJob := *job
				serverJob.Execution.Target.ServerDetails = server
				
				// Execute on this server
				serverResult := m.executeOnServer(ctx, &serverJob, idx, len(servers))
				
				// Store result
				resultsMu.Lock()
				results[server.ID] = serverResult
				resultsMu.Unlock()
				
				// Forward updates with server prefix
				for update := range serverResult.Updates {
					m.forwardUpdate(updates, update, server)
				}
			}(i, serverDetails)
		}
		
		// Wait for all executions to complete
		wg.Wait()
		
		// Aggregate results
		m.aggregateResults(updates, results)
	}()
	
	return updates, nil
}

// ServerResult holds the result of execution on a single server
type ServerResult struct {
	ServerID string
	Updates  <-chan types.ExecutionUpdate
	Status   types.JobStatus
	ExitCode int
	Output   string
	Error    error
}

// executeOnServer executes the job on a single server
func (m *MultiServerExecutor) executeOnServer(ctx context.Context, job *types.Job, index, total int) *ServerResult {
	result := &ServerResult{
		ServerID: job.Execution.Target.ServerDetails.ID,
		Status:   types.JobStatusPending,
	}
	
	// Create a channel to capture updates from single executor
	serverUpdates, err := m.executor.Execute(ctx, job)
	if err != nil {
		result.Error = err
		result.Status = types.JobStatusFailed
		
		// Create a channel with error update
		errorChan := make(chan types.ExecutionUpdate, 1)
		errorChan <- types.ExecutionUpdate{
			Type:      types.UpdateTypeError,
			Timestamp: time.Now(),
			Data: &types.StatusUpdate{
				Status:  types.JobStatusFailed,
				Message: fmt.Sprintf("Failed to start execution: %v", err),
				Error:   types.ErrorDetailsFromError(err),
			},
		}
		close(errorChan)
		result.Updates = errorChan
		return result
	}
	
	// Process updates to extract final status
	processedUpdates := make(chan types.ExecutionUpdate, 100)
	go func() {
		defer close(processedUpdates)
		
		for update := range serverUpdates {
			// Forward the update
			processedUpdates <- update
			
			// Track status
			switch update.Type {
			case types.UpdateTypeStatus:
				if status, ok := update.Data.(*types.StatusUpdate); ok {
					result.Status = status.Status
				}
			case types.UpdateTypeComplete:
				if status, ok := update.Data.(*types.StatusUpdate); ok {
					result.Status = status.Status
					if status.ExitCode != nil {
						result.ExitCode = *status.ExitCode
					}
				}
			case types.UpdateTypeError:
				result.Status = types.JobStatusFailed
				if status, ok := update.Data.(*types.StatusUpdate); ok {
					result.Error = fmt.Errorf(status.Message)
				}
			}
		}
	}()
	
	result.Updates = processedUpdates
	return result
}

// extractServerDetails extracts server details from metadata
func (m *MultiServerExecutor) extractServerDetails(serverMap map[string]interface{}) (*types.ServerDetails, error) {
	details := &types.ServerDetails{}
	
	// Extract required fields
	if id, ok := serverMap["id"].(string); ok {
		details.ID = id
	} else {
		return nil, fmt.Errorf("missing server ID")
	}
	
	if name, ok := serverMap["name"].(string); ok {
		details.Name = name
	}
	
	if host, ok := serverMap["host"].(string); ok {
		details.Host = host
	} else {
		return nil, fmt.Errorf("missing server host")
	}
	
	if port, ok := serverMap["port"].(float64); ok {
		details.Port = int(port)
	} else {
		details.Port = 22 // Default SSH port
	}
	
	if username, ok := serverMap["username"].(string); ok {
		details.Username = username
	} else {
		return nil, fmt.Errorf("missing server username")
	}
	
	if privateKey, ok := serverMap["privateKey"].(string); ok {
		details.PrivateKey = privateKey
	} else {
		return nil, fmt.Errorf("missing server private key")
	}
	
	if passphrase, ok := serverMap["passphrase"].(string); ok {
		details.Passphrase = passphrase
	}
	
	return details, nil
}

// forwardUpdate forwards an update with server context
func (m *MultiServerExecutor) forwardUpdate(updates chan<- types.ExecutionUpdate, update types.ExecutionUpdate, server *types.ServerDetails) {
	// Add server context to log entries
	switch update.Type {
	case types.UpdateTypeLog:
		if logEntry, ok := update.Data.(*types.LogEntry); ok {
			// Prefix log lines with server info
			prefixedEntry := *logEntry
			prefixedEntry.Line = fmt.Sprintf("[%s] %s", server.Name, logEntry.Line)
			update.Data = &prefixedEntry
		}
	case types.UpdateTypeStatus:
		if status, ok := update.Data.(*types.StatusUpdate); ok {
			// Add server info to status messages
			prefixedStatus := *status
			prefixedStatus.Message = fmt.Sprintf("[%s] %s", server.Name, status.Message)
			update.Data = &prefixedStatus
		}
	}
	
	m.sendUpdate(updates, update.Type, update.Data)
}

// aggregateResults aggregates results from all servers
func (m *MultiServerExecutor) aggregateResults(updates chan<- types.ExecutionUpdate, results map[string]*ServerResult) {
	// Count successes and failures
	var successCount, failureCount int
	var totalExitCode int
	
	for _, result := range results {
		if result.Status == types.JobStatusCompleted && result.ExitCode == 0 {
			successCount++
		} else {
			failureCount++
			if result.ExitCode != 0 {
				totalExitCode = result.ExitCode
			}
		}
	}
	
	// Determine overall status
	overallStatus := types.JobStatusCompleted
	statusMessage := fmt.Sprintf("Execution completed on %d/%d servers", successCount, len(results))
	
	if failureCount > 0 {
		if successCount == 0 {
			overallStatus = types.JobStatusFailed
			statusMessage = fmt.Sprintf("Execution failed on all %d servers", len(results))
		} else {
			// Partial failure
			overallStatus = types.JobStatusCompleted
			statusMessage = fmt.Sprintf("Execution partially succeeded: %d succeeded, %d failed", successCount, failureCount)
		}
	}
	
	// Send aggregated status
	m.sendUpdate(updates, types.UpdateTypeComplete, &types.StatusUpdate{
		Status:   overallStatus,
		ExitCode: &totalExitCode,
		Message:  statusMessage,
		Output: &types.OutputData{
			Data: map[string]interface{}{
				"successCount": successCount,
				"failureCount": failureCount,
				"totalServers": len(results),
				"results":      m.formatResults(results),
			},
		},
	})
}

// formatResults formats server results for metadata
func (m *MultiServerExecutor) formatResults(results map[string]*ServerResult) []map[string]interface{} {
	formatted := make([]map[string]interface{}, 0, len(results))
	
	for serverID, result := range results {
		formatted = append(formatted, map[string]interface{}{
			"serverId": serverID,
			"status":   string(result.Status),
			"exitCode": result.ExitCode,
			"error":    result.Error,
		})
	}
	
	return formatted
}

// Cleanup performs cleanup after execution
func (m *MultiServerExecutor) Cleanup(ctx context.Context, job *types.Job) error {
	// The underlying executor handles cleanup for each server
	return m.executor.Cleanup(ctx, job)
}

// sendUpdate sends an execution update
func (m *MultiServerExecutor) sendUpdate(updates chan<- types.ExecutionUpdate, updateType types.UpdateType, data interface{}) {
	select {
	case updates <- types.ExecutionUpdate{
		Type:      updateType,
		Timestamp: time.Now(),
		Data:      data,
	}:
	default:
		m.log.Warn("Updates channel full, dropping update")
	}
}