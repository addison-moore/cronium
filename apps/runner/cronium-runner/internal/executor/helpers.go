package executor

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/helpers"
	"github.com/addison-moore/cronium/apps/runner/cronium-runner/pkg/types"
)

// SetupHelpers prepares the runtime helpers for execution
func (e *Executor) SetupHelpers(manifest *types.Manifest) error {
	e.log.Info("Setting up runtime helpers")

	// Determine helper mode - check environment variables first, then manifest
	mode := helpers.BundledMode
	apiEndpoint := os.Getenv("CRONIUM_API_ENDPOINT")
	apiToken := os.Getenv("CRONIUM_API_TOKEN")
	
	// Environment variables take precedence over manifest
	if apiEndpoint == "" {
		apiEndpoint = manifest.Metadata.APIEndpoint
	}
	if apiToken == "" {
		apiToken = manifest.Metadata.APIToken
	}
	
	if apiEndpoint != "" && apiToken != "" {
		mode = helpers.APIMode
	}
	
	// Check if helper mode is explicitly set
	if envMode := os.Getenv("CRONIUM_HELPER_MODE"); envMode != "" {
		if envMode == "api" {
			mode = helpers.APIMode
		} else if envMode == "bundled" {
			mode = helpers.BundledMode
		}
	}

	// Get execution ID from environment (set by orchestrator)
	// The manifest may contain a different execution ID that was generated
	// when the payload was created, but we should use the one from the orchestrator
	// which matches the JWT token
	executionID := os.Getenv("CRONIUM_EXECUTION_ID")
	if executionID == "" {
		// Only fall back to manifest if no environment variable is set
		// This should only happen in local testing
		executionID = manifest.Metadata.ExecutionID
		e.log.Warn("Using execution ID from manifest as environment variable not set")
	}

	// Create helper config
	config := helpers.Config{
		Mode:        mode,
		ExecutionID: executionID,
		JobID:       manifest.Metadata.JobID,
		EventID:     manifest.Metadata.EventID,
		WorkDir:     e.workDir,
		APIEndpoint: apiEndpoint,
		APIToken:    apiToken,
	}
	
	// Log configuration for debugging
	e.log.WithFields(map[string]interface{}{
		"mode":        mode,
		"executionID": executionID,
		"jobID":       manifest.Metadata.JobID,
		"apiEndpoint": apiEndpoint,
		"hasToken":    apiToken != "",
	}).Debug("Helper configuration determined")

	// Save config to file
	configDir := filepath.Join(e.workDir, ".cronium")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	configPath := filepath.Join(configDir, "config.json")
	configData, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}


	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	// Extract helper binaries
	helpersDir := filepath.Join(e.workDir, ".cronium", "bin")
	if err := helpers.ExtractAllHelpers(helpersDir); err != nil {
		return fmt.Errorf("failed to extract helpers: %w", err)
	}

	// Add helpers directory to PATH
	currentPath := os.Getenv("PATH")
	newPath := fmt.Sprintf("%s%c%s", helpersDir, os.PathListSeparator, currentPath)
	os.Setenv("PATH", newPath)

	// Set environment variables for helpers
	os.Setenv("CRONIUM_HELPER_MODE", string(config.Mode))
	os.Setenv("CRONIUM_EXECUTION_ID", config.ExecutionID)
	os.Setenv("CRONIUM_JOB_ID", config.JobID)
	os.Setenv("CRONIUM_EVENT_ID", config.EventID)
	os.Setenv("CRONIUM_WORK_DIR", config.WorkDir)

	if config.Mode == helpers.APIMode {
		os.Setenv("CRONIUM_API_ENDPOINT", config.APIEndpoint)
		os.Setenv("CRONIUM_API_TOKEN", config.APIToken)
	}

	// For bundled mode, prepare initial data files
	if config.Mode == helpers.BundledMode {
		// Create event context
		context := helpers.EventContext{
			EventID:     manifest.Metadata.EventID,
			EventName:   manifest.Metadata.EventName,
			ExecutionID: manifest.Metadata.ExecutionID,
			JobID:       manifest.Metadata.JobID,
			Trigger:     manifest.Metadata.Trigger,
			StartTime:   manifest.Metadata.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			Environment: manifest.Environment,
			Metadata:    manifest.Metadata.Extra,
		}

		contextPath := filepath.Join(configDir, "context.json")
		if err := helpers.WriteJSON(contextPath, context); err != nil {
			return fmt.Errorf("failed to write context: %w", err)
		}

		// Initialize empty variables file
		varsPath := filepath.Join(configDir, "variables.json")
		if err := helpers.WriteJSON(varsPath, map[string]interface{}{}); err != nil {
			return fmt.Errorf("failed to write variables: %w", err)
		}

		// If input data is provided, write it
		if manifest.Metadata.InputData != nil {
			inputPath := filepath.Join(configDir, "input.json")
			input := helpers.InputData{
				Data: manifest.Metadata.InputData,
			}
			if err := helpers.WriteJSON(inputPath, input); err != nil {
				return fmt.Errorf("failed to write input: %w", err)
			}
		}
	}

	// Set up discovery scripts
	interpreter := string(manifest.Interpreter)
	if err := helpers.SetupDiscovery(e.workDir, interpreter); err != nil {
		return fmt.Errorf("failed to setup discovery: %w", err)
	}

	e.log.Info("Runtime helpers setup complete")
	return nil
}

// CollectHelperOutput collects any output data from bundled mode helpers
func (e *Executor) CollectHelperOutput() (interface{}, error) {
	outputPath := filepath.Join(e.workDir, ".cronium", "output.json")
	
	// Check if output file exists
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		// No output file means no output data
		return nil, nil
	}

	var output helpers.OutputData
	if err := helpers.ReadJSON(outputPath, &output); err != nil {
		return nil, fmt.Errorf("failed to read output: %w", err)
	}

	return output.Data, nil
}