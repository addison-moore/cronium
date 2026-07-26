package config

import (
	"os"
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

// TestWebSocketLoggingDisabledByDefault pins the FINDINGS #34 decision: the
// raw-WS log-shipping channel has no consumer (the socket server speaks only
// Socket.IO + HTTP /broadcast/*), so it defaults OFF and requires an explicit
// CRONIUM_LOGGING_WEBSOCKET_ENABLED=true opt-in.
func TestWebSocketLoggingDisabledByDefault(t *testing.T) {
	t.Setenv("CRONIUM_API_ENDPOINT", "http://cronium-app:3000/api/internal")
	t.Setenv("CRONIUM_API_TOKEN", "test-internal-token")
	// t.Setenv registers restoration of any ambient value; the variable must
	// then be truly UNSET (envconfig rejects an empty string for a bool).
	t.Setenv("CRONIUM_LOGGING_WEBSOCKET_ENABLED", "placeholder")
	if err := os.Unsetenv("CRONIUM_LOGGING_WEBSOCKET_ENABLED"); err != nil {
		t.Fatalf("unsetenv: %v", err)
	}

	var cfg Config
	if err := envconfig.Process("CRONIUM", &cfg); err != nil {
		t.Fatalf("process environment: %v", err)
	}
	if cfg.Logging.WebSocket.Enabled {
		t.Fatal("logging.websocket.enabled must default to false (FINDINGS #34)")
	}

	t.Setenv("CRONIUM_LOGGING_WEBSOCKET_ENABLED", "true")
	if err := envconfig.Process("CRONIUM", &cfg); err != nil {
		t.Fatalf("process environment with opt-in: %v", err)
	}
	if !cfg.Logging.WebSocket.Enabled {
		t.Fatal("explicit CRONIUM_LOGGING_WEBSOCKET_ENABLED=true must enable the channel")
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
