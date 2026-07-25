package logger

import (
	"io"
	"os"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_Defaults(t *testing.T) {
	log := New()
	require.NotNil(t, log)

	assert.Equal(t, logrus.InfoLevel, log.GetLevel())
	assert.Same(t, os.Stdout, log.Out)

	formatter, ok := log.Formatter.(*logrus.JSONFormatter)
	require.True(t, ok, "default formatter must be JSON")
	assert.Equal(t, "2006-01-02T15:04:05.000Z07:00", formatter.TimestampFormat)
}

func TestConfigure_Level(t *testing.T) {
	log := New()
	log.SetOutput(io.Discard) // silence warning output during the test
	// Output "file" (not enabled) leaves the discard output in place.

	Configure(log, config.LoggingConfig{Level: "debug", Format: "json", Output: "file"})
	assert.Equal(t, logrus.DebugLevel, log.GetLevel())

	Configure(log, config.LoggingConfig{Level: "warn", Format: "json", Output: "file"})
	assert.Equal(t, logrus.WarnLevel, log.GetLevel())

	// Invalid level falls back to info.
	Configure(log, config.LoggingConfig{Level: "not-a-level", Format: "json", Output: "file"})
	assert.Equal(t, logrus.InfoLevel, log.GetLevel())
}

func TestConfigure_Format(t *testing.T) {
	log := New()
	log.SetOutput(io.Discard) // silence warning output during the test
	// Output "file" (not enabled) leaves the discard output in place.

	Configure(log, config.LoggingConfig{Level: "info", Format: "text", Output: "file"})
	textFormatter, ok := log.Formatter.(*logrus.TextFormatter)
	require.True(t, ok)
	assert.True(t, textFormatter.FullTimestamp)

	Configure(log, config.LoggingConfig{Level: "info", Format: "json", Output: "file"})
	_, ok = log.Formatter.(*logrus.JSONFormatter)
	assert.True(t, ok)

	// Unknown format falls back to JSON.
	Configure(log, config.LoggingConfig{Level: "info", Format: "xml", Output: "file"})
	_, ok = log.Formatter.(*logrus.JSONFormatter)
	assert.True(t, ok)
}

func TestConfigure_Output(t *testing.T) {
	log := New()

	Configure(log, config.LoggingConfig{Level: "info", Format: "json", Output: "stderr"})
	assert.Same(t, os.Stderr, log.Out)

	Configure(log, config.LoggingConfig{Level: "info", Format: "json", Output: "stdout"})
	assert.Same(t, os.Stdout, log.Out)

	// Unknown output falls back to stdout.
	log.SetOutput(io.Discard)
	Configure(log, config.LoggingConfig{Level: "info", Format: "json", Output: "syslog"})
	assert.Same(t, os.Stdout, log.Out)

	// File logging is not implemented: enabled file config falls back to stdout.
	log.SetOutput(io.Discard)
	Configure(log, config.LoggingConfig{
		Level: "info", Format: "json", Output: "file",
		File: config.FileLogConfig{Enabled: true, Path: "/tmp/test.log"},
	})
	assert.Same(t, os.Stdout, log.Out)

	// "file" without an enabled file config leaves the output untouched.
	log.SetOutput(io.Discard)
	Configure(log, config.LoggingConfig{Level: "info", Format: "json", Output: "file"})
	assert.True(t, log.Out == io.Discard, "output must be left untouched")
}
