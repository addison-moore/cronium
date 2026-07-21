package executors

import (
	"context"
	"errors"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
)

func TestUnavailableSSHExecutorFailsWithIsolationError(t *testing.T) {
	manager := NewManager()
	manager.MarkUnavailable(types.JobTypeSSH, "per-job isolation is required")

	_, err := manager.Execute(context.Background(), &types.Job{
		ID:   "job-1",
		Type: types.JobTypeSSH,
	})
	var executionError *types.ExecutionError
	if !errors.As(err, &executionError) {
		t.Fatalf("expected an execution error, got %v", err)
	}
	if executionError.Code != "SSH_ISOLATION_REQUIRED" {
		t.Fatalf("unexpected error code %q", executionError.Code)
	}
	if executionError.Retryable {
		t.Fatal("isolation configuration failures must not be retried")
	}
}
