package ssh

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"
)

// ExecutorMetrics tracks SSH executor performance metrics
type ExecutorMetrics struct {
	totalExecutions      int64
	successfulExecutions int64
	failedExecutions     int64
	timeoutExecutions    int64

	totalDeployments      int64
	successfulDeployments int64
	failedDeployments     int64
	cachedDeployments     int64

	executionDurations  sync.Map // map[string]time.Duration
	deploymentDurations sync.Map // map[string]time.Duration

	log *logrus.Entry
}

// NewExecutorMetrics creates new metrics tracker
func NewExecutorMetrics(log *logrus.Entry) *ExecutorMetrics {
	return &ExecutorMetrics{
		log: log.WithField("component", "ssh-metrics"),
	}
}

// RecordExecution records an execution attempt
func (m *ExecutorMetrics) RecordExecution(jobID string, success bool, duration time.Duration, timedOut bool) {
	atomic.AddInt64(&m.totalExecutions, 1)

	if success {
		atomic.AddInt64(&m.successfulExecutions, 1)
	} else {
		atomic.AddInt64(&m.failedExecutions, 1)
		if timedOut {
			atomic.AddInt64(&m.timeoutExecutions, 1)
		}
	}

	m.executionDurations.Store(jobID, duration)

	// Log metrics periodically (every 10 executions)
	if atomic.LoadInt64(&m.totalExecutions)%10 == 0 {
		m.logMetrics()
	}
}

// RecordDeployment records a deployment attempt
func (m *ExecutorMetrics) RecordDeployment(serverID string, success bool, cached bool, duration time.Duration) {
	atomic.AddInt64(&m.totalDeployments, 1)

	if cached {
		atomic.AddInt64(&m.cachedDeployments, 1)
		return
	}

	if success {
		atomic.AddInt64(&m.successfulDeployments, 1)
	} else {
		atomic.AddInt64(&m.failedDeployments, 1)
	}

	m.deploymentDurations.Store(serverID, duration)
}

// GetStats returns current metrics
func (m *ExecutorMetrics) GetStats() map[string]interface{} {
	total := atomic.LoadInt64(&m.totalExecutions)
	successful := atomic.LoadInt64(&m.successfulExecutions)
	failed := atomic.LoadInt64(&m.failedExecutions)
	timedOut := atomic.LoadInt64(&m.timeoutExecutions)

	totalDeploy := atomic.LoadInt64(&m.totalDeployments)
	successDeploy := atomic.LoadInt64(&m.successfulDeployments)
	failedDeploy := atomic.LoadInt64(&m.failedDeployments)
	cachedDeploy := atomic.LoadInt64(&m.cachedDeployments)

	successRate := float64(0)
	if total > 0 {
		successRate = float64(successful) / float64(total) * 100
	}

	cacheHitRate := float64(0)
	if totalDeploy > 0 {
		cacheHitRate = float64(cachedDeploy) / float64(totalDeploy) * 100
	}

	return map[string]interface{}{
		"executions": map[string]interface{}{
			"total":       total,
			"successful":  successful,
			"failed":      failed,
			"timedOut":    timedOut,
			"successRate": successRate,
		},
		"deployments": map[string]interface{}{
			"total":        totalDeploy,
			"successful":   successDeploy,
			"failed":       failedDeploy,
			"cached":       cachedDeploy,
			"cacheHitRate": cacheHitRate,
		},
	}
}

// logMetrics logs current metrics
func (m *ExecutorMetrics) logMetrics() {
	stats := m.GetStats()
	m.log.WithFields(logrus.Fields{
		"executions":  stats["executions"],
		"deployments": stats["deployments"],
	}).Info("SSH executor metrics")
}

// Reset resets all metrics
func (m *ExecutorMetrics) Reset() {
	atomic.StoreInt64(&m.totalExecutions, 0)
	atomic.StoreInt64(&m.successfulExecutions, 0)
	atomic.StoreInt64(&m.failedExecutions, 0)
	atomic.StoreInt64(&m.timeoutExecutions, 0)

	atomic.StoreInt64(&m.totalDeployments, 0)
	atomic.StoreInt64(&m.successfulDeployments, 0)
	atomic.StoreInt64(&m.failedDeployments, 0)
	atomic.StoreInt64(&m.cachedDeployments, 0)

	m.executionDurations = sync.Map{}
	m.deploymentDurations = sync.Map{}
}
