-- Manual migration for event relation indexes
-- Run this with: pnpm db:push or directly in your database

-- Indexes for conditional_actions foreign keys
CREATE INDEX IF NOT EXISTS idx_conditional_actions_success_event_id ON conditional_actions(success_event_id);
CREATE INDEX IF NOT EXISTS idx_conditional_actions_fail_event_id ON conditional_actions(fail_event_id);
CREATE INDEX IF NOT EXISTS idx_conditional_actions_always_event_id ON conditional_actions(always_event_id);
CREATE INDEX IF NOT EXISTS idx_conditional_actions_condition_event_id ON conditional_actions(condition_event_id);
CREATE INDEX IF NOT EXISTS idx_conditional_actions_target_event_id ON conditional_actions(target_event_id);

-- Indexes for event_servers foreign keys
CREATE INDEX IF NOT EXISTS idx_event_servers_event_id ON event_servers(event_id);
CREATE INDEX IF NOT EXISTS idx_event_servers_server_id ON event_servers(server_id);

-- Index for env_vars foreign key
CREATE INDEX IF NOT EXISTS idx_env_vars_event_id ON env_vars(event_id);

-- Additional composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_status_user_id ON events(status, user_id);
CREATE INDEX IF NOT EXISTS idx_logs_event_id_start_time ON logs(event_id, start_time DESC);