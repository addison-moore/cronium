-- Update logs table to support job-based execution
-- This migration adds additional fields needed for the containerized execution system

-- Add orchestrator_id to track which orchestrator executed the job
ALTER TABLE logs 
ADD COLUMN IF NOT EXISTS orchestrator_id VARCHAR(255);

-- Add execution_type to distinguish between legacy and containerized execution
ALTER TABLE logs 
ADD COLUMN IF NOT EXISTS execution_type VARCHAR(50) DEFAULT 'legacy';

-- Add container_id to track the container that executed the script
ALTER TABLE logs 
ADD COLUMN IF NOT EXISTS container_id VARCHAR(255);

-- Add structured log data column for better log storage
ALTER TABLE logs 
ADD COLUMN IF NOT EXISTS log_data JSONB DEFAULT '[]';

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_logs_orchestrator_id ON logs(orchestrator_id);
CREATE INDEX IF NOT EXISTS idx_logs_execution_type ON logs(execution_type);
CREATE INDEX IF NOT EXISTS idx_logs_container_id ON logs(container_id);

-- Update existing logs to mark them as legacy execution
UPDATE logs 
SET execution_type = 'legacy' 
WHERE execution_type IS NULL;

-- Add comments for new columns
COMMENT ON COLUMN logs.orchestrator_id IS 'ID of the orchestrator that executed this job';
COMMENT ON COLUMN logs.execution_type IS 'Type of execution: legacy (direct) or containerized';
COMMENT ON COLUMN logs.container_id IS 'Docker container ID where the script was executed';
COMMENT ON COLUMN logs.log_data IS 'Structured log entries with timestamps and streams';