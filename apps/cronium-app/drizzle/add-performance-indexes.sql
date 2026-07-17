-- Performance indexes (P2, db-performance plan Phase 3, corrected for the
-- current schema: `is_active` is now `status`, and there is no
-- `workflow_events` table).
--
-- All statements are idempotent (IF NOT EXISTS). Apply with:
--   pnpm --filter @cronium/app exec tsx src/scripts/migrations/apply-performance-indexes.ts
-- or run this file directly against the database.

-- Foreign-key / lookup indexes -------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events (user_id);
CREATE INDEX IF NOT EXISTS idx_events_server_id ON events (server_id);
CREATE INDEX IF NOT EXISTS idx_logs_event_id ON logs (event_id);
CREATE INDEX IF NOT EXISTS idx_logs_job_id ON logs (job_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows (user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow_id ON workflow_nodes (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_connections_workflow_id ON workflow_connections (workflow_id);
CREATE INDEX IF NOT EXISTS idx_event_servers_event_id ON event_servers (event_id);
CREATE INDEX IF NOT EXISTS idx_event_servers_server_id ON event_servers (server_id);

-- Composite / ordering indexes -------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_events_user_status ON events (user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_next_run_active ON events (next_run_at)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_logs_start_time_desc ON logs (start_time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created_desc ON logs (created_at DESC);

-- Job-queue indexes: the claim query filters status + scheduled_for and
-- orders by priority/created_at.
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs (status, scheduled_for);

-- Env-var foreign key (merged from the former add-event-indexes.sql).
CREATE INDEX IF NOT EXISTS idx_env_vars_event_id ON env_vars (event_id);
CREATE INDEX IF NOT EXISTS idx_events_status_user_id ON events (status, user_id);
CREATE INDEX IF NOT EXISTS idx_logs_event_id_start_time ON logs (event_id, start_time DESC);
