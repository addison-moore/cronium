package ssh

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// RunnerCacheEntry represents a cached runner deployment
type RunnerCacheEntry struct {
	ServerID     string
	RunnerPath   string
	Version      string
	Checksum     string
	DeployedAt   time.Time
	LastVerified time.Time
}

// RunnerCache manages runner deployments across servers
type RunnerCache struct {
	mu      sync.RWMutex
	entries map[string]*RunnerCacheEntry // key: serverID
	log     *logrus.Logger
	locks   sync.Map // key: server identity, value: *sync.Mutex
}

// NewRunnerCache creates a new runner cache
func NewRunnerCache(log *logrus.Logger) *RunnerCache {
	return &RunnerCache{
		entries: make(map[string]*RunnerCacheEntry),
		log:     log,
	}
}

// Get retrieves a cached runner entry. A cache hit is only deployment
// metadata; callers must still verify the remote file's checksum before using
// it. In particular, LastVerified must never be used as a trust window.
func (rc *RunnerCache) Get(serverID string) (*RunnerCacheEntry, bool) {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	entry, exists := rc.entries[serverID]
	if !exists {
		return nil, false
	}

	entryCopy := *entry
	return &entryCopy, true
}

// Set stores a runner deployment in the cache
func (rc *RunnerCache) Set(serverID string, entry *RunnerCacheEntry) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	entryCopy := *entry
	rc.entries[serverID] = &entryCopy
	rc.log.WithFields(logrus.Fields{
		"serverID": serverID,
		"version":  entry.Version,
		"path":     entry.RunnerPath,
	}).Debug("Cached runner deployment")
}

// Lock serializes verification and deployment for one remote server identity.
// This prevents concurrent jobs from racing atomic runner replacements.
func (rc *RunnerCache) Lock(serverID string) func() {
	lockValue, _ := rc.locks.LoadOrStore(serverID, &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}

// UpdateVerified updates the last verified time for an entry
func (rc *RunnerCache) UpdateVerified(serverID string) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	if entry, exists := rc.entries[serverID]; exists {
		entry.LastVerified = time.Now()
	}
}

// Remove removes a cached entry
func (rc *RunnerCache) Remove(serverID string) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	delete(rc.entries, serverID)
	rc.log.WithField("serverID", serverID).Debug("Removed runner from cache")
}

// Clear removes all cached entries
func (rc *RunnerCache) Clear() {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	rc.entries = make(map[string]*RunnerCacheEntry)
	rc.log.Info("Cleared runner cache")
}

// GetStats returns cache statistics
func (rc *RunnerCache) GetStats() map[string]interface{} {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	stats := map[string]interface{}{
		"total_entries": len(rc.entries),
		"servers":       make([]map[string]interface{}, 0, len(rc.entries)),
	}

	for serverID, entry := range rc.entries {
		stats["servers"] = append(stats["servers"].([]map[string]interface{}), map[string]interface{}{
			"server_id":     serverID,
			"version":       entry.Version,
			"deployed_at":   entry.DeployedAt,
			"last_verified": entry.LastVerified,
		})
	}

	return stats
}

// CalculateChecksum calculates the SHA256 checksum of data
func CalculateChecksum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
