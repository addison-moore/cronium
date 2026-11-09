package config

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/kelseyhightower/envconfig"
	"github.com/spf13/viper"
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

func TestImageMapDecode(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  ImageMap
	}{
		{"nothing", "", ImageMap{}},
		{"no tag, which is all that used to work", "bash:myimage", ImageMap{"bash": "myimage"}},
		{"a tag", "bash:myimage:1.2", ImageMap{"bash": "myimage:1.2"}},
		{
			"a registry port and a tag",
			"bash:registry.example:5000/team/runner:1.2",
			ImageMap{"bash": "registry.example:5000/team/runner:1.2"},
		},
		{
			"a digest",
			"bash:myimage@sha256:abc",
			ImageMap{"bash": "myimage@sha256:abc"},
		},
		{
			"all three, with spaces",
			"bash:a:1, python:b:2 ,nodejs:c:3",
			ImageMap{"bash": "a:1", "python": "b:2", "nodejs": "c:3"},
		},
		{"a type in capitals, which is how the types are written elsewhere", "BASH:a:1", ImageMap{"bash": "a:1"}},
		{"a trailing comma", "bash:a:1,", ImageMap{"bash": "a:1"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got ImageMap
			require.NoError(t, got.Decode(c.value))
			assert.Equal(t, c.want, got)
		})
	}

	for _, value := range []string{"myimage", ":myimage", "bash:"} {
		t.Run("refuses "+value, func(t *testing.T) {
			var got ImageMap
			err := got.Decode(value)
			require.Error(t, err)
			assert.Contains(t, err.Error(), value)
		})
	}
}

func TestPublishedImageTag(t *testing.T) {
	for version, want := range map[string]string{
		"v1.2.3":     "1.2.3",
		"v1.2.3-rc1": "1.2.3-rc1",
		"main":       "main",
		"dev":        "latest",
		"":           "latest",
		"latest":     "latest",
		"vnext":      "vnext",
	} {
		assert.Equal(t, want, PublishedImageTag(version), "version %q", version)
	}
}

// loadWithYAML runs the real Load, so what the config file sets has to survive the
// environment being applied after it.
func loadWithYAML(t *testing.T, yaml string) *Config {
	t.Helper()
	viper.Reset()
	t.Cleanup(viper.Reset)
	t.Setenv("CRONIUM_API_ENDPOINT", "http://app:3000")
	t.Setenv("CRONIUM_API_TOKEN", "token")
	path := filepath.Join(t.TempDir(), "cronium-orchestrator.yaml")
	require.NoError(t, os.WriteFile(path, []byte(yaml), 0o600))
	cfg, err := Load(path)
	require.NoError(t, err)
	return cfg
}

func TestImageSettings(t *testing.T) {
	t.Run("nothing set means nothing configured", func(t *testing.T) {
		cfg := loadWithYAML(t, "")

		assert.Empty(t, cfg.Container.Images)
		assert.Empty(t, cfg.Container.Runtime.Image)
	})

	t.Run("the environment", func(t *testing.T) {
		t.Setenv("CRONIUM_CONTAINER_IMAGES", "bash:registry.example:5000/runner:1.2,nodejs:node-runner")
		t.Setenv("CRONIUM_CONTAINER_RUNTIME_IMAGE", "registry.example:5000/runtime:1.2")

		cfg := loadWithYAML(t, "")

		assert.Equal(t, ImageMap{"bash": "registry.example:5000/runner:1.2", "nodejs": "node-runner"}, cfg.Container.Images)
		assert.Equal(t, "registry.example:5000/runtime:1.2", cfg.Container.Runtime.Image)
	})

	t.Run("a bad CRONIUM_CONTAINER_IMAGES still stops it starting, and says why", func(t *testing.T) {
		viper.Reset()
		t.Cleanup(viper.Reset)
		t.Setenv("CRONIUM_API_ENDPOINT", "http://app:3000")
		t.Setenv("CRONIUM_API_TOKEN", "token")
		t.Setenv("CRONIUM_CONTAINER_IMAGES", "just-an-image")

		_, err := Load(filepath.Join(t.TempDir(), "absent.yaml"))

		require.Error(t, err)
	})

	t.Run("a config file", func(t *testing.T) {
		cfg := loadWithYAML(t, `
container:
  images:
    bash: from-file/bash:1
  runtime:
    image: from-file/runtime:1
`)

		assert.Equal(t, "from-file/bash:1", cfg.Container.Images["bash"])
		assert.Equal(t, "from-file/runtime:1", cfg.Container.Runtime.Image)
	})

	// It comes from the build, so that an upgrade always moves it.
	t.Run("the tag can't be set", func(t *testing.T) {
		t.Setenv("CRONIUM_IMAGE_TAG", "from-env")
		t.Setenv("CRONIUM_CONTAINER_IMAGETAG", "from-env")
		t.Setenv("CRONIUM_CONTAINER_IMAGE_TAG", "from-env")

		cfg := loadWithYAML(t, "container:\n  imageTag: from-file\n")

		assert.Empty(t, cfg.Container.ImageTag)
	})

	t.Run("the environment beats a config file", func(t *testing.T) {
		t.Setenv("CRONIUM_CONTAINER_RUNTIME_IMAGE", "from-env/runtime:2")

		cfg := loadWithYAML(t, `
container:
  runtime:
    image: from-file/runtime:1
`)

		assert.Equal(t, "from-env/runtime:2", cfg.Container.Runtime.Image)
	})
}

// Compose only passes along what a service lists, so a file without these has no way to run
// jobs in anything but the default images.
func TestComposeFilesLetYouChooseAJobsImages(t *testing.T) {
	for _, file := range []string{
		"../../../../docker-compose.example.yml",
		"../../../../infra/docker/docker-compose.yml",
	} {
		content, err := os.ReadFile(file)
		require.NoError(t, err)

		assert.Regexp(t, `(?m)^\s+CRONIUM_CONTAINER_IMAGES:\s*$`, string(content), file)
		assert.Regexp(t, `(?m)^\s+CRONIUM_CONTAINER_RUNTIME_IMAGE:\s*$`, string(content), file)
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
		// Read directly, by LoadTimeoutConfig and validateDockerEndpoint.
		"CRONIUM_SETUP_TIMEOUT":                  true,
		"CRONIUM_CLEANUP_TIMEOUT":                true,
		"CRONIUM_MAX_EXECUTION_TIMEOUT":          true,
		"CRONIUM_ALLOW_INSECURE_DOCKER_ENDPOINT": true,
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
