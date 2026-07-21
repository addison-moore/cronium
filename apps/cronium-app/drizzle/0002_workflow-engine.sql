CREATE TABLE "workflow_step_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_execution_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"job_id" varchar(50),
	"output" jsonb,
	"condition" boolean,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"execution_event_id" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "next_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_step_runs_exec_idx" ON "workflow_step_runs" USING btree ("workflow_execution_id");--> statement-breakpoint
CREATE INDEX "workflow_step_runs_job_idx" ON "workflow_step_runs" USING btree ("job_id");