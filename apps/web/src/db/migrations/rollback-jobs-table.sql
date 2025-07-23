-- Rollback migration for jobs table
-- This will undo the changes made in add-jobs-table.sql

-- Remove job_id column from logs table
ALTER TABLE logs 
DROP COLUMN IF EXISTS job_id;

-- Drop the jobs table
DROP TABLE IF EXISTS jobs;

-- Drop the enum types
DROP TYPE IF EXISTS job_status;
DROP TYPE IF EXISTS job_type;
DROP TYPE IF EXISTS job_priority;

-- Note: This rollback will delete all job data. 
-- Make sure to backup any important data before running this.