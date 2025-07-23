package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/docker/docker/client"
	"github.com/sirupsen/logrus"
)

// Status represents health status
type Status string

const (
	StatusHealthy   Status = "healthy"
	StatusUnhealthy Status = "unhealthy"
	StatusDegraded  Status = "degraded"
)

// Checker performs health checks on system components
type Checker struct {
	config       config.MonitoringConfig
	dockerClient *client.Client
	log          *logrus.Logger
	
	mu           sync.RWMutex
	lastCheck    time.Time
	components   map[string]ComponentStatus
}

// ComponentStatus represents the health of a component
type ComponentStatus struct {
	Status    Status                 `json:"status"`
	LastCheck time.Time              `json:"lastCheck"`
	Message   string                 `json:"message,omitempty"`
	Details   map[string]interface{} `json:"details,omitempty"`
}

// HealthResponse is the overall health response
type HealthResponse struct {
	Status     Status                     `json:"status"`
	Timestamp  time.Time                  `json:"timestamp"`
	Components map[string]ComponentStatus `json:"components"`
}

// NewChecker creates a new health checker
func NewChecker(cfg config.MonitoringConfig, log *logrus.Logger) *Checker {
	return &Checker{
		config:     cfg,
		log:        log,
		components: make(map[string]ComponentStatus),
	}
}

// Start begins periodic health checks
func (c *Checker) Start(ctx context.Context) {
	// Initial check
	c.checkAll(ctx)
	
	// Periodic checks
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.checkAll(ctx)
		}
	}
}

// GetHealth returns the current health status
func (c *Checker) GetHealth() *HealthResponse {
	c.mu.RLock()
	defer c.mu.RUnlock()
	
	// Copy components
	components := make(map[string]ComponentStatus)
	for k, v := range c.components {
		components[k] = v
	}
	
	// Determine overall status
	status := StatusHealthy
	for _, comp := range components {
		if comp.Status == StatusUnhealthy {
			status = StatusUnhealthy
			break
		} else if comp.Status == StatusDegraded {
			status = StatusDegraded
		}
	}
	
	return &HealthResponse{
		Status:     status,
		Timestamp:  time.Now(),
		Components: components,
	}
}

// checkAll performs all health checks
func (c *Checker) checkAll(ctx context.Context) {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	c.lastCheck = time.Now()
	
	// Check Docker
	c.checkDocker(ctx)
	
	// Check API connectivity
	c.checkAPI(ctx)
	
	// Add more checks as needed
}

// checkDocker checks Docker daemon health
func (c *Checker) checkDocker(ctx context.Context) {
	if c.dockerClient == nil {
		// Try to create client
		var err error
		c.dockerClient, err = client.NewClientWithOpts(client.FromEnv)
		if err != nil {
			c.components["docker"] = ComponentStatus{
				Status:    StatusUnhealthy,
				LastCheck: time.Now(),
				Message:   "Failed to create Docker client",
				Details:   map[string]interface{}{"error": err.Error()},
			}
			return
		}
	}
	
	// Ping Docker daemon
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	
	info, err := c.dockerClient.Info(ctx)
	if err != nil {
		c.components["docker"] = ComponentStatus{
			Status:    StatusUnhealthy,
			LastCheck: time.Now(),
			Message:   "Failed to connect to Docker daemon",
			Details:   map[string]interface{}{"error": err.Error()},
		}
		return
	}
	
	c.components["docker"] = ComponentStatus{
		Status:    StatusHealthy,
		LastCheck: time.Now(),
		Details: map[string]interface{}{
			"version":    info.ServerVersion,
			"containers": info.Containers,
			"images":     info.Images,
		},
	}
}

// checkAPI checks backend API connectivity
func (c *Checker) checkAPI(ctx context.Context) {
	// This would normally check the actual API
	// For now, we'll just mark it as healthy
	c.components["api"] = ComponentStatus{
		Status:    StatusHealthy,
		LastCheck: time.Now(),
		Message:   "API connectivity check not implemented",
	}
}

// Server handles HTTP health check requests
type Server struct {
	config  config.MonitoringConfig
	checker *Checker
	log     *logrus.Logger
	server  *http.Server
}

// NewServer creates a new health check server
func NewServer(cfg config.MonitoringConfig, checker *Checker, log *logrus.Logger) *Server {
	return &Server{
		config:  cfg,
		checker: checker,
		log:     log,
	}
}

// Start starts the health check HTTP server
func (s *Server) Start() error {
	if !s.config.Enabled {
		s.log.Info("Health check server disabled")
		return nil
	}
	
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/ready", s.handleReady)
	mux.HandleFunc("/live", s.handleLive)
	
	s.server = &http.Server{
		Addr:         fmt.Sprintf(":%d", s.config.HealthPort),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	
	s.log.WithField("port", s.config.HealthPort).Info("Starting health check server")
	return s.server.ListenAndServe()
}

// Shutdown stops the health check server
func (s *Server) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

// handleHealth returns overall health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	health := s.checker.GetHealth()
	
	// Set status code based on health
	statusCode := http.StatusOK
	if health.Status == StatusUnhealthy {
		statusCode = http.StatusServiceUnavailable
	}
	
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(health)
}

// handleReady returns readiness status
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	// For now, same as health
	s.handleHealth(w, r)
}

// handleLive returns liveness status
func (s *Server) handleLive(w http.ResponseWriter, r *http.Request) {
	// Simple liveness check - if we can respond, we're alive
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "alive",
		"timestamp": time.Now(),
	})
}