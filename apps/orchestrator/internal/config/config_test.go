package config

import (
	"strings"
	"testing"

	"github.com/kelseyhightower/envconfig"
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
