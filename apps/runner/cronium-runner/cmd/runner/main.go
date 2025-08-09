package main

import (
	"fmt"
	"os"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/executor"
	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/logger"
	"github.com/spf13/cobra"
)

var (
	// Version information (set during build)
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

var rootCmd = &cobra.Command{
	Use:   "cronium-runner",
	Short: "Cronium runner executes scripts from signed payloads",
	Long: `Cronium runner is a secure execution environment for running scripts
on remote servers. It extracts and verifies signed payloads, then executes
the contained scripts with proper isolation and cleanup.`,
}

var runCmd = &cobra.Command{
	Use:   "run [payload]",
	Short: "Execute a script from a payload",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadPath := args[0]

		// Initialize logger
		log := logger.New(logLevel)

		// Create executor
		exec := executor.New(log)

		// Set up cleanup handler
		defer func() {
			if err := exec.Cleanup(); err != nil {
				log.WithError(err).Error("Cleanup failed")
			}
		}()

		// Execute the payload
		if err := exec.Execute(payloadPath); err != nil {
			log.WithError(err).Error("Execution failed")
			return err
		}

		return nil
	},
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("Cronium Runner %s\n", Version)
		fmt.Printf("Built: %s\n", BuildTime)
		fmt.Printf("Commit: %s\n", GitCommit)
	},
}

var (
	logLevel string
)

func init() {
	rootCmd.AddCommand(runCmd)
	rootCmd.AddCommand(versionCmd)

	rootCmd.PersistentFlags().StringVar(&logLevel, "log-level", "info", "Log level (debug, info, warn, error)")
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

