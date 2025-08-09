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
ALTER TABLE "events" ADD COLUMN "payload_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runner_deployments" ADD CONSTRAINT "runner_deployments_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_payloads" ADD CONSTRAINT "runner_payloads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;