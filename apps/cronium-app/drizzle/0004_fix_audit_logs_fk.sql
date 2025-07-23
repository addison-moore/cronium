-- Fix tool_audit_logs foreign key constraint to handle deleted tools
-- Drop the existing foreign key constraint
ALTER TABLE tool_audit_logs 
DROP CONSTRAINT IF EXISTS tool_audit_logs_tool_id_fkey;

-- Re-add the foreign key constraint with ON DELETE SET NULL
ALTER TABLE tool_audit_logs 
ADD CONSTRAINT tool_audit_logs_tool_id_fkey 
FOREIGN KEY (tool_id) 
REFERENCES tool_credentials(id) 
ON DELETE SET NULL;

-- Add index on tool_id for better query performance
CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_tool_id ON tool_audit_logs(tool_id);