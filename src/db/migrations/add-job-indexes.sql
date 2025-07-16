-- Add indexes for jobs table for better performance

-- Index for polling pending jobs (used by orchestrator)
CREATE INDEX idx_jobs_status_scheduled_for ON jobs(status, scheduled_for) 
WHERE status IN ('queued', 'claimed');

-- Index for user's job queries
CREATE INDEX idx_jobs_user_id_status ON jobs(user_id, status);

-- Index for event-based job queries
CREATE INDEX idx_jobs_event_id ON jobs(event_id);

-- Index for orchestrator-specific queries
CREATE INDEX idx_jobs_orchestrator_id ON jobs(orchestrator_id);

-- Composite index for job queue polling with priority
CREATE INDEX idx_jobs_queue_poll ON jobs(status, priority DESC, scheduled_for)
WHERE status = 'queued';

-- Add indexes for logs table

-- Index for job-based log queries
CREATE INDEX idx_logs_job_id ON logs(job_id);

-- Index for event-based log queries
CREATE INDEX idx_logs_event_id ON logs(event_id);

-- Index for user's log queries
CREATE INDEX idx_logs_user_id ON logs(user_id);

-- Composite index for log filtering
CREATE INDEX idx_logs_job_id_start_time ON logs(job_id, start_time);