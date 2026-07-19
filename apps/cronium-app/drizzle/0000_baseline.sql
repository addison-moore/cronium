CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"last_used" timestamp,
	"expires_at" timestamp,
	"scopes" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "api_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "env_vars" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"server_id" integer NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"shared" boolean DEFAULT false NOT NULL,
	"type" varchar(50) NOT NULL,
	"content" text,
	"http_method" varchar(20),
	"http_url" varchar(1000),
	"http_headers" jsonb,
	"http_body" text,
	"tool_action_config" jsonb,
	"source" varchar(50),
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"trigger_type" varchar(50) DEFAULT 'MANUAL' NOT NULL,
	"schedule_number" integer DEFAULT 1 NOT NULL,
	"schedule_unit" varchar(50) DEFAULT 'MINUTES' NOT NULL,
	"custom_schedule" varchar(255),
	"run_location" varchar(50) DEFAULT 'LOCAL' NOT NULL,
	"server_id" integer,
	"timeout_value" integer DEFAULT 30 NOT NULL,
	"timeout_unit" varchar(50) DEFAULT 'SECONDS' NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"start_time" timestamp,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"max_executions" integer DEFAULT 0 NOT NULL,
	"reset_counter_on_active" boolean DEFAULT false NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"job_id" varchar(50) NOT NULL,
	"server_id" integer,
	"server_name" varchar(255),
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"exit_code" integer,
	"output" text,
	"error" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"setup_started_at" timestamp,
	"setup_completed_at" timestamp,
	"execution_started_at" timestamp,
	"execution_completed_at" timestamp,
	"cleanup_started_at" timestamp,
	"cleanup_completed_at" timestamp,
	"setup_duration" integer,
	"execution_duration" integer,
	"cleanup_duration" integer,
	"total_duration" integer,
	"execution_metadata" jsonb,
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
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"workflow_id" integer,
	"job_id" varchar(50),
	"execution_id" varchar(100),
	"status" varchar(50) DEFAULT 'RUNNING' NOT NULL,
	"output" text,
	"start_time" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"end_time" timestamp,
	"duration" integer,
	"execution_duration" integer,
	"setup_duration" integer,
	"successful" boolean DEFAULT false,
	"event_name" varchar(255),
	"event_type" varchar(50),
	"retries" integer DEFAULT 0,
	"error" text,
	"user_id" varchar(255),
	"exit_code" integer,
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
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
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
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"permissions" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "runner_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"runner_version" text NOT NULL,
	"runner_path" text NOT NULL,
	"checksum" text NOT NULL,
	"deployed_at" timestamp DEFAULT now() NOT NULL,
	"last_used" timestamp,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_payloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"event_version" integer NOT NULL,
	"payload_path" text NOT NULL,
	"checksum_path" text,
	"payload_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "server_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"server_id" integer NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "unique_group_server" UNIQUE("group_id","server_id")
);
--> statement-breakpoint
CREATE TABLE "server_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" varchar(255) NOT NULL,
	"ssh_key" text,
	"password" text,
	"username" varchar(255) DEFAULT 'root' NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"online" boolean,
	"last_checked" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"archived_by" varchar(255),
	"archive_reason" text,
	"deletion_scheduled_at" timestamp,
	"ssh_key_purged" boolean DEFAULT false NOT NULL,
	"password_purged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
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
CREATE TABLE "tool_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"credentials" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"encryption_metadata" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
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
CREATE TABLE "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"editor_settings" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
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
CREATE TABLE "user_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_user_key" UNIQUE("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255),
	"username" varchar(255),
	"password" text,
	"first_name" varchar(255),
	"last_name" varchar(255),
	"profile_image_url" varchar(255),
	"role" varchar(50) DEFAULT 'USER' NOT NULL,
	"role_id" integer,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"invite_token" varchar(255),
	"invite_expiry" timestamp,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
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
CREATE TABLE "workflow_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"source_node_id" integer NOT NULL,
	"target_node_id" integer NOT NULL,
	"connection_type" varchar(50) DEFAULT 'ALWAYS' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_execution_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"sequence_order" integer NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration" integer,
	"output" text,
	"error_message" text,
	"connection_type" varchar(50),
	"branch_id" varchar(100),
	"parallel_group_id" varchar(100),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'RUNNING' NOT NULL,
	"trigger_type" varchar(50) NOT NULL,
	"started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp,
	"total_duration" integer,
	"total_events" integer DEFAULT 0,
	"successful_events" integer DEFAULT 0,
	"failed_events" integer DEFAULT 0,
	"execution_data" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"status" varchar(50) DEFAULT 'RUNNING' NOT NULL,
	"level" varchar(50) DEFAULT 'INFO' NOT NULL,
	"message" text,
	"start_time" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"end_time" timestamp,
	"output" text,
	"error" text,
	"timestamp" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"user_id" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"trigger_type" varchar(50) DEFAULT 'MANUAL' NOT NULL,
	"webhook_key" varchar(255),
	"source" varchar(50),
	"schedule_number" integer,
	"schedule_unit" varchar(50),
	"custom_schedule" varchar(255),
	"run_location" varchar(50) DEFAULT 'LOCAL' NOT NULL,
	"override_event_servers" boolean DEFAULT false NOT NULL,
	"override_server_ids" jsonb,
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_servers" ADD CONSTRAINT "event_servers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_servers" ADD CONSTRAINT "event_servers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_deployments" ADD CONSTRAINT "runner_deployments_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_payloads" ADD CONSTRAINT "runner_payloads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_deletion_notifications" ADD CONSTRAINT "server_deletion_notifications_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_deletion_notifications" ADD CONSTRAINT "server_deletion_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_group_members" ADD CONSTRAINT "server_group_members_group_id_server_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."server_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_group_members" ADD CONSTRAINT "server_group_members_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_groups" ADD CONSTRAINT "server_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_logs" ADD CONSTRAINT "tool_action_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_action_templates" ADD CONSTRAINT "tool_action_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit_logs" ADD CONSTRAINT "tool_audit_logs_tool_id_tool_credentials_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_credentials" ADD CONSTRAINT "tool_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_usage_metrics" ADD CONSTRAINT "tool_usage_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connections" ADD CONSTRAINT "workflow_connections_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connections" ADD CONSTRAINT "workflow_connections_source_node_id_workflow_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connections" ADD CONSTRAINT "workflow_connections_target_node_id_workflow_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_logs" ADD CONSTRAINT "workflow_logs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;