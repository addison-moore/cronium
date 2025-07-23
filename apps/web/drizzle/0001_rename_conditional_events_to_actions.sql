-- Rename conditional_events table to conditional_actions
ALTER TABLE "conditional_events" RENAME TO "conditional_actions";

-- Update the primary key constraint name
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_pkey" TO "conditional_actions_pkey";

-- Update foreign key constraint names
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_success_event_id_events_id_fk" TO "conditional_actions_success_event_id_events_id_fk";
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_fail_event_id_events_id_fk" TO "conditional_actions_fail_event_id_events_id_fk";
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_always_event_id_events_id_fk" TO "conditional_actions_always_event_id_events_id_fk";
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_condition_event_id_events_id_fk" TO "conditional_actions_condition_event_id_events_id_fk";
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_target_event_id_events_id_fk" TO "conditional_actions_target_event_id_events_id_fk";
ALTER TABLE "conditional_actions" RENAME CONSTRAINT "conditional_events_tool_id_tool_credentials_id_fk" TO "conditional_actions_tool_id_tool_credentials_id_fk";

-- Update any indexes if they exist
-- Note: The original schema doesn't show any custom indexes on conditional_events, 
-- but if they exist, they would need to be renamed here

-- Add comment to document the change
COMMENT ON TABLE "conditional_actions" IS 'Stores conditional actions that are triggered based on event execution outcomes. Renamed from conditional_events for clarity.';