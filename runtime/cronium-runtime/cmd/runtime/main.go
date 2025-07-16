package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/addison-more/cronium/runtime/internal/api"
	"github.com/addison-more/cronium/runtime/internal/cache"
	"github.com/addison-more/cronium/runtime/internal/config"
	"github.com/addison-more/cronium/runtime/internal/service"
	"github.com/sirupsen/logrus"
)

func main() {
	// Initialize logger
	log := logrus.New()
	log.SetFormatter(&logrus.JSONFormatter{})
	log.SetOutput(os.Stdout)

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.WithError(err).Fatal("Failed to load configuration")
	}

	// Set log level
	level, err := logrus.ParseLevel(cfg.Logging.Level)
	if err != nil {
		log.WithError(err).Warn("Invalid log level, defaulting to info")
		level = logrus.InfoLevel
	}
	log.SetLevel(level)

	log.WithFields(logrus.Fields{
		"version": cfg.Version,
		"port":    cfg.Server.Port,
	}).Info("Starting Cronium Runtime Service")

	// Initialize Valkey cache
	cacheClient, err := cache.NewValkeyClient(cfg.Cache)
	if err != nil {
		log.WithError(err).Fatal("Failed to initialize cache")
	}
	defer cacheClient.Close()

	// Initialize backend client
	backendClient := service.NewBackendClient(cfg.Backend, log)

	// Initialize runtime service
	runtimeService := service.NewRuntimeService(
		backendClient,
		cacheClient,
		cfg,
		log,
	)

	// Create API router
	router := api.NewRouter(runtimeService, cfg, log)

	// Create HTTP server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	// Start server in background
	go func() {
		log.WithField("port", cfg.Server.Port).Info("HTTP server starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.WithError(err).Fatal("Failed to start HTTP server")
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down server...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.WithError(err).Error("Server forced to shutdown")
	}

	log.Info("Server stopped")
}