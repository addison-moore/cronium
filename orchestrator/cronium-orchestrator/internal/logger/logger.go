package logger

import (
	"os"

	"github.com/addison-more/cronium/orchestrator/internal/config"
	"github.com/sirupsen/logrus"
)

// New creates a new logger instance
func New() *logrus.Logger {
	log := logrus.New()
	log.SetOutput(os.Stdout)
	log.SetLevel(logrus.InfoLevel)
	log.SetFormatter(&logrus.JSONFormatter{
		TimestampFormat: "2006-01-02T15:04:05.000Z07:00",
	})
	return log
}

// Configure configures an existing logger with the provided config
func Configure(log *logrus.Logger, cfg config.LoggingConfig) {
	// Set log level
	level, err := logrus.ParseLevel(cfg.Level)
	if err != nil {
		log.WithError(err).Warn("Invalid log level, using info")
		level = logrus.InfoLevel
	}
	log.SetLevel(level)
	
	// Set formatter
	switch cfg.Format {
	case "json":
		log.SetFormatter(&logrus.JSONFormatter{
			TimestampFormat: "2006-01-02T15:04:05.000Z07:00",
		})
	case "text":
		log.SetFormatter(&logrus.TextFormatter{
			TimestampFormat: "2006-01-02 15:04:05",
			FullTimestamp:   true,
		})
	default:
		log.WithField("format", cfg.Format).Warn("Unknown log format, using JSON")
		log.SetFormatter(&logrus.JSONFormatter{
			TimestampFormat: "2006-01-02T15:04:05.000Z07:00",
		})
	}
	
	// Set output
	switch cfg.Output {
	case "stdout":
		log.SetOutput(os.Stdout)
	case "stderr":
		log.SetOutput(os.Stderr)
	case "file":
		if cfg.File.Enabled && cfg.File.Path != "" {
			// TODO: Implement file logging with rotation
			log.Warn("File logging not yet implemented, using stdout")
			log.SetOutput(os.Stdout)
		}
	default:
		log.WithField("output", cfg.Output).Warn("Unknown log output, using stdout")
		log.SetOutput(os.Stdout)
	}
}