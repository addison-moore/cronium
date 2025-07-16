package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/addison-more/cronium/orchestrator/internal/config"
	"github.com/addison-more/cronium/orchestrator/internal/health"
	"github.com/addison-more/cronium/orchestrator/internal/logger"
	"github.com/addison-more/cronium/orchestrator/internal/metrics"
	"github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

var (
	// Version information (set by build flags)
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

var (
	cfgFile string
	cfg     *config.Config
	log     *logrus.Logger
)

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

var rootCmd = &cobra.Command{
	Use:   "cronium-agent",
	Short: "Cronium orchestrator agent for secure job execution",
	Long: `Cronium Agent is a secure job orchestrator that executes scripts and commands
in isolated Docker containers with real-time log streaming and comprehensive monitoring.`,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// Initialize logger
		log = logger.New()
		
		// Load configuration
		var err error
		cfg, err = config.Load(cfgFile)
		if err != nil {
			return fmt.Errorf("failed to load configuration: %w", err)
		}
		
		// Configure logger with loaded config
		logger.Configure(log, cfg.Logging)
		
		return nil
	},
	RunE: runAgent,
}

func init() {
	rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file (default is cronium-orchestrator.yaml)")
	
	// Add subcommands
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(validateCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// Skip configuration loading for version command
		return nil
	},
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("Cronium Agent %s\n", Version)
		fmt.Printf("Build Time: %s\n", BuildTime)
		fmt.Printf("Git Commit: %s\n", GitCommit)
		fmt.Printf("Go Version: %s\n", runtime.Version())
		fmt.Printf("OS/Arch: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	},
}

var validateCmd = &cobra.Command{
	Use:   "validate",
	Short: "Validate configuration without starting the agent",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Configuration is already loaded and validated in PersistentPreRunE
		log.Info("Configuration is valid")
		
		// Pretty print configuration (with secrets hidden)
		if err := cfg.Print(os.Stdout); err != nil {
			return fmt.Errorf("failed to print configuration: %w", err)
		}
		
		return nil
	},
}

func runAgent(cmd *cobra.Command, args []string) error {
	log.WithFields(logrus.Fields{
		"version": Version,
		"build":   BuildTime,
		"commit":  GitCommit,
	}).Info("Starting Cronium Agent")
	
	// Create main context
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	
	// Set up signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	
	// Create health checker
	healthChecker := health.NewChecker(cfg.Monitoring, log)
	go healthChecker.Start(ctx)
	
	// Create and start health server
	healthServer := health.NewServer(cfg.Monitoring, healthChecker, log)
	if cfg.Monitoring.Enabled {
		go func() {
			if err := healthServer.Start(); err != nil && err != http.ErrServerClosed {
				log.WithError(err).Error("Health check server failed")
			}
		}()
	}
	
	// Create and start metrics server
	metricsServer := metrics.NewServer(cfg.Monitoring, log)
	if cfg.Monitoring.Enabled {
		go func() {
			if err := metricsServer.Start(); err != nil && err != http.ErrServerClosed {
				log.WithError(err).Error("Metrics server failed")
			}
		}()
	}
	
	// Create and start the orchestrator
	orch, err := NewSimpleOrchestrator(cfg, log)
	if err != nil {
		return fmt.Errorf("failed to create orchestrator: %w", err)
	}
	
	// Start orchestrator in background
	orchDone := make(chan error, 1)
	go func() {
		orchDone <- orch.Run(ctx)
	}()
	
	// Wait for shutdown signal or orchestrator error
	select {
	case sig := <-sigChan:
		log.WithField("signal", sig).Info("Received shutdown signal")
		cancel()
		
		// Wait for orchestrator to finish
		if err := <-orchDone; err != nil {
			log.WithError(err).Error("Orchestrator shutdown error")
		}
		
		// Shutdown health server
		if err := healthServer.Shutdown(context.Background()); err != nil {
			log.WithError(err).Error("Failed to shutdown health server")
		}
		
		// Shutdown metrics server
		if err := metricsServer.Shutdown(context.Background()); err != nil {
			log.WithError(err).Error("Failed to shutdown metrics server")
		}
		
		log.Info("Cronium Agent stopped")
		return nil
		
	case err := <-orchDone:
		if err != nil {
			log.WithError(err).Error("Orchestrator failed")
			return fmt.Errorf("orchestrator error: %w", err)
		}
		log.Info("Orchestrator stopped")
		return nil
	}
}