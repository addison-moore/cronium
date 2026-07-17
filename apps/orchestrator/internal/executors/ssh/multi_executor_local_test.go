package ssh

import (
	"context"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// stubLocalExecutor emulates the container executor for the local branch of a
// LOCAL_AND_REMOTE job: emits a log line and a successful completion.
type stubLocalExecutor struct {
	executedJob *types.Job
}

func (s *stubLocalExecutor) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	s.executedJob = job
	updates := make(chan types.ExecutionUpdate, 4)
	exitCode := 0
	updates <- types.ExecutionUpdate{
		Type:      types.UpdateTypeLog,
		Timestamp: time.Now(),
		Data:      &types.LogEntry{Stream: "stdout", Line: "local output"},
	}
	updates <- types.ExecutionUpdate{
		Type:      types.UpdateTypeComplete,
		Timestamp: time.Now(),
		Data: &types.StatusUpdate{
			Status:   types.JobStatusCompleted,
			ExitCode: &exitCode,
		},
	}
	close(updates)
	return updates, nil
}

func TestExecuteLocally(t *testing.T) {
	stub := &stubLocalExecutor{}
	m := &MultiServerExecutor{
		log:           logrus.New(),
		localExecutor: stub,
	}

	job := &types.Job{
		ID:   "job_test_local",
		Type: types.JobTypeSSH,
		Execution: types.ExecutionConfig{
			Target: types.Target{Type: types.TargetTypeServer},
			Script: &types.Script{Type: types.ScriptTypeBash, Content: "echo hi"},
		},
		Metadata: map[string]any{
			"servers":     []interface{}{map[string]interface{}{"id": "6"}},
			"multiServer": true,
			"runLocal":    true,
			"other":       "kept",
		},
	}

	result := m.executeLocally(context.Background(), job)

	// Drain updates so the processing goroutine finishes
	updateCount := 0
	for range result.Updates {
		updateCount++
	}

	if result.ServerID != "local" || result.ServerName != "Local" {
		t.Errorf("expected local identity, got %q/%q", result.ServerID, result.ServerName)
	}
	if result.Status != types.JobStatusCompleted {
		t.Errorf("expected completed status, got %q", result.Status)
	}
	if result.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %d", result.ExitCode)
	}
	if updateCount != 2 {
		t.Errorf("expected 2 forwarded updates, got %d", updateCount)
	}

	// The cloned job must be a plain local container job
	cloned := stub.executedJob
	if cloned == nil {
		t.Fatal("local executor was not invoked")
	}
	if cloned.Type != types.JobTypeContainer {
		t.Errorf("expected container job type, got %q", cloned.Type)
	}
	if cloned.Execution.Target.Type != types.TargetTypeLocal {
		t.Errorf("expected local target, got %q", cloned.Execution.Target.Type)
	}
	if cloned.Execution.Target.ServerDetails != nil {
		t.Error("expected nil server details on local clone")
	}
	for _, key := range []string{"servers", "multiServer", "runLocal", "serverCount"} {
		if _, present := cloned.Metadata[key]; present {
			t.Errorf("expected metadata key %q to be stripped from local clone", key)
		}
	}
	if cloned.Metadata["other"] != "kept" {
		t.Error("expected unrelated metadata to be preserved on local clone")
	}
	// The original job's metadata must be untouched
	if _, present := job.Metadata["runLocal"]; !present {
		t.Error("original job metadata was mutated")
	}
}
