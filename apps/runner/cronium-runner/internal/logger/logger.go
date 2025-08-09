package logger

import (
	"os"
	"time"

	"github.com/sirupsen/logrus"
)

// New creates a new logger instance with the specified log level
func New(level string) *logrus.Logger {
	log := logrus.New()

	// Set output to stdout
	log.SetOutput(os.Stdout)

	// Set formatter
	log.SetFormatter(&logrus.TextFormatter{
		FullTimestamp:   true,
		TimestampFormat: time.RFC3339,
		DisableColors:   false,
	})

	// Parse and set log level
	parsedLevel, err := logrus.ParseLevel(level)
	if err != nil {
		log.WithError(err).Warnf("Invalid log level '%s', defaulting to 'info'", level)
		parsedLevel = logrus.InfoLevel
	}
	log.SetLevel(parsedLevel)

	return log
}

