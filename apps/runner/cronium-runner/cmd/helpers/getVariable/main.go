package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/helpers"
)

func main() {
	// Check arguments
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: %s <variable-key>\n", os.Args[0])
		os.Exit(1)
	}

	key := os.Args[1]

	// Load configuration
	config, err := helpers.LoadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to load config: %v\n", err)
		os.Exit(1)
	}


	var value interface{}

	switch config.Mode {
	case helpers.APIMode:
		// Use API client
		client := helpers.NewAPIClient(config.APIEndpoint, config.APIToken)
		value, err = client.GetVariable(config.ExecutionID, key)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get variable via API: %v\n", err)
			os.Exit(1)
		}

	case helpers.BundledMode:
		// Use bundled client
		client := helpers.NewBundledClient(config.WorkDir, config.ExecutionID)
		value, err = client.GetVariable(key)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get variable from file: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Fprintf(os.Stderr, "Error: Unknown mode: %s\n", config.Mode)
		os.Exit(1)
	}

	// Output the value as JSON to stdout
	if value == nil {
		fmt.Println("null")
	} else {
		output, err := json.Marshal(value)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to marshal output: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(string(output))
	}
}