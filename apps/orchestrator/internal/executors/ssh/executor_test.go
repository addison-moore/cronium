package ssh

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockSSHServer simulates an SSH server for testing
type MockSSHServer struct {
	// Add fields as needed
}

func TestExecutor_DeploymentRetry(t *testing.T) {
	// Skip if not in CI environment or no test SSH server
	if os.Getenv("CI") == "" && os.Getenv("TEST_SSH_SERVER") == "" {
		t.Skip("Skipping SSH integration test - set TEST_SSH_SERVER to run")
	}

	cfg := config.SSHConfig{
		ConnectionPool: config.ConnectionPoolConfig{
			MaxConnections:     10,
			ConnectionTimeout:  30,
			IdleTimeout:        300,
			MaxIdleConnections: 5,
		},
	}

	log := logrus.New()
	log.SetLevel(logrus.DebugLevel)

	executor, err := NewExecutor(cfg, 0, "", log)
	require.NoError(t, err)

	// Test deployment retry logic
	ctx := context.Background()
	
	// Create a test job
	job := &types.Job{
		ID:   "test-job-1",
		Type: "ssh",
		Execution: types.ExecutionConfig{
			Timeout: 60,
			Target: types.ExecutionTarget{
				Type: "server",
				ServerDetails: &types.ServerDetails{
					ID:         "test-server",
					Host:       os.Getenv("TEST_SSH_HOST"),
					Port:       22,
					Username:   os.Getenv("TEST_SSH_USER"),
					PrivateKey: os.Getenv("TEST_SSH_KEY"),
				},
			},
		},
		Metadata: map[string]interface{}{
			"payloadPath": "/tmp/test-payload.tar.gz",
		},
	}

	// Create a mock payload file
	err = os.WriteFile("/tmp/test-payload.tar.gz", []byte("test payload"), 0644)
	require.NoError(t, err)
	defer os.Remove("/tmp/test-payload.tar.gz")

	// Execute should handle deployment retries
	updates, err := executor.Execute(ctx, job)
	assert.NoError(t, err)
	assert.NotNil(t, updates)

	// Collect updates
	var execUpdates []types.ExecutionUpdate
	for update := range updates {
		execUpdates = append(execUpdates, update)
	}

	// Verify we got status updates
	assert.Greater(t, len(execUpdates), 0)
}

func TestExecutor_Timeout(t *testing.T) {
	cfg := config.SSHConfig{
		ConnectionPool: config.ConnectionPoolConfig{
			MaxConnections:     10,
			ConnectionTimeout:  30,
			IdleTimeout:        300,
			MaxIdleConnections: 5,
		},
	}

	log := logrus.New()
	executor, err := NewExecutor(cfg, 0, "", log)
	require.NoError(t, err)

	// Create a job with very short timeout
	job := &types.Job{
		ID:   "test-timeout",
		Type: "ssh",
		Execution: types.ExecutionConfig{
			Timeout: 1, // 1 second timeout
			Target: types.ExecutionTarget{
				Type: "server",
				ServerDetails: &types.ServerDetails{
					ID:         "test-server",
					Host:       "localhost",
					Port:       22,
					Username:   "test",
					PrivateKey: "test-key",
				},
			},
			Script: &types.ScriptConfig{
				Type:    "bash",
				Content: "sleep 10", // This will timeout
			},
		},
		Metadata: map[string]interface{}{
			"payloadPath": "/tmp/test-payload.tar.gz",
		},
	}

	ctx := context.Background()
	updates, err := executor.Execute(ctx, job)
	assert.NoError(t, err)

	// Look for timeout error
	var timedOut bool
	for update := range updates {
		if update.Type == types.UpdateTypeError {
			if statusUpdate, ok := update.Data.(*types.StatusUpdate); ok {
				if statusUpdate.Message != "" && 
				   (contains(statusUpdate.Message, "timed out") || 
				    contains(statusUpdate.Message, "timeout")) {
					timedOut = true
				}
			}
		}
	}

	assert.True(t, timedOut, "Expected timeout error")
}

func TestExecutor_Cleanup(t *testing.T) {
	cfg := config.SSHConfig{
		ConnectionPool: config.ConnectionPoolConfig{
			MaxConnections:     10,
			ConnectionTimeout:  30,
			IdleTimeout:        300,
			MaxIdleConnections: 5,
		},
	}

	log := logrus.New()
	executor, err := NewExecutor(cfg, 0, "", log)
	require.NoError(t, err)

	job := &types.Job{
		ID:   "test-cleanup",
		Type: "ssh",
		Execution: types.ExecutionConfig{
			Target: types.ExecutionTarget{
				Type: "server",
				ServerDetails: &types.ServerDetails{
					ID:         "test-server",
					Host:       "localhost",
					Port:       22,
					Username:   "test",
					PrivateKey: "test-key",
				},
			},
		},
	}

	// Track a fake session
	executor.trackSession(job.ID, &Session{
		jobID:      job.ID,
		cancelFunc: func() {},
	})

	// Verify session is tracked
	executor.mu.RLock()
	_, exists := executor.sessions[job.ID]
	executor.mu.RUnlock()
	assert.True(t, exists)

	// Cleanup should remove the session
	err = executor.Cleanup(context.Background(), job)
	assert.NoError(t, err)

	// Verify session is removed
	executor.mu.RLock()
	_, exists = executor.sessions[job.ID]
	executor.mu.RUnlock()
	assert.False(t, exists)
}

func TestExecutor_Metrics(t *testing.T) {
	cfg := config.SSHConfig{
		ConnectionPool: config.ConnectionPoolConfig{
			MaxConnections:     10,
			ConnectionTimeout:  30,
			IdleTimeout:        300,
			MaxIdleConnections: 5,
		},
	}

	log := logrus.New()
	executor, err := NewExecutor(cfg, 0, "", log)
	require.NoError(t, err)

	// Record some metrics
	executor.metrics.RecordExecution("job1", true, 100*time.Millisecond, false)
	executor.metrics.RecordExecution("job2", false, 200*time.Millisecond, true)
	executor.metrics.RecordDeployment("server1", true, false, 50*time.Millisecond)
	executor.metrics.RecordDeployment("server2", true, true, 5*time.Millisecond)

	// Get stats
	stats := executor.metrics.GetStats()
	
	execStats := stats["executions"].(map[string]interface{})
	assert.Equal(t, int64(2), execStats["total"])
	assert.Equal(t, int64(1), execStats["successful"])
	assert.Equal(t, int64(1), execStats["failed"])
	assert.Equal(t, int64(1), execStats["timedOut"])

	deployStats := stats["deployments"].(map[string]interface{})
	assert.Equal(t, int64(2), deployStats["total"])
	assert.Equal(t, int64(2), deployStats["successful"])
	assert.Equal(t, int64(1), deployStats["cached"])
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && (s[0:len(substr)] == substr || contains(s[1:], substr)))
}

func TestRunnerCache(t *testing.T) {
	log := logrus.New()
	cache := NewRunnerCache(log)

	// Test set and get
	entry := &RunnerCacheEntry{
		ServerID:     "server1",
		RunnerPath:   "/tmp/runner",
		Version:      "1.0.0",
		Checksum:     "abc123",
		DeployedAt:   time.Now(),
		LastVerified: time.Now(),
	}

	cache.Set("server1", entry)

	// Get valid entry
	cached, valid := cache.Get("server1")
	assert.True(t, valid)
	assert.Equal(t, entry.Version, cached.Version)

	// Test expiration
	entry.DeployedAt = time.Now().Add(-25 * time.Hour)
	cache.Set("server2", entry)
	
	cached, valid = cache.Get("server2")
	assert.False(t, valid)
	assert.Nil(t, cached)

	// Test remove
	cache.Remove("server1")
	cached, valid = cache.Get("server1")
	assert.False(t, valid)
	assert.Nil(t, cached)
}

// TestMultiServerExecution tests parallel execution on multiple servers
func TestMultiServerExecution(t *testing.T) {
	// This test would require actual SSH servers or mocks
	// For now, we'll create a basic structure test
	
	cfg := config.SSHConfig{
		ConnectionPool: config.ConnectionPoolConfig{
			MaxConnections:     10,
			ConnectionTimeout:  30,
			IdleTimeout:        300,
			MaxIdleConnections: 5,
		},
	}

	log := logrus.New()
	executor, err := NewExecutor(cfg, 0, "", log)
	require.NoError(t, err)

	multiExecutor, err := NewMultiServerExecutor(cfg, 0, "", log)
	require.NoError(t, err)

	// Verify the multi-executor wraps the single executor
	assert.NotNil(t, multiExecutor.executor)
	assert.Equal(t, executor.Type(), multiExecutor.Type())
}

// Helper function to create test server details
func createTestServer(id, host string) *types.ServerDetails {
	return &types.ServerDetails{
		ID:         id,
		Host:       host,
		Port:       22,
		Username:   "test",
		PrivateKey: "test-key",
	}
}