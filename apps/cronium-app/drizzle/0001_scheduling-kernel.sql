CREATE TABLE "job_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar(50) NOT NULL,
	"from_status" varchar(50),
	"to_status" varchar(50) NOT NULL,
	"actor" varchar(255) NOT NULL,
	"reason" text,
	"data" jsonb,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"workflow_id" integer,
	"kind" varchar(30) NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "schedule_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "catchup_policy" varchar(20) DEFAULT 'SKIP' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "overlap_policy" varchar(20) DEFAULT 'ALLOW' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "misfire_grace_s" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lease_loss_policy" varchar(10) DEFAULT 'RETRY' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "priority" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source" varchar(20);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "max_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_loss_policy" varchar(10) DEFAULT 'RETRY' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cancel_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "active_key" varchar(64);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "scheduled_miss" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_transitions" ADD CONSTRAINT "job_transitions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_incidents" ADD CONSTRAINT "schedule_incidents_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_incidents" ADD CONSTRAINT "schedule_incidents_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_transitions_job_idx" ON "job_transitions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_transitions_outbox_idx" ON "job_transitions" USING btree ("id") WHERE "job_transitions"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "schedule_incidents_event_idx" ON "schedule_incidents" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "events_dispatch_idx" ON "events" USING btree ("next_run_at") WHERE "events"."status" = 'ACTIVE' AND "events"."trigger_type" = 'SCHEDULE';--> statement-breakpoint
CREATE INDEX "executions_job_id_idx" ON "executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("type","priority" DESC NULLS LAST,"scheduled_for") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("lease_expires_at") WHERE "jobs"."status" IN ('claimed', 'running');--> statement-breakpoint
CREATE INDEX "jobs_event_created_idx" ON "jobs" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_key_uq" ON "jobs" USING btree ("active_key") WHERE "jobs"."status" IN ('queued', 'claimed', 'running') AND "jobs"."active_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "logs_job_id_idx" ON "logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "logs_event_created_idx" ON "logs" USING btree ("event_id","created_at");