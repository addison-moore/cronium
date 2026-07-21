package ssh

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func runShellCommand(t *testing.T, command, input string) ([]byte, error) {
	t.Helper()
	cmd := exec.Command("sh", "-c", command)
	cmd.Stdin = strings.NewReader(input)
	return cmd.CombinedOutput()
}

func TestRemotePayloadLocationsAreRandomAndPrivate(t *testing.T) {
	const locationCount = 512
	locations := make(chan remotePayloadLocation, locationCount)
	errors := make(chan error, locationCount)

	var waitGroup sync.WaitGroup
	for range locationCount {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			location, err := newRemotePayloadLocation()
			if err != nil {
				errors <- err
				return
			}
			locations <- location
		}()
	}
	waitGroup.Wait()
	close(locations)
	close(errors)

	for err := range errors {
		require.NoError(t, err)
	}

	seen := make(map[string]struct{}, locationCount)
	for location := range locations {
		require.NoError(t, validateRemotePayloadDirectory(location.Directory))
		assert.Equal(t, filepath.Join(location.Directory, "payload.tar.gz"), location.PayloadPath)
		assert.Equal(t, location.PayloadPath+".sig", location.SignaturePath)
		_, duplicate := seen[location.Directory]
		assert.False(t, duplicate)
		seen[location.Directory] = struct{}{}
	}
	assert.Len(t, seen, locationCount)
}

func TestCreateRemotePayloadDirectoryCommandIsExclusiveAndQuoted(t *testing.T) {
	parent := t.TempDir()
	directory := filepath.Join(parent, "payload ' private")
	command := buildCreateRemotePayloadDirectoryCommand(directory)

	output, err := runShellCommand(t, command, "")
	require.NoError(t, err, string(output))
	info, err := os.Lstat(directory)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
	assert.Equal(t, os.FileMode(0o700), info.Mode().Perm())

	// mkdir without -p is the exclusive allocation step.
	_, err = runShellCommand(t, command, "")
	require.Error(t, err)

	symlinkPath := filepath.Join(parent, "payload symlink")
	require.NoError(t, os.Symlink(directory, symlinkPath))
	_, err = runShellCommand(t, buildCreateRemotePayloadDirectoryCommand(symlinkPath), "")
	require.Error(t, err)
}

func TestExclusiveUploadStagesWithoutClobbering(t *testing.T) {
	remotePath := filepath.Join(t.TempDir(), "payload ' upload")
	command := buildExclusiveUploadCommand(remotePath)

	output, err := runShellCommand(t, command, "first payload")
	require.NoError(t, err, string(output))
	data, err := os.ReadFile(remotePath)
	require.NoError(t, err)
	assert.Equal(t, "first payload", string(data))
	info, err := os.Stat(remotePath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	_, err = runShellCommand(t, command, "attacker replacement")
	require.Error(t, err)
	data, err = os.ReadFile(remotePath)
	require.NoError(t, err)
	assert.Equal(t, "first payload", string(data))
}

func TestPublishPayloadFileIsAtomicAndExclusive(t *testing.T) {
	directory := t.TempDir()
	finalPath := filepath.Join(directory, "payload.tar.gz")
	uploadA := filepath.Join(directory, "upload-a")
	uploadB := filepath.Join(directory, "upload-b")
	require.NoError(t, os.WriteFile(uploadA, []byte("payload A"), 0o600))
	require.NoError(t, os.WriteFile(uploadB, []byte("payload B"), 0o600))

	// Staging does not expose a partial final payload.
	_, err := os.Stat(finalPath)
	require.ErrorIs(t, err, os.ErrNotExist)

	start := make(chan struct{})
	results := make(chan error, 2)
	for _, uploadPath := range []string{uploadA, uploadB} {
		go func(path string) {
			<-start
			_, commandErr := runShellCommand(t, buildPublishPayloadFileCommand(path, finalPath), "")
			results <- commandErr
		}(uploadPath)
	}
	close(start)

	successes := 0
	for range 2 {
		if err := <-results; err == nil {
			successes++
		}
	}
	assert.Equal(t, 1, successes, "atomic link publication must have exactly one winner")

	data, err := os.ReadFile(finalPath)
	require.NoError(t, err)
	assert.Contains(t, []string{"payload A", "payload B"}, string(data))
	info, err := os.Lstat(finalPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	assert.Zero(t, info.Mode()&os.ModeSymlink)
}

func TestPublishPayloadRejectsSymlinkUpload(t *testing.T) {
	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "source")
	uploadPath := filepath.Join(directory, "upload")
	finalPath := filepath.Join(directory, "payload.tar.gz")
	require.NoError(t, os.WriteFile(sourcePath, []byte("secret"), 0o600))
	require.NoError(t, os.Symlink(sourcePath, uploadPath))

	_, err := runShellCommand(t, buildPublishPayloadFileCommand(uploadPath, finalPath), "")
	require.Error(t, err)
	_, err = os.Stat(finalPath)
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestCleanupPayloadDirectoryValidatesAndRemovesOnlyExactDirectory(t *testing.T) {
	location, err := newRemotePayloadLocation()
	require.NoError(t, err)
	neighbor := location.Directory + "-neighbor"
	t.Cleanup(func() {
		_ = os.RemoveAll(location.Directory)
		_ = os.RemoveAll(neighbor)
	})

	require.NoError(t, os.Mkdir(location.Directory, 0o700))
	require.NoError(t, os.WriteFile(location.PayloadPath, []byte("secret"), 0o600))
	require.NoError(t, os.Mkdir(neighbor, 0o700))

	command, err := buildCleanupRemotePayloadDirectoryCommand(location.Directory)
	require.NoError(t, err)
	output, err := runShellCommand(t, command, "")
	require.NoError(t, err, string(output))
	_, err = os.Stat(location.Directory)
	require.ErrorIs(t, err, os.ErrNotExist)
	_, err = os.Stat(neighbor)
	require.NoError(t, err)

	// Cleanup is idempotent but refuses broad or injected targets.
	_, err = runShellCommand(t, command, "")
	require.NoError(t, err)
	for _, invalid := range []string{
		"/",
		"/tmp",
		"/tmp/.cronium-payload-not-random",
		"/tmp/.cronium-payload-00000000000000000000000000000000/child",
		"/tmp/.cronium-payload-00000000000000000000000000000000; touch /tmp/pwned",
	} {
		_, err := buildCleanupRemotePayloadDirectoryCommand(invalid)
		require.Error(t, err)
	}
}

func TestShellExportQuotesUntrustedJobIdentifiers(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "injection-marker")
	jobID := "job'; touch " + marker + "; #"
	command := shellExport("CRONIUM_JOB_ID", jobID) + " && printf '%s' \"$CRONIUM_JOB_ID\""

	output, err := runShellCommand(t, command, "")
	require.NoError(t, err)
	assert.Equal(t, jobID, string(output))
	_, err = os.Stat(marker)
	require.ErrorIs(t, err, os.ErrNotExist)
}
