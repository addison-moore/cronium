ALTER TABLE "webhook_events" ADD COLUMN "user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "source_webhook_id" integer;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_source_webhook_id_webhooks_id_fk" FOREIGN KEY ("source_webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE set null ON UPDATE no action;