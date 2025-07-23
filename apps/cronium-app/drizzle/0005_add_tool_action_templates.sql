-- Add tool_action_templates table
CREATE TABLE IF NOT EXISTS "tool_action_templates" (
  "id" SERIAL PRIMARY KEY,
  "user_id" VARCHAR(255) REFERENCES "users"("id") ON DELETE CASCADE,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "tool_type" VARCHAR(50) NOT NULL,
  "action_id" VARCHAR(100) NOT NULL,
  "parameters" JSONB NOT NULL,
  "is_system_template" BOOLEAN DEFAULT false NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_tool_action_templates_user_id" ON "tool_action_templates"("user_id");
CREATE INDEX IF NOT EXISTS "idx_tool_action_templates_tool_type" ON "tool_action_templates"("tool_type");
CREATE INDEX IF NOT EXISTS "idx_tool_action_templates_action_id" ON "tool_action_templates"("action_id");
CREATE INDEX IF NOT EXISTS "idx_tool_action_templates_system" ON "tool_action_templates"("is_system_template");

-- Add composite index for common queries
CREATE INDEX IF NOT EXISTS "idx_tool_action_templates_tool_action" ON "tool_action_templates"("tool_type", "action_id");