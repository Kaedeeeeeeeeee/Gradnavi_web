ALTER TABLE "document" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "deleted_at" timestamp with time zone;