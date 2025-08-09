package main

import (
	"encoding/json"
	"fmt"
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

	var data interface{}

	switch config.Mode {
	case helpers.APIMode:
		// Use API client
		client := helpers.NewAPIClient(config.APIEndpoint, config.APIToken)
		data, err = client.GetInput(config.ExecutionID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get input via API: %v\n", err)
			os.Exit(1)
		}

	case helpers.BundledMode:
		// Use bundled client
		client := helpers.NewBundledClient(config.WorkDir, config.ExecutionID)
		data, err = client.GetInput()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get input from file: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Fprintf(os.Stderr, "Error: Unknown mode: %s\n", config.Mode)
		os.Exit(1)
	}

	// Output the data as JSON to stdout
	if data == nil {
		// No input data available
		fmt.Println("null")
	} else {
		output, err := json.Marshal(data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to marshal output: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(string(output))
	}
}