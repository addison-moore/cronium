package service

import (
	"context"
	"fmt"
	"time"

	"github.com/addison-more/cronium/runtime/internal/cache"
	"github.com/addison-more/cronium/runtime/internal/config"
	"github.com/addison-more/cronium/runtime/pkg/types"
	"github.com/sirupsen/logrus"
)

// RuntimeService implements the runtime API logic
type RuntimeService struct {
	backend *BackendClient
	cache   *cache.ValkeyClient
	config  *config.Config
	log     *logrus.Logger
}

// NewRuntimeService creates a new runtime service
func NewRuntimeService(backend *BackendClient, cache *cache.ValkeyClient, config *config.Config, log *logrus.Logger) *RuntimeService {
	return &RuntimeService{
		backend: backend,
		cache:   cache,
		config:  config,
		log:     log,
	}
}

// GetInput retrieves input data for an execution
func (s *RuntimeService) GetInput(ctx context.Context, executionID string) (interface{}, error) {
	// Try cache first
	input, err := s.cache.GetInput(ctx, executionID)
	if err != nil {
		s.log.WithError(err).Error("Failed to get input from cache")
	}
	if input != nil {
		s.log.WithField("executionId", executionID).Debug("Input retrieved from cache")
		return input.Data, nil
	}

	// If not in cache, get from backend
	execContext, err := s.getExecutionContext(ctx, executionID)
	if err != nil {
		return nil, err
	}

	// Get input from execution metadata
	if inputData, ok := execContext.Metadata["input"]; ok {
		// Cache for future requests
		input = &types.InputData{
			Data:      inputData,
			Timestamp: time.Now(),
		}
		if err := s.cache.SetInput(ctx, executionID, input); err != nil {
			s.log.WithError(err).Error("Failed to cache input")
		}
		
		// Audit log
		s.backend.AuditLog(ctx, executionID, "get_input", nil)
		
		return inputData, nil
	}

	return nil, nil
}

// SetOutput stores output data for an execution
func (s *RuntimeService) SetOutput(ctx context.Context, executionID string, data interface{}) error {
	// Get execution context to verify permissions
	execContext, err := s.getExecutionContext(ctx, executionID)
	if err != nil {
		return err
	}

	// Store in cache
	output := &types.OutputData{
		Data:      data,
		Timestamp: time.Now(),
	}
	if err := s.cache.SetOutput(ctx, executionID, output); err != nil {
		s.log.WithError(err).Error("Failed to cache output")
	}

	// Save to backend
	if err := s.backend.SaveOutput(ctx, executionID, data); err != nil {
		return fmt.Errorf("failed to save output: %w", err)
	}

	// Audit log
	s.backend.AuditLog(ctx, executionID, "set_output", map[string]interface{}{
		"userId": execContext.UserID,
	})

	return nil
}

// GetVariable retrieves a variable value
func (s *RuntimeService) GetVariable(ctx context.Context, executionID, key string) (interface{}, error) {
	// Try cache first
	variable, err := s.cache.GetVariable(ctx, executionID, key)
	if err != nil {
		s.log.WithError(err).Error("Failed to get variable from cache")
	}
	if variable != nil {
		s.log.WithFields(logrus.Fields{
			"executionId": executionID,
			"key":         key,
		}).Debug("Variable retrieved from cache")
		return variable.Value, nil
	}

	// Get execution context
	execContext, err := s.getExecutionContext(ctx, executionID)
	if err != nil {
		return nil, err
	}

	// Get from backend
	variable, err = s.backend.GetVariable(ctx, executionID, execContext.UserID, key)
	if err != nil {
		return nil, fmt.Errorf("failed to get variable: %w", err)
	}

	if variable == nil {
		return nil, nil
	}

	// Cache for future requests
	if err := s.cache.SetVariable(ctx, executionID, key, variable); err != nil {
		s.log.WithError(err).Error("Failed to cache variable")
	}

	// Audit log
	s.backend.AuditLog(ctx, executionID, "get_variable", map[string]interface{}{
		"key": key,
	})

	return variable.Value, nil
}

// SetVariable stores a variable value
func (s *RuntimeService) SetVariable(ctx context.Context, executionID, key string, value interface{}) error {
	// Get execution context
	execContext, err := s.getExecutionContext(ctx, executionID)
	if err != nil {
		return err
	}

	// Acquire lock to prevent concurrent updates
	lockKey := fmt.Sprintf("variable:%s:%s", executionID, key)
	locked, err := s.cache.Lock(ctx, lockKey, 5*time.Second)
	if err != nil {
		return fmt.Errorf("failed to acquire lock: %w", err)
	}
	if !locked {
		return fmt.Errorf("variable is locked by another process")
	}
	defer s.cache.Unlock(ctx, lockKey)

	// Save to backend
	if err := s.backend.SetVariable(ctx, executionID, execContext.UserID, key, value); err != nil {
		return fmt.Errorf("failed to set variable: %w", err)
	}

	// Update cache
	variable := &types.Variable{
		Key:       key,
		Value:     value,
		UpdatedAt: time.Now(),
	}
	if err := s.cache.SetVariable(ctx, executionID, key, variable); err != nil {
		s.log.WithError(err).Error("Failed to cache variable")
	}

	// Audit log
	s.backend.AuditLog(ctx, executionID, "set_variable", map[string]interface{}{
		"key": key,
	})

	return nil
}

// SetCondition stores a workflow condition result
func (s *RuntimeService) SetCondition(ctx context.Context, executionID string, condition bool) error {
	// Get execution context to verify permissions
	execContext, err := s.getExecutionContext(ctx, executionID)
	if err != nil {
		return err
	}

	// Save to backend
	if err := s.backend.SaveCondition(ctx, executionID, condition); err != nil {
		return fmt.Errorf("failed to save condition: %w", err)
	}

	// Audit log
	s.backend.AuditLog(ctx, executionID, "set_condition", map[string]interface{}{
		"condition": condition,
		"userId":    execContext.UserID,
	})

	return nil
}

// GetEventContext retrieves the execution context
func (s *RuntimeService) GetEventContext(ctx context.Context, executionID string) (*types.ExecutionContext, error) {
	return s.getExecutionContext(ctx, executionID)
}

// ExecuteToolAction executes a tool action
func (s *RuntimeService) ExecuteToolAction(ctx context.Context, executionID string, config types.ToolActionConfig) (*types.ToolActionResult, error) {
	// Get execution context
	execContext, err := s.getExecutionContext(ctx, executionID)
	if err != nil {
		return nil, err
	}

	// Execute via backend
	result, err := s.backend.ExecuteToolAction(ctx, executionID, execContext.UserID, config)
	if err != nil {
		return nil, fmt.Errorf("failed to execute tool action: %w", err)
	}

	// Audit log
	s.backend.AuditLog(ctx, executionID, "execute_tool_action", map[string]interface{}{
		"tool":   config.Tool,
		"action": config.Action,
	})

	return result, nil
}

// getExecutionContext retrieves execution context with caching
func (s *RuntimeService) getExecutionContext(ctx context.Context, executionID string) (*types.ExecutionContext, error) {
	// Try cache first
	execContext, err := s.cache.GetContext(ctx, executionID)
	if err != nil {
		s.log.WithError(err).Error("Failed to get context from cache")
	}
	if execContext != nil {
		return execContext, nil
	}

	// Get from backend
	execContext, err = s.backend.GetExecutionContext(ctx, executionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get execution context: %w", err)
	}

	// Cache for future requests
	if err := s.cache.SetContext(ctx, executionID, execContext); err != nil {
		s.log.WithError(err).Error("Failed to cache context")
	}

	return execContext, nil
}