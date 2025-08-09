package helpers

import (
	"fmt"
	"os"
	"path/filepath"
)

// BundledClient handles file-based communication for offline execution
type BundledClient struct {
	workDir     string
	executionID string
}

// NewBundledClient creates a new bundled mode client
func NewBundledClient(workDir, executionID string) *BundledClient {
	return &BundledClient{
		workDir:     workDir,
		executionID: executionID,
	}
}

// GetInput reads input data from input.json
func (c *BundledClient) GetInput() (interface{}, error) {
	inputPath := filepath.Join(c.workDir, ".cronium", "input.json")
	
	var input InputData
	if err := ReadJSON(inputPath, &input); err != nil {
		if os.IsNotExist(err) {
			// No input file means no input data
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read input: %w", err)
	}
	
	return input.Data, nil
}

// SetOutput writes output data to output.json
func (c *BundledClient) SetOutput(data interface{}) error {
	outputPath := filepath.Join(c.workDir, ".cronium", "output.json")
	
	output := OutputData{
		Data: data,
	}
	
	if err := WriteJSON(outputPath, output); err != nil {
		return fmt.Errorf("failed to write output: %w", err)
	}
	
	return nil
}

// GetVariable reads a variable from variables.json
func (c *BundledClient) GetVariable(key string) (interface{}, error) {
	varsPath := filepath.Join(c.workDir, ".cronium", "variables.json")
	
	var variables map[string]interface{}
	if err := ReadJSON(varsPath, &variables); err != nil {
		if os.IsNotExist(err) {
			// No variables file means variable doesn't exist
			return nil, fmt.Errorf("variable '%s' not found", key)
		}
		return nil, fmt.Errorf("failed to read variables: %w", err)
	}
	
	value, exists := variables[key]
	if !exists {
		return nil, fmt.Errorf("variable '%s' not found", key)
	}
	
	return value, nil
}

// SetVariable writes a variable to variables.json
func (c *BundledClient) SetVariable(key string, value interface{}) error {
	varsPath := filepath.Join(c.workDir, ".cronium", "variables.json")
	
	// Read existing variables
	var variables map[string]interface{}
	if err := ReadJSON(varsPath, &variables); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("failed to read variables: %w", err)
		}
		// Create new variables map if file doesn't exist
		variables = make(map[string]interface{})
	}
	
	// Update variable
	variables[key] = value
	
	// Write back
	if err := WriteJSON(varsPath, variables); err != nil {
		return fmt.Errorf("failed to write variables: %w", err)
	}
	
	return nil
}

// GetContext reads the event context from context.json
func (c *BundledClient) GetContext() (*EventContext, error) {
	contextPath := filepath.Join(c.workDir, ".cronium", "context.json")
	
	var context EventContext
	if err := ReadJSON(contextPath, &context); err != nil {
		return nil, fmt.Errorf("failed to read context: %w", err)
	}
	
	return &context, nil
}