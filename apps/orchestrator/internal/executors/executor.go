package executors

import (
	"context"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// Executor defines the interface for job execution
type Executor interface {
	// Execute runs a job and returns a channel for real-time updates
	Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error)

	// Validate checks if the job can be executed by this executor
	Validate(job *types.Job) error

	// Cleanup performs any necessary cleanup after execution
	Cleanup(ctx context.Context, job *types.Job) error

	// Type returns the executor type
	Type() types.JobType
}

// Manager manages multiple executors
type Manager struct {
	executors          map[types.JobType]Executor
	unavailableReasons map[types.JobType]string
}

// NewManager creates a new executor manager
func NewManager() *Manager {
	return &Manager{
		executors:          make(map[types.JobType]Executor),
		unavailableReasons: make(map[types.JobType]string),
	}
}

// Register adds an executor for a specific job type
func (m *Manager) Register(jobType types.JobType, executor Executor) {
	m.executors[jobType] = executor
	delete(m.unavailableReasons, jobType)
}

// MarkUnavailable preserves a fail-closed reason for a known job type without
// registering an executor that could run it.
func (m *Manager) MarkUnavailable(jobType types.JobType, reason string) {
	delete(m.executors, jobType)
	m.unavailableReasons[jobType] = reason
}

// GetExecutor returns the executor for a specific job type
func (m *Manager) GetExecutor(jobType types.JobType) (Executor, bool) {
	executor, ok := m.executors[jobType]
	return executor, ok
}

// Execute runs a job using the appropriate executor
func (m *Manager) Execute(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	// Log job type for debugging
	logrus.WithFields(logrus.Fields{
		"jobID":                job.ID,
		"jobType":              job.Type,
		"hasSSHExecutor":       m.executors[types.JobType("ssh")] != nil,
		"hasContainerExecutor": m.executors[types.JobType("container")] != nil,
	}).Debug("Selecting executor for job")

	executor, ok := m.GetExecutor(job.Type)
	if !ok {
		if reason, configured := m.unavailableReasons[job.Type]; configured {
			return nil, types.NewExecutionError(
				"isolation_required",
				"SSH_ISOLATION_REQUIRED",
				reason,
				false,
			)
		}
		return nil, types.NewExecutionError(
			"unsupported",
			"UNSUPPORTED_JOB_TYPE",
			"No executor available for job type: "+string(job.Type),
			false,
		)
	}

	// Validate the job
	if err := executor.Validate(job); err != nil {
		return nil, err
	}

	// Execute the job
	return executor.Execute(ctx, job)
}
