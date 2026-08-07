package container

import (
	"net/netip"
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
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

// The job container reaches the runtime through the sidecar's IP on the
// per-job network. The endpoint map has been keyed by network NAME on some
// daemons and by ID on others; when neither lookup hits (or the address is
// unset) the caller must fall back to the "runtime-api" DNS alias rather than
// build a bogus URL. Regression: a job whose alias never registered failed
// every cronium_* helper with curl exit 6 (couldn't resolve host).
func TestSidecarIPOnNetwork(t *testing.T) {
	const (
		netID   = "dae6dbc956dfed77303164855e3b4ff15b97b95c993c2409d0c0f0215692ff01"
		netName = "cronium-job-job_rBRAH1q2XOYr"
	)
	endpoint := func(ip string) *network.EndpointSettings {
		ep := &network.EndpointSettings{}
		if ip != "" {
			ep.IPAddress = netip.MustParseAddr(ip)
		}
		return ep
	}
	withNetworks := func(nets map[string]*network.EndpointSettings) container.InspectResponse {
		return container.InspectResponse{
			NetworkSettings: &container.NetworkSettings{Networks: nets},
		}
	}

	tests := []struct {
		name string
		in   container.InspectResponse
		want string
	}{
		{
			name: "keyed by network name",
			in:   withNetworks(map[string]*network.EndpointSettings{netName: endpoint("172.20.0.3")}),
			want: "172.20.0.3",
		},
		{
			name: "keyed by network id",
			in:   withNetworks(map[string]*network.EndpointSettings{netID: endpoint("172.20.0.4")}),
			want: "172.20.0.4",
		},
		{
			name: "name wins when both are present",
			in: withNetworks(map[string]*network.EndpointSettings{
				netName: endpoint("172.20.0.5"),
				netID:   endpoint("172.20.0.6"),
			}),
			want: "172.20.0.5",
		},
		{
			name: "unrelated network only falls back to the alias",
			in:   withNetworks(map[string]*network.EndpointSettings{"cronium-e2e-net": endpoint("172.30.99.5")}),
			want: "",
		},
		{
			name: "endpoint without an address falls back to the alias",
			in:   withNetworks(map[string]*network.EndpointSettings{netName: endpoint("")}),
			want: "",
		},
		{
			name: "nil endpoint falls back to the alias",
			in:   withNetworks(map[string]*network.EndpointSettings{netName: nil}),
			want: "",
		},
		{
			name: "no network settings at all falls back to the alias",
			in:   container.InspectResponse{},
			want: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, sidecarIPOnNetwork(tc.in, netID, netName))
		})
	}
}

// The alias must be registered under the network NAME — that is the key the
// daemon matches, and keying it by ID is what silently dropped it.
func TestJobNetworkName(t *testing.T) {
	assert.Equal(t, "cronium-job-job_abc123", jobNetworkName("job_abc123"))
}
