package metrics

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sirupsen/logrus"
)

// Collector handles metrics collection
type Collector struct {
	config config.MonitoringConfig
	log    *logrus.Logger
	
	// Metrics
	jobsReceived   *prometheus.CounterVec
	jobsCompleted  *prometheus.CounterVec
	jobsFailed     *prometheus.CounterVec
	jobDuration    *prometheus.HistogramVec
	jobsActive     prometheus.Gauge
	
	// API metrics
	apiRequests    *prometheus.CounterVec
	apiDuration    *prometheus.HistogramVec
	apiErrors      *prometheus.CounterVec
	
	// Resource metrics
	connectionPool *prometheus.GaugeVec
	
	mu sync.RWMutex
}

// NewCollector creates a new metrics collector
func NewCollector(cfg config.MonitoringConfig, log *logrus.Logger) *Collector {
	c := &Collector{
		config: cfg,
		log:    log,
		
		// Job metrics
		jobsReceived: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cronium_jobs_received_total",
				Help: "Total number of jobs received",
			},
			[]string{"type"},
		),
		jobsCompleted: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cronium_jobs_completed_total",
				Help: "Total number of jobs completed successfully",
			},
			[]string{"type"},
		),
		jobsFailed: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cronium_jobs_failed_total",
				Help: "Total number of jobs failed",
			},
			[]string{"type", "reason"},
		),
		jobDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "cronium_job_duration_seconds",
				Help:    "Job execution duration in seconds",
				Buckets: prometheus.ExponentialBuckets(1, 2, 10), // 1s to ~17min
			},
			[]string{"type"},
		),
		jobsActive: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "cronium_jobs_active",
				Help: "Number of currently executing jobs",
			},
		),
		
		// API metrics
		apiRequests: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cronium_api_requests_total",
				Help: "Total number of API requests",
			},
			[]string{"endpoint", "method"},
		),
		apiDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "cronium_api_duration_seconds",
				Help:    "API request duration in seconds",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"endpoint", "method"},
		),
		apiErrors: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cronium_api_errors_total",
				Help: "Total number of API errors",
			},
			[]string{"endpoint", "method", "code"},
		),
		
		// Resource metrics
		connectionPool: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "cronium_ssh_connections",
				Help: "Number of SSH connections in pool",
			},
			[]string{"server", "state"},
		),
	}
	
	// Register metrics
	c.registerMetrics()
	
	return c
}

// registerMetrics registers all metrics with Prometheus
func (c *Collector) registerMetrics() {
	prometheus.MustRegister(
		c.jobsReceived,
		c.jobsCompleted,
		c.jobsFailed,
		c.jobDuration,
		c.jobsActive,
		c.apiRequests,
		c.apiDuration,
		c.apiErrors,
		c.connectionPool,
	)
}

// Job metrics

// RecordJobReceived records a job being received
func (c *Collector) RecordJobReceived(jobType string) {
	c.jobsReceived.WithLabelValues(jobType).Inc()
}

// RecordJobCompleted records a job completion
func (c *Collector) RecordJobCompleted(jobType string, duration float64) {
	c.jobsCompleted.WithLabelValues(jobType).Inc()
	c.jobDuration.WithLabelValues(jobType).Observe(duration)
}

// RecordJobFailed records a job failure
func (c *Collector) RecordJobFailed(jobType, reason string) {
	c.jobsFailed.WithLabelValues(jobType, reason).Inc()
}

// SetActiveJobs sets the number of active jobs
func (c *Collector) SetActiveJobs(count float64) {
	c.jobsActive.Set(count)
}

// IncActiveJobs increments active jobs
func (c *Collector) IncActiveJobs() {
	c.jobsActive.Inc()
}

// DecActiveJobs decrements active jobs
func (c *Collector) DecActiveJobs() {
	c.jobsActive.Dec()
}

// API metrics

// RecordAPIRequest records an API request
func (c *Collector) RecordAPIRequest(endpoint, method string, duration float64) {
	c.apiRequests.WithLabelValues(endpoint, method).Inc()
	c.apiDuration.WithLabelValues(endpoint, method).Observe(duration)
}

// RecordAPIError records an API error
func (c *Collector) RecordAPIError(endpoint, method, code string) {
	c.apiErrors.WithLabelValues(endpoint, method, code).Inc()
}

// Resource metrics

// SetConnectionPoolSize sets the SSH connection pool size
func (c *Collector) SetConnectionPoolSize(server, state string, count float64) {
	c.connectionPool.WithLabelValues(server, state).Set(count)
}

// Server handles the metrics HTTP endpoint
type Server struct {
	config config.MonitoringConfig
	log    *logrus.Logger
	server *http.Server
}

// NewServer creates a new metrics server
func NewServer(cfg config.MonitoringConfig, log *logrus.Logger) *Server {
	return &Server{
		config: cfg,
		log:    log,
	}
}

// Start starts the metrics HTTP server
func (s *Server) Start() error {
	if !s.config.Enabled {
		s.log.Info("Metrics server disabled")
		return nil
	}
	
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	
	s.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", s.config.MetricsPort),
		Handler: mux,
	}
	
	s.log.WithField("port", s.config.MetricsPort).Info("Starting metrics server")
	return s.server.ListenAndServe()
}

// Shutdown stops the metrics server
func (s *Server) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}