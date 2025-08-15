-- Migration: Add payload_version column to events table
-- This migration adds support for the runner payload system

-- Add payload_version column to events table
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS payload_version INTEGER DEFAULT 1 NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN events.payload_version IS 'Version of the payload format for runner execution';

-- Create runner_payloads table if it doesn't exist
CREATE TABLE IF NOT EXISTS runner_payloads (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    hash VARCHAR(64) NOT NULL,
    path VARCHAR(512) NOT NULL,
    size INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(event_id, version)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_runner_payloads_event_id ON runner_payloads(event_id);
CREATE INDEX IF NOT EXISTS idx_runner_payloads_hash ON runner_payloads(hash);

-- Success message
DO $$ 
BEGIN 
    RAISE NOTICE 'Migration completed: payload_version column and runner_payloads table added successfully';
END $$;