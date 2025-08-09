package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/helpers"
)

func main() {
	// Check arguments
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: %s <variable-key> [value]\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "If value is not provided, it will be read from stdin\n")
		os.Exit(1)
	}

	key := os.Args[1]
	var value interface{}

	if len(os.Args) >= 3 {
		// Value provided as argument
		value = os.Args[2]
	} else {
		// Read value from stdin
		input, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to read input: %v\n", err)
			os.Exit(1)
		}

		// Try to parse as JSON
		if len(input) > 0 {
			if err := json.Unmarshal(input, &value); err != nil {
				// If not valid JSON, treat as string
				value = string(input)
			}
		}
	}

	// Load configuration
	config, err := helpers.LoadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to load config: %v\n", err)
		os.Exit(1)
	}

	switch config.Mode {
	case helpers.APIMode:
		// Use API client
		client := helpers.NewAPIClient(config.APIEndpoint, config.APIToken)
		if err := client.SetVariable(config.ExecutionID, key, value); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to set variable via API: %v\n", err)
			os.Exit(1)
		}

	case helpers.BundledMode:
		// Use bundled client
		client := helpers.NewBundledClient(config.WorkDir, config.ExecutionID)
		if err := client.SetVariable(key, value); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to set variable to file: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Fprintf(os.Stderr, "Error: Unknown mode: %s\n", config.Mode)
		os.Exit(1)
	}

	// Success - output confirmation
	fmt.Printf("Variable '%s' set successfully\n", key)
}