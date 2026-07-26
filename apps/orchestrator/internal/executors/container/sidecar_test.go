package container

import (
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// envMap converts a Docker-style KEY=VALUE slice into a map, failing on
// malformed or duplicate entries.
func envMap(t *testing.T, env []string) map[string]string {
	t.Helper()
	out := make(map[string]string, len(env))
	for _, kv := range env {
		key, value, ok := strings.Cut(kv, "=")
		require.True(t, ok, "malformed env entry %q", kv)
		_, dup := out[key]
		require.False(t, dup, "duplicate env key %q", key)
		out[key] = value
	}
	return out
}

// TestBuildSidecarEnvPassesCanonicalAndLegacyNames pins the sidecar's env
// contract (FINDINGS #39 latent hazard): every value travels under BOTH the
// canonical RUNTIME_-prefixed name (the runtime's envconfig prefix, matching
// the compose contract) and the legacy bare name that only works via
// envconfig's alt-name fallback (kept for older runtime images).
func TestBuildSidecarEnvPassesCanonicalAndLegacyNames(t *testing.T) {
	rt := config.RuntimeConfig{
		JWTSecret:      "sidecar-secret",
		BackendURL:     "http://cronium-app:3000",
		ValkeyURL:      "valkey://valkey:6379",
		ValkeyPassword: "valkey-pw",
	}

	env := envMap(t, buildSidecarEnv("job-1", rt, "backend-token"))

	assert.Equal(t, "job-1", env["EXECUTION_ID"])

	// Every canonical/legacy pair must be present and identical.
	pairs := map[string]string{
		"RUNTIME_JWT_SECRET":      "JWT_SECRET",
		"RUNTIME_BACKEND_URL":     "BACKEND_URL",
		"RUNTIME_BACKEND_TOKEN":   "BACKEND_TOKEN",
		"RUNTIME_VALKEY_URL":      "VALKEY_URL",
		"RUNTIME_PORT":            "PORT",
		"RUNTIME_LOG_LEVEL":       "LOG_LEVEL",
		"RUNTIME_VALKEY_PASSWORD": "VALKEY_PASSWORD",
	}
	for canonical, legacy := range pairs {
		require.Contains(t, env, canonical)
		require.Contains(t, env, legacy)
		assert.Equal(t, env[canonical], env[legacy],
			"%s and %s must carry the same value", canonical, legacy)
	}

	assert.Equal(t, "sidecar-secret", env["RUNTIME_JWT_SECRET"])
	assert.Equal(t, "http://cronium-app:3000", env["RUNTIME_BACKEND_URL"])
	assert.Equal(t, "backend-token", env["RUNTIME_BACKEND_TOKEN"])
	assert.Equal(t, "valkey://valkey:6379", env["RUNTIME_VALKEY_URL"])
	assert.Equal(t, "8081", env["RUNTIME_PORT"])
	assert.Equal(t, "info", env["RUNTIME_LOG_LEVEL"])
	assert.Equal(t, "valkey-pw", env["RUNTIME_VALKEY_PASSWORD"])
}

// Without a configured Valkey password, NEITHER password variable is set so
// no-auth (dev) Valkey deployments keep working.
func TestBuildSidecarEnvOmitsValkeyPasswordWhenUnset(t *testing.T) {
	rt := config.RuntimeConfig{
		JWTSecret:  "s",
		BackendURL: "http://app",
		ValkeyURL:  "valkey://valkey:6379",
	}

	env := envMap(t, buildSidecarEnv("job-2", rt, ""))
	assert.NotContains(t, env, "RUNTIME_VALKEY_PASSWORD")
	assert.NotContains(t, env, "VALKEY_PASSWORD")
}
