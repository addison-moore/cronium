-- Rollback: Rename conditional_actions table back to conditional_events
ALTER TABLE "conditional_actions" RENAME TO "conditional_events";

-- Rollback: Update the primary key constraint name
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_pkey" TO "conditional_events_pkey";

-- Rollback: Update foreign key constraint names
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_success_event_id_events_id_fk" TO "conditional_events_success_event_id_events_id_fk";
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_fail_event_id_events_id_fk" TO "conditional_events_fail_event_id_events_id_fk";
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_always_event_id_events_id_fk" TO "conditional_events_always_event_id_events_id_fk";
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_condition_event_id_events_id_fk" TO "conditional_events_condition_event_id_events_id_fk";
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_target_event_id_events_id_fk" TO "conditional_events_target_event_id_events_id_fk";
ALTER TABLE "conditional_events" RENAME CONSTRAINT "conditional_actions_tool_id_tool_credentials_id_fk" TO "conditional_events_tool_id_tool_credentials_id_fk";

-- Remove comment
COMMENT ON TABLE "conditional_events" IS NULL;