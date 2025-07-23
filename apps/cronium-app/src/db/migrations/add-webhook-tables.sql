-- Create webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  key VARCHAR(255) NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]',
  headers JSONB DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  verify_timestamp BOOLEAN DEFAULT true,
  ip_whitelist JSONB,
  rate_limit JSONB,
  retry_config JSONB,
  transformations JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create webhook_events table
CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  event VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create webhook_deliveries table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  webhook_event_id INTEGER NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  delivery_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  status_code INTEGER,
  response TEXT,
  error TEXT,
  headers JSONB,
  duration INTEGER,
  attempted_at TIMESTAMP NOT NULL
);

-- Create webhook_logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
  id SERIAL PRIMARY KEY,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  success BOOLEAN NOT NULL,
  error TEXT,
  event_id INTEGER,
  duration INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX idx_webhooks_key ON webhooks(key);
CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_event_id ON webhook_deliveries(webhook_event_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);