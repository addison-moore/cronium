package helpers

import (
	"encoding/json"
	"errors"
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

func (c *BundledClient) path(name string) string {
	return filepath.Join(c.workDir, ".cronium", name)
}

// GetInput reads input data from input.json, or nil when there is none.
func (c *BundledClient) GetInput() (json.RawMessage, error) {
	var input struct {
		Data json.RawMessage `json:"data"`
	}
	if err := ReadJSON(c.path("input.json"), &input); err != nil {
		if os.IsNotExist(err) {
			// No input file means no input data
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read input: %w", err)
	}

	return nilIfNull(input.Data), nil
}

// SetOutput writes output data to output.json
func (c *BundledClient) SetOutput(data json.RawMessage) error {
	if err := WriteJSON(c.path("output.json"), OutputData{Data: data}); err != nil {
		return fmt.Errorf("failed to write output: %w", err)
	}

	return nil
}

// GetVariable reads a variable from variables.json, or nil when it is unset.
func (c *BundledClient) GetVariable(key string) (json.RawMessage, error) {
	var variables map[string]json.RawMessage
	if err := ReadJSON(c.path("variables.json"), &variables); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read variables: %w", err)
	}

	return nilIfNull(variables[key]), nil
}

// SetVariable writes a variable to variables.json
func (c *BundledClient) SetVariable(key string, value json.RawMessage) error {
	// Read existing variables
	var variables map[string]json.RawMessage
	if err := ReadJSON(c.path("variables.json"), &variables); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("failed to read variables: %w", err)
		}
		// Create new variables map if file doesn't exist
		variables = make(map[string]json.RawMessage)
	}

	// Update variable
	variables[key] = value

	// Write back
	if err := WriteJSON(c.path("variables.json"), variables); err != nil {
		return fmt.Errorf("failed to write variables: %w", err)
	}

	return nil
}

// SetCondition writes the condition to condition.json. Nothing relays it to a
// workflow from here: bundled mode means the runtime API could not be reached.
func (c *BundledClient) SetCondition(condition bool) error {
	if err := WriteJSON(c.path("condition.json"), ConditionData{Condition: condition}); err != nil {
		return fmt.Errorf("failed to write condition: %w", err)
	}

	return nil
}

// GetContext reads the event context from context.json
func (c *BundledClient) GetContext() (json.RawMessage, error) {
	var context json.RawMessage
	if err := ReadJSON(c.path("context.json"), &context); err != nil {
		return nil, fmt.Errorf("failed to read context: %w", err)
	}

	return context, nil
}

// ExecuteToolAction always fails: a tool action runs in the app, which bundled
// mode cannot reach.
func (c *BundledClient) ExecuteToolAction(tool, action string, config json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("tool actions need the runtime API, which this execution could not reach")
}
