package testsupport

import (
	"context"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
)

// FakeCache is an in-memory implementation of service.Cache (asserted in the
// service tests) so RuntimeService can be exercised without a live Valkey.
// The zero value is not usable; construct with NewFakeCache.
type FakeCache struct {
	mu        sync.Mutex
	inputs    map[string]*types.InputData
	outputs   map[string]*types.OutputData
	variables map[string]*types.Variable
	contexts  map[string]*types.ExecutionContext
	locks     map[string]bool

	// RevokedJobs marks job IDs whose execution tokens are revoked.
	RevokedJobs map[string]bool

	// Failure knobs. When set, the corresponding operations return the error.
	GetErr     error // all Get* reads
	SetErr     error // all Set* writes
	RevokedErr error // IsJobRevoked
	LockDenied bool  // Lock returns false (held elsewhere)
}

// NewFakeCache returns an empty in-memory cache.
func NewFakeCache() *FakeCache {
	return &FakeCache{
		inputs:      make(map[string]*types.InputData),
		outputs:     make(map[string]*types.OutputData),
		variables:   make(map[string]*types.Variable),
		contexts:    make(map[string]*types.ExecutionContext),
		locks:       make(map[string]bool),
		RevokedJobs: make(map[string]bool),
	}
}

func varKey(executionID, key string) string { return executionID + "\x00" + key }

// GetInput implements service.Cache.
func (f *FakeCache) GetInput(_ context.Context, executionID string) (*types.InputData, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.GetErr != nil {
		return nil, f.GetErr
	}
	return f.inputs[executionID], nil
}

// SetInput implements service.Cache.
func (f *FakeCache) SetInput(_ context.Context, executionID string, input *types.InputData) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SetErr != nil {
		return f.SetErr
	}
	f.inputs[executionID] = input
	return nil
}

// SetOutput implements service.Cache.
func (f *FakeCache) SetOutput(_ context.Context, executionID string, output *types.OutputData) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SetErr != nil {
		return f.SetErr
	}
	f.outputs[executionID] = output
	return nil
}

// Output returns the cached output for an execution (test inspection).
func (f *FakeCache) Output(executionID string) *types.OutputData {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.outputs[executionID]
}

// GetVariable implements service.Cache.
func (f *FakeCache) GetVariable(_ context.Context, executionID, key string) (*types.Variable, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.GetErr != nil {
		return nil, f.GetErr
	}
	return f.variables[varKey(executionID, key)], nil
}

// SetVariable implements service.Cache.
func (f *FakeCache) SetVariable(_ context.Context, executionID, key string, variable *types.Variable) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SetErr != nil {
		return f.SetErr
	}
	f.variables[varKey(executionID, key)] = variable
	return nil
}

// GetContext implements service.Cache.
func (f *FakeCache) GetContext(_ context.Context, executionID string) (*types.ExecutionContext, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.GetErr != nil {
		return nil, f.GetErr
	}
	return f.contexts[executionID], nil
}

// SetContext implements service.Cache.
func (f *FakeCache) SetContext(_ context.Context, executionID string, execContext *types.ExecutionContext) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SetErr != nil {
		return f.SetErr
	}
	f.contexts[executionID] = execContext
	return nil
}

// IsJobRevoked implements service.Cache.
func (f *FakeCache) IsJobRevoked(_ context.Context, jobID string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.RevokedErr != nil {
		return false, f.RevokedErr
	}
	return f.RevokedJobs[jobID], nil
}

// Lock implements service.Cache.
func (f *FakeCache) Lock(_ context.Context, key string, _ time.Duration) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.LockDenied || f.locks[key] {
		return false, nil
	}
	f.locks[key] = true
	return true, nil
}

// Unlock implements service.Cache.
func (f *FakeCache) Unlock(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.locks, key)
	return nil
}
