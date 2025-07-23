-- Add tool_action_config column to events table
ALTER TABLE events ADD COLUMN tool_action_config JSONB;

-- Create tool_action_logs table
CREATE TABLE tool_action_logs (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  tool_type VARCHAR(50) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  action_id VARCHAR(100) NOT NULL,
  parameters JSONB,
  result JSONB,
  status VARCHAR(20) NOT NULL,
  execution_time INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for performance
CREATE INDEX idx_tool_action_logs_event_id ON tool_action_logs(event_id);
CREATE INDEX idx_tool_action_logs_tool_type ON tool_action_logs(tool_type);
CREATE INDEX idx_tool_action_logs_status ON tool_action_logs(status);
CREATE INDEX idx_tool_action_logs_created_at ON tool_action_logs(created_at);

-- Comment: This migration adds support for Tool Action events
-- - Adds toolActionConfig field to events table for storing tool action configuration
-- - Creates tool_action_logs table for tracking tool action execution history
-- - Adds performance indexes for common query patterns