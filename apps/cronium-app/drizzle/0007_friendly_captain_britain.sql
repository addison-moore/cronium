CREATE TABLE "server_deletion_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"notification_type" varchar(50) NOT NULL,
	"sent_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executions" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "servers" ALTER COLUMN "ssh_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "setup_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "setup_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "execution_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "execution_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "cleanup_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "cleanup_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "setup_duration" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "execution_duration" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "cleanup_duration" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "total_duration" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "execution_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "execution_id" varchar(100);--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "execution_duration" integer;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "setup_duration" integer;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "exit_code" integer;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "archived_by" varchar(255);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "deletion_scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "ssh_key_purged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "password_purged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD COLUMN "branch_id" varchar(100);--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD COLUMN "parallel_group_id" varchar(100);--> statement-breakpoint
ALTER TABLE "server_deletion_notifications" ADD CONSTRAINT "server_deletion_notifications_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_deletion_notifications" ADD CONSTRAINT "server_deletion_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;