-- 募集要项监控改为按用户各自跑（各自扣 credit，结果不共用）：检查状态、入试要点搬到 school_watch，要项日程每个用户一份
ALTER TABLE "school_watch" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "check_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_watch" ADD COLUMN "requirements" jsonb;--> statement-breakpoint
UPDATE "school_watch" w SET "url" = g."url", "content_hash" = g."content_hash", "checked_at" = g."checked_at", "changed_at" = g."changed_at", "check_requested_at" = g."check_requested_at", "last_error" = g."last_error", "requirements" = g."requirements" FROM "graduate_school" g WHERE g."id" = w."school_id";--> statement-breakpoint
ALTER TABLE "school_watch" ALTER COLUMN "url" SET NOT NULL;--> statement-breakpoint
DROP INDEX "admission_guide_school_year_idx";--> statement-breakpoint
ALTER TABLE "admission_guide" ADD COLUMN "user_id" text;--> statement-breakpoint
INSERT INTO "admission_guide" ("id", "user_id", "school_id", "admission_year", "title", "events", "source_url", "announced_at", "previous_events", "created_at", "updated_at")
  SELECT gen_random_uuid()::text, w."user_id", a."school_id", a."admission_year", a."title", a."events", a."source_url", a."announced_at", a."previous_events", a."created_at", a."updated_at"
  FROM "admission_guide" a JOIN "school_watch" w ON w."school_id" = a."school_id" WHERE a."user_id" IS NULL;--> statement-breakpoint
DELETE FROM "admission_guide" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "admission_guide" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_guide" ADD CONSTRAINT "admission_guide_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_guide_user_school_year_idx" ON "admission_guide" USING btree ("user_id","school_id","admission_year");--> statement-breakpoint
ALTER TABLE "graduate_school" DROP COLUMN "content_hash";--> statement-breakpoint
ALTER TABLE "graduate_school" DROP COLUMN "checked_at";--> statement-breakpoint
ALTER TABLE "graduate_school" DROP COLUMN "changed_at";--> statement-breakpoint
ALTER TABLE "graduate_school" DROP COLUMN "check_requested_at";--> statement-breakpoint
ALTER TABLE "graduate_school" DROP COLUMN "last_error";--> statement-breakpoint
ALTER TABLE "graduate_school" DROP COLUMN "requirements";
