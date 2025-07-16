package logger

import (
	"context"
	"sync"
	"time"

	"github.com/addison-more/cronium/orchestrator/internal/config"
	"github.com/addison-more/cronium/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// Streamer handles log streaming for multiple jobs
type Streamer struct {
	config    config.WSLogConfig
	wsClient  *WebSocketClient
	log       *logrus.Logger
	
	// Job tracking
	mu          sync.RWMutex
	activeJobs  map[string]*JobLogger
	
	// Control
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// JobLogger tracks logging for a specific job
type JobLogger struct {
	jobID      string
	streamer   *Streamer
	buffer     []LogMessage
	bufferMu   sync.Mutex
	lastFlush  time.Time
	sequence   int64
}

// NewStreamer creates a new log streamer
func NewStreamer(cfg config.WSLogConfig, wsURL, token string, log *logrus.Logger) *Streamer {
	ctx, cancel := context.WithCancel(context.Background())
	
	s := &Streamer{
		config:     cfg,
		log:        log,
		activeJobs: make(map[string]*JobLogger),
		ctx:        ctx,
		cancel:     cancel,
	}
	
	// Create WebSocket client if enabled
	if cfg.Enabled && wsURL != "" {
		s.wsClient = NewWebSocketClient(wsURL, token, log)
		s.wsClient.SetCallbacks(
			func() { log.Info("Log streaming connected") },
			func(err error) { 
				log.WithError(err).Warn("Log streaming disconnected")
				// Attempt reconnection
				go s.wsClient.Reconnect(ctx)
			},
		)
	}
	
	return s
}

// Start begins the log streaming service
func (s *Streamer) Start(ctx context.Context) error {
	if s.wsClient == nil {
		s.log.Info("Log streaming disabled")
		return nil
	}
	
	// Connect WebSocket
	if err := s.wsClient.Connect(ctx); err != nil {
		s.log.WithError(err).Warn("Failed to connect log streaming, will retry")
		// Start reconnection in background
		go s.wsClient.Reconnect(s.ctx)
	}
	
	// Start flush timer
	s.wg.Add(1)
	go s.flushLoop()
	
	return nil
}

// Stop stops the log streaming service
func (s *Streamer) Stop() error {
	s.cancel()
	
	// Flush all pending logs
	s.flushAll()
	
	// Disconnect WebSocket
	if s.wsClient != nil {
		s.wsClient.Disconnect()
	}
	
	// Wait for goroutines
	s.wg.Wait()
	
	return nil
}

// StartJob begins logging for a job
func (s *Streamer) StartJob(jobID string) *JobLogger {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	jl := &JobLogger{
		jobID:     jobID,
		streamer:  s,
		buffer:    make([]LogMessage, 0, s.config.BufferSize),
		lastFlush: time.Now(),
	}
	
	s.activeJobs[jobID] = jl
	s.log.WithField("jobID", jobID).Debug("Started job logging")
	
	return jl
}

// StopJob stops logging for a job
func (s *Streamer) StopJob(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if jl, exists := s.activeJobs[jobID]; exists {
		// Flush any remaining logs
		jl.Flush()
		
		delete(s.activeJobs, jobID)
		s.log.WithField("jobID", jobID).Debug("Stopped job logging")
	}
}

// GetJobLogger returns the logger for a job
func (s *Streamer) GetJobLogger(jobID string) (*JobLogger, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	jl, exists := s.activeJobs[jobID]
	return jl, exists
}

// StreamLog streams a log entry for a job
func (s *Streamer) StreamLog(jobID string, logEntry *types.LogEntry) {
	if jl, exists := s.GetJobLogger(jobID); exists {
		jl.AddLog(logEntry)
	} else {
		// Job not tracked, send directly if connected
		if s.wsClient != nil && s.wsClient.IsConnected() {
			s.wsClient.SendLog(jobID, logEntry)
		}
	}
}

// flushLoop periodically flushes buffered logs
func (s *Streamer) flushLoop() {
	defer s.wg.Done()
	
	ticker := time.NewTicker(s.config.FlushInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.flushAll()
		}
	}
}

// flushAll flushes logs for all active jobs
func (s *Streamer) flushAll() {
	s.mu.RLock()
	jobs := make([]*JobLogger, 0, len(s.activeJobs))
	for _, jl := range s.activeJobs {
		jobs = append(jobs, jl)
	}
	s.mu.RUnlock()
	
	for _, jl := range jobs {
		jl.FlushIfNeeded()
	}
}

// JobLogger methods

// AddLog adds a log entry to the buffer
func (jl *JobLogger) AddLog(logEntry *types.LogEntry) {
	jl.bufferMu.Lock()
	defer jl.bufferMu.Unlock()
	
	jl.sequence++
	
	msg := LogMessage{
		JobID:     jl.jobID,
		Timestamp: logEntry.Timestamp,
		Stream:    logEntry.Stream,
		Line:      logEntry.Line,
		Sequence:  jl.sequence,
	}
	
	jl.buffer = append(jl.buffer, msg)
	
	// Check if we should flush
	shouldFlush := len(jl.buffer) >= jl.streamer.config.BatchSize ||
		time.Since(jl.lastFlush) > jl.streamer.config.FlushInterval
	
	if shouldFlush {
		jl.flushLocked()
	}
}

// FlushIfNeeded flushes the buffer if needed
func (jl *JobLogger) FlushIfNeeded() {
	jl.bufferMu.Lock()
	defer jl.bufferMu.Unlock()
	
	if len(jl.buffer) > 0 && time.Since(jl.lastFlush) > jl.streamer.config.FlushInterval {
		jl.flushLocked()
	}
}

// Flush forces a flush of the buffer
func (jl *JobLogger) Flush() {
	jl.bufferMu.Lock()
	defer jl.bufferMu.Unlock()
	
	if len(jl.buffer) > 0 {
		jl.flushLocked()
	}
}

// flushLocked flushes the buffer (must be called with lock held)
func (jl *JobLogger) flushLocked() {
	if len(jl.buffer) == 0 {
		return
	}
	
	// Send to WebSocket if connected
	if jl.streamer.wsClient != nil && jl.streamer.wsClient.IsConnected() {
		for _, msg := range jl.buffer {
			jl.streamer.wsClient.send <- msg
		}
		
		jl.streamer.log.WithFields(logrus.Fields{
			"jobID": jl.jobID,
			"count": len(jl.buffer),
		}).Debug("Flushed log buffer")
	} else {
		jl.streamer.log.WithField("jobID", jl.jobID).Debug("WebSocket not connected, dropping logs")
	}
	
	// Clear buffer
	jl.buffer = jl.buffer[:0]
	jl.lastFlush = time.Now()
}

// LogFromUpdate logs from an execution update
func (jl *JobLogger) LogFromUpdate(update types.ExecutionUpdate) {
	if update.Type == types.UpdateTypeLog {
		if logEntry, ok := update.Data.(*types.LogEntry); ok {
			jl.AddLog(logEntry)
		}
	}
}