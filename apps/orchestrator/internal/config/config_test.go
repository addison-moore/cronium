package config

import (
	"bytes"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/kelseyhightower/envconfig"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validConfigForTest() Config {
	return Config{
		API:  APIConfig{Endpoint: "http://app", Token: "internal-token"},
		Jobs: JobsConfig{MaxConcurrent: 1, PollBatchSize: 1},
		Container: ContainerConfig{Resources: ResourceConfig{
			Defaults: ResourceLimits{CPU: 1},
			Limits:   ResourceLimits{CPU: 2},
		}},
		SSH: SSHConfig{Execution: SSHExecutionConfig{
			IsolationMode: SSHIsolationDisabled,
		}},
		Monitoring: MonitoringConfig{MetricsPort: 9090, HealthPort: 8080},
	}
}

func TestValidateSSHIsolationMode(t *testing.T) {
	for _, mode := range []string{
		SSHIsolationDisabled,
		SSHIsolationOperatorEnforced,
	} {
		cfg := validConfigForTest()
		cfg.SSH.Execution.IsolationMode = mode
		if err := cfg.Validate(); err != nil {
			t.Fatalf("mode %q should be valid: %v", mode, err)
		}
	}

	cfg := validConfigForTest()
	cfg.SSH.Execution.IsolationMode = "shared-uid"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "isolationMode") {
		t.Fatalf("unsafe isolation mode should be rejected, got %v", err)
	}
}

func TestSSHIsolationModeEnvironmentMapping(t *testing.T) {
	t.Setenv("CRONIUM_API_ENDPOINT", "http://cronium-app:3000/api/internal")
	t.Setenv("CRONIUM_API_TOKEN", "test-internal-token")
	t.Setenv(
		"CRONIUM_SSH_EXECUTION_ISOLATION_MODE",
		SSHIsolationOperatorEnforced,
	)

	var cfg Config
	if err := envconfig.Process("CRONIUM", &cfg); err != nil {
		t.Fatalf("process environment: %v", err)
	}
	if cfg.SSH.Execution.IsolationMode != SSHIsolationOperatorEnforced {
		t.Fatalf(
			"unexpected isolation mode %q",
			cfg.SSH.Execution.IsolationMode,
		)
	}
}

// docker-compose.example.yml lists the optional settings it passes to the
// orchestrator by name, because Compose has no way to pass a prefix. A name the
// orchestrator doesn't read does nothing and says nothing about it.
func TestComposeFileOnlyPassesSettingsTheOrchestratorReads(t *testing.T) {
	var keys bytes.Buffer
	require.NoError(t, envconfig.Usagef("CRONIUM", &Config{}, &keys, "{{range .}}{{.Key}}\n{{end}}"))
	known := map[string]bool{
		// Read directly, by LoadTimeoutConfig.
		"CRONIUM_SETUP_TIMEOUT":         true,
		"CRONIUM_CLEANUP_TIMEOUT":       true,
		"CRONIUM_MAX_EXECUTION_TIMEOUT": true,
	}
	for _, key := range strings.Fields(keys.String()) {
		known[key] = true
	}

	compose, err := os.ReadFile("../../../../docker-compose.example.yml")
	require.NoError(t, err)
	passed := regexp.MustCompile(`(?m)^\s+(CRONIUM_[A-Z0-9_]+):\s*$`).FindAllSubmatch(compose, -1)
	require.NotEmpty(t, passed, "the pattern no longer finds the list in the compose file")
	for _, match := range passed {
		assert.True(t, known[string(match[1])], "%s is not a setting the orchestrator reads", match[1])
	}
}
