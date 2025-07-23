ALTER TABLE "logs" ADD COLUMN "event_name" varchar(255);--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "event_type" varchar(50);--> statement-breakpoint
ALTER TABLE "logs" DROP COLUMN "script_name";--> statement-breakpoint
ALTER TABLE "logs" DROP COLUMN "script_type";