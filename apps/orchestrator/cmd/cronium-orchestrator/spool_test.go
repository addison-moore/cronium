package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	cerrors "github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/stretchr/testify/require"
)

func spoolFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func readSpooled(t *testing.T, dir, name string) spooledCompletion {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, name))
	require.NoError(t, err)
	var sp spooledCompletion
	require.NoError(t, json.Unmarshal(data, &sp))
	return sp
}

// A completion the app refuses to accept is written to the spool with the
// job's capability token, and the on-disk form round-trips losslessly.
func TestUndeliverableCompletionIsSpooledToDisk(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.api.setCompleteErr(func(string) error { return errors.New("app down") })
	fx.exec.setFn(func(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
		return preloadedUpdates(
			logUpdate("stdout", "hello"),
			completeUpdate(types.JobStatusCompleted, 0),
		), nil
	})

	fx.core.processJob(context.Background(), testJob("sp-1"))

	files := spoolFiles(t, fx.core.spoolDir)
	require.Len(t, files, 1, "exactly one completion must be spooled")

	sp := readSpooled(t, fx.core.spoolDir, files[0])
	require.Equal(t, "sp-1", sp.JobID)
	require.Equal(t, "cap-sp-1", sp.CapabilityToken, "capability token must be persisted for post-restart retries")
	require.NotEmpty(t, sp.SpooledA)
	require.Equal(t, types.JobStatusCompleted, sp.Complete.Status)
	require.Equal(t, 0, sp.Complete.ExitCode)
	require.Equal(t, "hello\n", sp.Complete.Output.Stdout)

	require.Contains(t, fx.metrics.failures(), "container/complete_api_failed")
	require.True(t, fx.hasLogEntry("Completion spooled for retry"))
	require.Empty(t, fx.api.successfulCompletes())
}

// The retry loop drains the spool once the app recovers: the persisted
// payload is delivered unchanged, under the persisted capability token, and
// the file is removed.
func TestSpoolRetryLoopDrainsWhenAppRecovers(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.spoolRetryInterval = 10 * time.Millisecond

	original := &api.CompleteJobRequest{
		Status:               types.JobStatusCompleted,
		ExitCode:             0,
		Output:               api.Output{Stdout: "spooled out\n", Stderr: "spooled err\n"},
		OutputTruncatedBytes: 42,
		Timestamp:            time.Now().Format(time.RFC3339),
	}
	fx.core.spoolCompletion("sp-2", original, "cap-sp-2")
	require.Len(t, spoolFiles(t, fx.core.spoolDir), 1)

	// Observe which capability token the retry call is decorated with.
	capCh := make(chan string, 8)
	fx.core.withCapability = func(ctx context.Context, token string) context.Context {
		capCh <- token
		return api.WithJobCapability(ctx, token)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go fx.core.spoolRetryLoop(ctx)

	rec := fx.waitComplete(t)
	require.Equal(t, "sp-2", rec.jobID)
	require.Equal(t, original.Status, rec.req.Status)
	require.Equal(t, original.ExitCode, rec.req.ExitCode)
	require.Equal(t, original.Output, rec.req.Output)
	require.Equal(t, original.OutputTruncatedBytes, rec.req.OutputTruncatedBytes)

	select {
	case tok := <-capCh:
		require.Equal(t, "cap-sp-2", tok, "retry must authenticate with the persisted capability token")
	case <-time.After(2 * time.Second):
		t.Fatal("capability decoration never happened")
	}

	require.Eventually(t, func() bool {
		return len(spoolFiles(t, fx.core.spoolDir)) == 0
	}, 2*time.Second, 2*time.Millisecond, "delivered spool file must be removed")
	require.True(t, fx.hasLogEntry("Delivered spooled completion"))
}

// 403 (capability expired => superseded), 404 and 409 (sweeper already
// finalized the job) drop the spooled item; any other error keeps it for the
// next pass.
func TestSpoolDrainDropsSupersededKeepsRetryable(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)

	mk := func(id string) {
		fx.core.spoolCompletion(id, &api.CompleteJobRequest{Status: types.JobStatusCompleted}, "cap-"+id)
	}
	mk("sp-403")
	mk("sp-404")
	mk("sp-409")
	mk("sp-500")
	require.Len(t, spoolFiles(t, fx.core.spoolDir), 4)

	fx.api.setCompleteErr(func(jobID string) error {
		switch jobID {
		case "sp-403":
			return cerrors.NewAPIError(403, "FORBIDDEN", "capability expired")
		case "sp-404":
			return cerrors.NewAPIError(404, "NOT_FOUND", "job gone")
		case "sp-409":
			return cerrors.NewAPIError(409, "CONFLICT", "already finalized")
		default:
			return errors.New("transient network error")
		}
	})

	fx.core.drainSpoolOnce(context.Background())

	files := spoolFiles(t, fx.core.spoolDir)
	require.Len(t, files, 1, "superseded completions must be dropped, retryable ones kept")
	sp := readSpooled(t, fx.core.spoolDir, files[0])
	require.Equal(t, "sp-500", sp.JobID)
	require.True(t, fx.hasLogEntry("Spooled completion superseded; dropping"))
	require.Empty(t, fx.api.successfulCompletes())

	// Next pass with the app healthy delivers the survivor.
	fx.api.setCompleteErr(nil)
	fx.core.drainSpoolOnce(context.Background())
	require.Empty(t, spoolFiles(t, fx.core.spoolDir))
	completes := fx.api.successfulCompletes()
	require.Len(t, completes, 1)
	require.Equal(t, "sp-500", completes[0].jobID)
}

func TestSpoolDrainRemovesUnparseableFiles(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	require.NoError(t, os.WriteFile(filepath.Join(fx.core.spoolDir, "junk.json"), []byte("{not json"), 0o644))

	fx.core.drainSpoolOnce(context.Background())

	require.Empty(t, spoolFiles(t, fx.core.spoolDir))
	require.True(t, fx.hasLogEntry("Removing unparseable spool file"))
	require.Empty(t, fx.api.successfulCompletes(), "junk files must not produce API calls")
}

func TestSpoolDisabledLosesCompletionLoudly(t *testing.T) {
	t.Parallel()
	fx := newCoreFixture(t, nil)
	fx.core.spoolDir = ""

	fx.core.spoolCompletion("lost", &api.CompleteJobRequest{Status: types.JobStatusCompleted}, "cap-lost")
	require.True(t, fx.hasLogEntry("No spool dir; completion lost (sweeper will finalize the job at lease expiry)"))

	// The retry loop is a no-op without a spool dir (returns immediately).
	done := make(chan struct{})
	go func() {
		fx.core.spoolRetryLoop(context.Background())
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("spoolRetryLoop should return immediately when spooling is disabled")
	}
}
