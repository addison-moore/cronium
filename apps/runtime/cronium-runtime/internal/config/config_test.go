package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// repoConfigYAML points CONFIG_FILE at the module's shipped config.yaml (the
// file baked into the runtime image), so these tests exercise exactly what a
// container boot loads.
func repoConfigYAML(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs(filepath.Join("..", "..", "config.yaml"))
	if err != nil {
		t.Fatalf("resolving config.yaml: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("shipped config.yaml must exist: %v", err)
	}
	return path
}

// unsetenv guarantees a variable is UNSET for the test while still restoring
// any ambient value afterwards (t.Setenv registers the restore).
func unsetenv(t *testing.T, key string) {
	t.Helper()
	t.Setenv(key, "placeholder")
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unsetenv %s: %v", key, err)
	}
}

// TestLoadFailsLoudlyWithoutJWTSecret pins the FINDINGS #39 hardening: the
// shipped config.yaml no longer carries a literal "${JWT_SECRET}" placeholder
// (the yaml loader does no env expansion, so that literal used to satisfy
// Validate() as a garbage secret). With no secret in the environment, Load()
// must now fail loudly instead of booting with "${JWT_SECRET}" as the secret.
func TestLoadFailsLoudlyWithoutJWTSecret(t *testing.T) {
	t.Setenv("CONFIG_FILE", repoConfigYAML(t))
	unsetenv(t, "RUNTIME_JWT_SECRET")
	unsetenv(t, "JWT_SECRET")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() must fail when no environment variable supplies the JWT secret")
	}
	if !strings.Contains(err.Error(), "JWT secret is required") {
		t.Errorf("error = %q, want the explicit JWT-secret validation message", err)
	}
}

// TestShippedConfigHasNoLiteralPlaceholderSecret guards the config.yaml
// decision itself: no jwtSecret key (and in particular no unexpanded
// "${...}" placeholder) may reappear in the shipped file.
func TestShippedConfigHasNoLiteralPlaceholderSecret(t *testing.T) {
	raw, err := os.ReadFile(repoConfigYAML(t))
	if err != nil {
		t.Fatalf("reading config.yaml: %v", err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(trimmed, "jwtSecret") {
			t.Errorf("config.yaml must not set jwtSecret (env-only contract), found: %q", line)
		}
		if strings.Contains(trimmed, "${") {
			t.Errorf("config.yaml must not contain ${...} placeholders (the yaml loader does no env expansion), found: %q", line)
		}
	}
}

func TestLoadReadsCanonicalRuntimeJWTSecret(t *testing.T) {
	t.Setenv("CONFIG_FILE", repoConfigYAML(t))
	unsetenv(t, "JWT_SECRET")
	t.Setenv("RUNTIME_JWT_SECRET", "canonical-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load(): %v", err)
	}
	if cfg.Auth.JWTSecret != "canonical-secret" {
		t.Errorf("JWTSecret = %q, want the RUNTIME_JWT_SECRET value", cfg.Auth.JWTSecret)
	}
}

// The legacy bare JWT_SECRET (the name the orchestrator sidecar has always
// passed, resolved via envconfig's alt-name fallback) must keep working for
// image-skew compatibility.
func TestLoadReadsLegacyBareJWTSecret(t *testing.T) {
	t.Setenv("CONFIG_FILE", repoConfigYAML(t))
	unsetenv(t, "RUNTIME_JWT_SECRET")
	t.Setenv("JWT_SECRET", "legacy-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load(): %v", err)
	}
	if cfg.Auth.JWTSecret != "legacy-secret" {
		t.Errorf("JWTSecret = %q, want the bare JWT_SECRET value", cfg.Auth.JWTSecret)
	}
}

// When both names are set, the canonical RUNTIME_-prefixed one wins.
func TestLoadCanonicalSecretWinsOverLegacy(t *testing.T) {
	t.Setenv("CONFIG_FILE", repoConfigYAML(t))
	t.Setenv("JWT_SECRET", "legacy-secret")
	t.Setenv("RUNTIME_JWT_SECRET", "canonical-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load(): %v", err)
	}
	if cfg.Auth.JWTSecret != "canonical-secret" {
		t.Errorf("JWTSecret = %q, want RUNTIME_JWT_SECRET to take precedence", cfg.Auth.JWTSecret)
	}
}
