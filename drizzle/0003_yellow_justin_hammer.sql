CREATE TABLE "conditional_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(50) NOT NULL,
	"value" varchar(255),
	"success_event_id" integer,
	"fail_event_id" integer,
	"always_event_id" integer,
	"condition_event_id" integer,
	"target_event_id" integer,
	"tool_id" integer,
	"message" text,
	"email_addresses" text,
	"email_subject" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_for" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"orchestrator_id" varchar(255),
	"started_at" timestamp,
	"completed_at" timestamp,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tool_id" integer NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_verifier" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tool_id" integer NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"token_type" varchar(50) DEFAULT 'Bearer' NOT NULL,
	"scope" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "unique_user_tool_provider" UNIQUE("user_id","tool_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"resource" varchar(100) NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"sub_identifier" varchar(255),
	"count" integer DEFAULT 0 NOT NULL,
	"limit" integer NOT NULL,
	"window_ms" integer NOT NULL,
	"reset_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_action_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"tool_type" varchar(50) NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"action_id" varchar(100) NOT NULL,
	"parameters" jsonb,
	"result" jsonb,
	"status" varchar(20) NOT NULL,
	"execution_time" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_action_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255),
	"name" varchar(255) NOT NULL,
	"description" text,
	"tool_type" varchar(50) NOT NULL,
	"action_id" varchar(100) NOT NULL,
	"parameters" jsonb NOT NULL,
	"is_system_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tool_id" integer,
	"action" varchar(50) NOT NULL,
	"action_details" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tool_type" varchar(50) NOT NULL,
	"window_start" timestamp NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_request" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "unique_user_tool_window" UNIQUE("user_id","tool_type","window_start")
);
--> statement-breakpoint
CREATE TABLE "tool_usage_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tool_id" varchar(100) NOT NULL,
	"action_id" varchar(100),
	"execution_time" integer,
	"success" boolean NOT NULL,
	"error_type" varchar(100),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_quotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"quota_config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_quotas_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_tool_quotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tool_type" varchar(50),
	"daily_limit" integer,
	"hourly_limit" integer,
	"burst_limit" integer,
	"tier" varchar(20) DEFAULT 'free' NOT NULL,
	"custom_limits" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "unique_user_tool" UNIQUE("user_id","tool_type")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer NOT NULL,
	"webhook_event_id" integer NOT NULL,
	"delivery_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"status_code" integer,
	"response" text,
	"error" text,
	"headers" jsonb,
	"duration" integer,
	"attempted_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	"event_id" integer,
	"duration" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"key" varchar(255) NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]' NOT NULL,
	"headers" jsonb DEFAULT '{}',
	"active" boolean DEFAULT true NOT NULL,
	"verify_timestamp" boolean DEFAULT true,
	"ip_whitelist" jsonb,
	"rate_limit" jsonb,
	"retry_config" jsonb,
	"transformations" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "conditional_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "conditional_events" CASCADE;--> statement-breakpoint
DROP TABLE "sessions" CASCADE;--> statement-breakpoint
DROP TABLE "templates" CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "tool_action_config" jsonb;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "job_id" varchar(50);--> statement-breakpoint
ALTER TABLE "tool_credentials" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_credentials" ADD COLUMN "encryption_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "conditional_actions" ADD CONSTRAINT "conditional_actions_success_event_id_events_id_fk" FOREIGN KEY ("success_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_actions" ADD CONSTRAINT "conditional_actions_fail_event_id_events_id_fk" FOREIGN KEY ("fail_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_actions" ADD CONSTRAINT "conditional_actions_always_event_id_events_id_fk" FOREIGN KEY ("always_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_actions" ADD CONSTRAINT "conditional_actions_condition_event_id_events_id_fk" FOREIGN KEY ("condition_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_actions" ADD CONSTRAINT "conditional_actions_target_event_id_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_actions" ADD CONSTRAINT "conditional_actions_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_logs" ADD CONSTRAINT "tool_action_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_templates" ADD CONSTRAINT "tool_action_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit_logs" ADD CONSTRAINT "tool_audit_logs_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_usage_metrics" ADD CONSTRAINT "tool_usage_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;