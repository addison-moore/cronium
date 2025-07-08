-- Create rate_limit_buckets table
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  identifier VARCHAR(255) NOT NULL,
  sub_identifier VARCHAR(255),
  count INTEGER NOT NULL DEFAULT 0,
  limit INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  reset_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create user_quotas table
CREATE TABLE IF NOT EXISTS user_quotas (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  quota_config JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create quota_usage table
CREATE TABLE IF NOT EXISTS quota_usage (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource VARCHAR(100) NOT NULL,
  amount INTEGER NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create tool_usage_metrics table
CREATE TABLE IF NOT EXISTS tool_usage_metrics (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id VARCHAR(100) NOT NULL,
  action_id VARCHAR(100),
  execution_time INTEGER, -- milliseconds
  success BOOLEAN NOT NULL,
  error_type VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_rate_limit_buckets_key ON rate_limit_buckets(key);
CREATE INDEX idx_rate_limit_buckets_reset_at ON rate_limit_buckets(reset_at);
CREATE INDEX idx_rate_limit_buckets_type_identifier ON rate_limit_buckets(type, identifier);

CREATE INDEX idx_user_quotas_user_id ON user_quotas(user_id);

CREATE INDEX idx_quota_usage_user_id ON quota_usage(user_id);
CREATE INDEX idx_quota_usage_resource ON quota_usage(resource);
CREATE INDEX idx_quota_usage_created_at ON quota_usage(created_at);

CREATE INDEX idx_tool_usage_metrics_user_id ON tool_usage_metrics(user_id);
CREATE INDEX idx_tool_usage_metrics_tool_id ON tool_usage_metrics(tool_id);
CREATE INDEX idx_tool_usage_metrics_created_at ON tool_usage_metrics(created_at);