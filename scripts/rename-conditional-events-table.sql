-- Rename conditional_events table to conditional_actions
ALTER TABLE conditional_events RENAME TO conditional_actions;

-- Update any constraints or indexes that might have the old name
-- Note: PostgreSQL automatically updates foreign key constraints when renaming tables