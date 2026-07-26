ALTER TABLE "tool_credentials" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tool_credentials" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;