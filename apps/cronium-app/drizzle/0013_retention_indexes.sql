CREATE INDEX "logs_execution_id_idx" ON "logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("webhook_event_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_events_exec_idx" ON "workflow_execution_events" USING btree ("workflow_execution_id");--> statement-breakpoint
-- logRetentionDays never had any effect and is gone. Saving any admin settings
-- tab sent its default back to the server, so a stored value was never a choice
-- anyone made, and leaving it behind would only mislead whoever reuses the key.
DELETE FROM "system_settings" WHERE "key" = 'logRetentionDays';
