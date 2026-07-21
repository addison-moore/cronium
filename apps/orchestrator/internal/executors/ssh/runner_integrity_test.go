package ssh

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeRunnerFixture(t *testing.T, name, content string) (string, string) {
	t.Helper()
	runnerPath := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(runnerPath, []byte(content), 0o700))
	checksum, err := calculateFileSHA256(runnerPath)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(
		runnerPath+".sha256",
		[]byte(fmt.Sprintf("%s  %s\n", checksum, filepath.Base(runnerPath))),
		0o600,
	))
	return runnerPath, checksum
}

func TestLoadTrustedRunnerChecksum(t *testing.T) {
	t.Run("valid manifest", func(t *testing.T) {
		runnerPath, expected := writeRunnerFixture(t, "runner", "trusted runner")
		actual, err := loadTrustedRunnerChecksum(runnerPath)
		require.NoError(t, err)
		assert.Equal(t, expected, actual)
	})

	t.Run("missing manifest fails closed", func(t *testing.T) {
		runnerPath, _ := writeRunnerFixture(t, "runner", "trusted runner")
		require.NoError(t, os.Remove(runnerPath+".sha256"))
		_, err := loadTrustedRunnerChecksum(runnerPath)
		require.ErrorContains(t, err, "read runner checksum manifest")
	})

	t.Run("manifest mismatch fails closed", func(t *testing.T) {
		runnerPath, _ := writeRunnerFixture(t, "runner", "trusted runner")
		require.NoError(t, os.WriteFile(runnerPath+".sha256", []byte(strings.Repeat("0", 64)), 0o600))
		_, err := loadTrustedRunnerChecksum(runnerPath)
		require.ErrorContains(t, err, "does not match")
	})
}

func TestTrustedRunnerChecksumIsPinned(t *testing.T) {
	runnerPath, firstChecksum := writeRunnerFixture(t, "runner", "first runner")
	executor := &Executor{runnerInfo: RunnerInfo{Path: runnerPath}}

	actual, err := executor.trustedRunnerChecksum()
	require.NoError(t, err)
	assert.Equal(t, firstChecksum, actual)

	require.NoError(t, os.WriteFile(runnerPath, []byte("replacement runner"), 0o700))
	replacementChecksum, err := calculateFileSHA256(runnerPath)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(runnerPath+".sha256", []byte(replacementChecksum), 0o600))

	_, err = executor.trustedRunnerChecksum()
	require.ErrorContains(t, err, "changed after")
}

func TestCachedRunnerIsVerifiedOnEveryHit(t *testing.T) {
	checksum := strings.Repeat("a", 64)
	cache := NewRunnerCache(logrus.New())
	executor := &Executor{
		log:         logrus.New(),
		runnerInfo:  RunnerInfo{Version: "1.2.3"},
		runnerCache: cache,
	}
	cache.Set("server-key", &RunnerCacheEntry{
		ServerID:     "server-1",
		RunnerPath:   "/tmp/runner",
		Version:      "1.2.3",
		Checksum:     checksum,
		DeployedAt:   time.Now(),
		LastVerified: time.Now(),
	})

	verifyCount := 0
	verify := func() error {
		verifyCount++
		return nil
	}
	assert.True(t, executor.verifyCachedRunner("server-key", "/tmp/runner", checksum, verify))
	assert.True(t, executor.verifyCachedRunner("server-key", "/tmp/runner", checksum, verify))
	assert.Equal(t, 2, verifyCount, "a recent LastVerified value must not skip checksum verification")
}

func TestCachedRunnerReplacementInvalidatesEntry(t *testing.T) {
	runnerPath, checksum := writeRunnerFixture(t, "runner", "trusted runner")
	cache := NewRunnerCache(logrus.New())
	executor := &Executor{
		log:         logrus.New(),
		runnerInfo:  RunnerInfo{Version: "1.2.3"},
		runnerCache: cache,
	}
	cache.Set("server-key", &RunnerCacheEntry{
		ServerID:     "server-1",
		RunnerPath:   runnerPath,
		Version:      "1.2.3",
		Checksum:     checksum,
		DeployedAt:   time.Now(),
		LastVerified: time.Now(),
	})

	verifyFile := func() error {
		actual, err := calculateFileSHA256(runnerPath)
		if err != nil {
			return err
		}
		if !equalSHA256(actual, checksum) {
			return fmt.Errorf("replacement detected")
		}
		return nil
	}
	require.True(t, executor.verifyCachedRunner("server-key", runnerPath, checksum, verifyFile))

	require.NoError(t, os.WriteFile(runnerPath, []byte("malicious replacement"), 0o700))
	assert.False(t, executor.verifyCachedRunner("server-key", runnerPath, checksum, verifyFile))
	entry, exists := cache.Get("server-key")
	assert.False(t, exists)
	assert.Nil(t, entry)
}

func TestRunnerRemotePathIsContentAndServerScoped(t *testing.T) {
	checksum := strings.Repeat("b", 64)
	serverA := &types.ServerDetails{ID: "1", Host: "host", Port: 22, Username: "deploy"}
	serverB := &types.ServerDetails{ID: "2", Host: "host", Port: 22, Username: "deploy"}
	serverC := &types.ServerDetails{ID: "1", Host: "host", Port: 22, Username: "other"}

	pathA := runnerRemotePath(serverA, checksum)
	assert.NotEqual(t, pathA, runnerRemotePath(serverB, checksum))
	assert.NotEqual(t, pathA, runnerRemotePath(serverC, checksum))
	assert.Equal(t, "runner-"+checksum, filepath.Base(pathA))
	assert.NotContains(t, pathA, serverA.Host)
	assert.NotContains(t, pathA, serverA.Username)
}

func TestShellQuoteRoundTrip(t *testing.T) {
	value := "path with ' quote; $(touch should-not-run)"
	output, err := exec.Command("sh", "-c", "printf '%s' "+shellQuote(value)).Output()
	require.NoError(t, err)
	assert.Equal(t, value, string(output))
}

func TestRemoteChecksumProgramUsesAbsolutePortableTools(t *testing.T) {
	program := remoteChecksumProgram("/tmp/runner")
	assert.Contains(t, program, "/usr/bin/sha256sum")
	assert.Contains(t, program, "/bin/sha256sum")
	assert.Contains(t, program, "/usr/bin/shasum -a 256")
	assert.NotContains(t, program, "command -v")
}

func TestBuildRunnerCommandVerifiesImmediatelyBeforeExec(t *testing.T) {
	runnerPath, checksum := writeRunnerFixture(t, "runner with ' quote", "#!/bin/sh\nprintf '%s\\n' \"$*\"\n")
	payloadPath := "/tmp/payload with ' quote.tar.gz"
	command := buildRunnerCommand(runnerPath, checksum, payloadPath, false)

	output, err := exec.Command("sh", "-c", command).CombinedOutput()
	require.NoError(t, err, string(output))
	assert.Equal(t, "run "+payloadPath+"\n", string(output))

	// Preserve executable permissions while replacing the cached path. The
	// integrity guard must fail before the malicious script can run.
	require.NoError(t, os.WriteFile(runnerPath, []byte("#!/bin/sh\necho MALICIOUS-RUNNER-RAN\n"), 0o700))
	output, err = exec.Command("sh", "-c", command).CombinedOutput()
	require.Error(t, err)
	exitErr, ok := err.(*exec.ExitError)
	require.True(t, ok)
	assert.Equal(t, runnerIntegrityFailureExitCode, exitErr.ExitCode())
	assert.Contains(t, string(output), "integrity verification failed")
	assert.NotContains(t, string(output), "MALICIOUS-RUNNER-RAN")
}
