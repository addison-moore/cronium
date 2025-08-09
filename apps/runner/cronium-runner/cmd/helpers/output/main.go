package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/helpers"
)

func main() {
	// Load configuration
	config, err := helpers.LoadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Read input from stdin
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to read input: %v\n", err)
		os.Exit(1)
	}

	// Parse JSON input
	var data interface{}
	if len(input) > 0 {
		if err := json.Unmarshal(input, &data); err != nil {
			// If not valid JSON, treat as string
			data = string(input)
		}
	}

	switch config.Mode {
	case helpers.APIMode:
		// Use API client
		client := helpers.NewAPIClient(config.APIEndpoint, config.APIToken)
		if err := client.SetOutput(config.ExecutionID, data); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to set output via API: %v\n", err)
			os.Exit(1)
		}

	case helpers.BundledMode:
		// Use bundled client
		client := helpers.NewBundledClient(config.WorkDir, config.ExecutionID)
		if err := client.SetOutput(data); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to set output to file: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Fprintf(os.Stderr, "Error: Unknown mode: %s\n", config.Mode)
		os.Exit(1)
	}

	// Success - output confirmation
	fmt.Println("Output saved successfully")
}