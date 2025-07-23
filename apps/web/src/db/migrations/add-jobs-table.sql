-- Add jobs table for containerized execution queue
-- This migration adds support for the job queue system used by the orchestrator

-- Create enum types for job status, type, and priority
DO $$ BEGIN
    CREATE TYPE job_status AS ENUM ('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE job_type AS ENUM ('SCRIPT', 'HTTP_REQUEST', 'TOOL_ACTION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE job_priority AS ENUM ('0', '1', '2', '3', '4');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(50) PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type job_type NOT NULL,
    status job_status NOT NULL DEFAULT 'queued',
    priority job_priority NOT NULL DEFAULT '2',
    payload JSONB NOT NULL,
    result JSONB,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    orchestrator_id VARCHAR(255),
    attempts INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_event_id ON jobs(event_id);
CREATE INDEX IF NOT EXISTS idx_jobs_orchestrator_id ON jobs(orchestrator_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_for ON jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_priority_scheduled ON jobs(priority DESC, scheduled_for ASC) WHERE status = 'queued';

-- Add job_id column to logs table to link executions with jobs
ALTER TABLE logs 
ADD COLUMN IF NOT EXISTS job_id VARCHAR(50) REFERENCES jobs(id) ON DELETE CASCADE;

-- Create index on logs.job_id for efficient lookups
CREATE INDEX IF NOT EXISTS idx_logs_job_id ON logs(job_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_jobs_updated_at_trigger ON jobs;
CREATE TRIGGER update_jobs_updated_at_trigger
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION update_jobs_updated_at();

-- Add comment to table
COMMENT ON TABLE jobs IS 'Job queue for containerized execution system';
COMMENT ON COLUMN jobs.id IS 'Unique job identifier';
COMMENT ON COLUMN jobs.event_id IS 'Reference to the event being executed';
COMMENT ON COLUMN jobs.user_id IS 'User who created the job';
COMMENT ON COLUMN jobs.type IS 'Type of job: SCRIPT, HTTP_REQUEST, or TOOL_ACTION';
COMMENT ON COLUMN jobs.status IS 'Current job status in the queue';
COMMENT ON COLUMN jobs.priority IS 'Job priority (0=lowest, 4=highest)';
COMMENT ON COLUMN jobs.payload IS 'Job execution payload including script, environment, etc.';
COMMENT ON COLUMN jobs.result IS 'Execution result data';
COMMENT ON COLUMN jobs.scheduled_for IS 'When the job should be executed';
COMMENT ON COLUMN jobs.claimed_at IS 'When the job was claimed by an orchestrator';
COMMENT ON COLUMN jobs.started_at IS 'When the job execution started';
COMMENT ON COLUMN jobs.completed_at IS 'When the job execution completed';
COMMENT ON COLUMN jobs.orchestrator_id IS 'ID of the orchestrator executing the job';
COMMENT ON COLUMN jobs.attempts IS 'Number of execution attempts';
COMMENT ON COLUMN jobs.metadata IS 'Additional job metadata';
COMMENT ON COLUMN jobs.error IS 'Error message if job failed';