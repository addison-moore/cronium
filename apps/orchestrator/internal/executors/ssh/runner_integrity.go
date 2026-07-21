package ssh

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"golang.org/x/crypto/ssh"
)

const runnerIntegrityFailureExitCode = 125

// loadTrustedRunnerChecksum verifies the runner artifact against the checksum
// manifest shipped beside it. The manifest is the local trust anchor; a runner
// that is missing it or does not match it must never be deployed.
func loadTrustedRunnerChecksum(runnerPath string) (string, error) {
	actual, err := calculateFileSHA256(runnerPath)
	if err != nil {
		return "", fmt.Errorf("calculate runner checksum: %w", err)
	}

	manifest, err := os.ReadFile(runnerPath + ".sha256")
	if err != nil {
		return "", fmt.Errorf("read runner checksum manifest: %w", err)
	}
	fields := strings.Fields(string(manifest))
	if len(fields) == 0 {
		return "", fmt.Errorf("runner checksum manifest is empty")
	}

	expected, err := normalizeSHA256(fields[0])
	if err != nil {
		return "", fmt.Errorf("invalid runner checksum manifest: %w", err)
	}
	if !equalSHA256(actual, expected) {
		return "", fmt.Errorf("runner artifact does not match its checksum manifest")
	}

	return expected, nil
}

func calculateFileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func normalizeSHA256(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return "", fmt.Errorf("expected a 64-character SHA-256 digest")
	}
	return value, nil
}

func equalSHA256(left, right string) bool {
	leftBytes, leftErr := hex.DecodeString(left)
	rightBytes, rightErr := hex.DecodeString(right)
	if leftErr != nil || rightErr != nil || len(leftBytes) != sha256.Size || len(rightBytes) != sha256.Size {
		return false
	}
	return subtle.ConstantTimeCompare(leftBytes, rightBytes) == 1
}

// trustedRunnerChecksum revalidates the local artifact and pins its digest for
// the lifetime of the executor. This prevents a writable local artifact and
// manifest from silently changing after startup.
func (e *Executor) trustedRunnerChecksum() (string, error) {
	current, err := loadTrustedRunnerChecksum(e.runnerInfo.Path)
	if err != nil {
		return "", err
	}

	e.runnerInfoMu.Lock()
	defer e.runnerInfoMu.Unlock()

	if e.runnerInfo.Checksum == "" {
		e.runnerInfo.Checksum = current
	} else if !equalSHA256(e.runnerInfo.Checksum, current) {
		return "", fmt.Errorf("local runner artifact changed after its checksum was pinned")
	}
	return e.runnerInfo.Checksum, nil
}

// runnerIdentity scopes runner metadata and the remote install path to the
// configured server and remote OS user without exposing those values in /tmp.
func runnerIdentity(server *types.ServerDetails) string {
	identity := strings.Join([]string{
		server.ID,
		server.Host,
		strconv.Itoa(server.Port),
		server.Username,
	}, "\x00")
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func runnerCacheKey(server *types.ServerDetails) string {
	return runnerIdentity(server)
}

func runnerRemotePath(server *types.ServerDetails, checksum string) string {
	// The direct child of /tmp avoids a shared, attacker-precreated parent.
	// The directory is revalidated as a real directory and forced to 0700.
	scope := runnerIdentity(server)[:32]
	return filepath.Join("/tmp", ".cronium-runner-"+scope, "runner-"+checksum)
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func shellExport(name, value string) string {
	// Names are compile-time constants at all call sites; values are always
	// quoted so job IDs, endpoints, and tokens cannot become shell syntax.
	return "export " + name + "=" + shellQuote(value)
}

// remoteChecksumProgram emits one checksum line. Absolute system paths prevent
// a same-user PATH override from impersonating the checksum tool. Linux
// sha256sum is preferred; shasum supports systems where coreutils is absent.
// Missing tools fail closed.
func remoteChecksumProgram(path string) string {
	quotedPath := shellQuote(path)
	return fmt.Sprintf(
		"if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum %s; elif [ -x /bin/sha256sum ]; then /bin/sha256sum %s; elif [ -x /usr/bin/shasum ]; then /usr/bin/shasum -a 256 %s; elif [ -x /bin/shasum ]; then /bin/shasum -a 256 %s; else exit 127; fi",
		quotedPath,
		quotedPath,
		quotedPath,
		quotedPath,
	)
}

func verifyChecksumOutput(output []byte, expected string) error {
	fields := strings.Fields(string(output))
	if len(fields) == 0 {
		return fmt.Errorf("remote checksum command returned no digest")
	}
	actual, err := normalizeSHA256(fields[0])
	if err != nil {
		return fmt.Errorf("remote checksum command returned an invalid digest: %w", err)
	}
	if !equalSHA256(actual, expected) {
		return fmt.Errorf("remote runner checksum mismatch")
	}
	return nil
}

// verifyRemoteRunner hashes the file without executing it.
func verifyRemoteRunner(conn *ssh.Client, runnerPath, expectedChecksum string) error {
	session, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("create runner verification session: %w", err)
	}
	defer session.Close()

	quotedPath := shellQuote(runnerPath)
	command := fmt.Sprintf(
		"test -f %s && test ! -L %s && test -x %s && { %s; }",
		quotedPath,
		quotedPath,
		quotedPath,
		remoteChecksumProgram(runnerPath),
	)
	output, err := session.Output(command)
	if err != nil {
		return fmt.Errorf("hash remote runner: %w", err)
	}
	return verifyChecksumOutput(output, expectedChecksum)
}

// verifyCachedRunner treats cache entries only as location hints. The supplied
// verifier is invoked for every hit, regardless of LastVerified.
func (e *Executor) verifyCachedRunner(cacheKey, runnerPath, checksum string, verify func() error) bool {
	entry, exists := e.runnerCache.Get(cacheKey)
	if !exists {
		return false
	}
	if entry.RunnerPath != runnerPath || entry.Version != e.runnerInfo.Version || !equalSHA256(entry.Checksum, checksum) {
		e.runnerCache.Remove(cacheKey)
		return false
	}
	if err := verify(); err != nil {
		e.runnerCache.Remove(cacheKey)
		e.log.WithError(err).WithField("serverID", entry.ServerID).Warn("Cached SSH runner failed integrity verification")
		return false
	}

	e.runnerCache.UpdateVerified(cacheKey)
	return true
}

func randomRunnerUploadPath(runnerPath string) (string, error) {
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate runner upload path: %w", err)
	}
	return runnerPath + ".upload-" + hex.EncodeToString(randomBytes), nil
}

// buildRunnerCommand verifies the runner immediately before exec. Exit 125 is
// reserved for integrity failures so the caller can invalidate its cache.
func buildRunnerCommand(runnerPath, checksum, payloadPath string, debug bool) string {
	checksumProgram := remoteChecksumProgram(runnerPath)
	guard := fmt.Sprintf(
		"runner_checksum=$({ %s; }) && set -- $runner_checksum && [ \"$1\" = %s ]",
		checksumProgram,
		shellQuote(checksum),
	)

	arguments := "run " + shellQuote(payloadPath)
	if debug {
		arguments = "--log-level=debug " + arguments
	}
	return fmt.Sprintf(
		"%s || { echo 'Cronium runner integrity verification failed' >&2; exit %d; }; exec %s %s",
		guard,
		runnerIntegrityFailureExitCode,
		shellQuote(runnerPath),
		arguments,
	)
}
