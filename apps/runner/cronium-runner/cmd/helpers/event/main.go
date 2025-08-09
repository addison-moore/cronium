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

	var context *helpers.EventContext

	switch config.Mode {
	case helpers.APIMode:
		// Use API client
		client := helpers.NewAPIClient(config.APIEndpoint, config.APIToken)
		context, err = client.GetContext(config.ExecutionID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get context via API: %v\n", err)
			os.Exit(1)
		}

	case helpers.BundledMode:
		// Use bundled client
		client := helpers.NewBundledClient(config.WorkDir, config.ExecutionID)
		context, err = client.GetContext()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get context from file: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Fprintf(os.Stderr, "Error: Unknown mode: %s\n", config.Mode)
		os.Exit(1)
	}

	// Output the context as JSON to stdout
	output, err := json.MarshalIndent(context, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to marshal output: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(string(output))
}