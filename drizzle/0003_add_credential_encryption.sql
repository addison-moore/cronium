-- Add encryption support to tool_credentials table
ALTER TABLE tool_credentials 
ADD COLUMN encrypted BOOLEAN DEFAULT false,
ADD COLUMN encryption_metadata JSONB;

-- Add index for finding unencrypted credentials (for migration)
CREATE INDEX idx_tool_credentials_encrypted ON tool_credentials(encrypted);

-- Add audit log table for security events
CREATE TABLE IF NOT EXISTS tool_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_id INTEGER REFERENCES tool_credentials(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'create', 'read', 'update', 'delete', 'execute', 'auth_failure', etc.
  action_details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for audit log queries
CREATE INDEX idx_tool_audit_logs_user_id ON tool_audit_logs(user_id);
CREATE INDEX idx_tool_audit_logs_tool_id ON tool_audit_logs(tool_id);
CREATE INDEX idx_tool_audit_logs_action ON tool_audit_logs(action);
CREATE INDEX idx_tool_audit_logs_created_at ON tool_audit_logs(created_at DESC);
CREATE INDEX idx_tool_audit_logs_user_tool ON tool_audit_logs(user_id, tool_id);

-- Add rate limit tracking table
CREATE TABLE IF NOT EXISTS tool_rate_limits (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_request TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint for rate limit windows
CREATE UNIQUE INDEX idx_tool_rate_limits_user_tool_window 
ON tool_rate_limits(user_id, tool_type, window_start);

-- Add index for cleanup
CREATE INDEX idx_tool_rate_limits_window_start ON tool_rate_limits(window_start);

-- Add user quota configuration table
CREATE TABLE IF NOT EXISTS user_tool_quotas (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_type TEXT,
  daily_limit INTEGER,
  hourly_limit INTEGER,
  burst_limit INTEGER,
  tier TEXT DEFAULT 'free', -- 'free', 'pro', 'enterprise'
  custom_limits JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint
CREATE UNIQUE INDEX idx_user_tool_quotas_user_tool 
ON user_tool_quotas(user_id, tool_type);

-- Add comments
COMMENT ON COLUMN tool_credentials.encrypted IS 'Whether the credentials are encrypted';
COMMENT ON COLUMN tool_credentials.encryption_metadata IS 'Encryption metadata (IV, algorithm, etc)';
COMMENT ON TABLE tool_audit_logs IS 'Audit trail for tool-related security events';
COMMENT ON TABLE tool_rate_limits IS 'Rate limiting tracking for tool usage';
COMMENT ON TABLE user_tool_quotas IS 'User-specific quota configuration for tools';