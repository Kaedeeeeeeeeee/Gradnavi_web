CREATE TABLE "professor_search" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"keywords" text NOT NULL,
	"schools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preference" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_guide" ADD COLUMN "announced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admission_guide" ADD COLUMN "previous_events" jsonb;--> statement-breakpoint
ALTER TABLE "graduate_school" ADD COLUMN "requirements" jsonb;--> statement-breakpoint
ALTER TABLE "saved_professor" ADD COLUMN "paper_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_professor" ADD COLUMN "fit" text;--> statement-breakpoint
ALTER TABLE "saved_professor" ADD COLUMN "proposed_follow_up" jsonb;--> statement-breakpoint
ALTER TABLE "saved_professor" ADD COLUMN "school_id" text;--> statement-breakpoint
ALTER TABLE "professor_search" ADD CONSTRAINT "professor_search_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professor_search_user_idx" ON "professor_search" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "saved_professor" ADD CONSTRAINT "saved_professor_school_id_graduate_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."graduate_school"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 让监控下次检查时重新解析一遍，补上入试要点（要不要先联系教授、考试科目、语言要求）。基准不变的要项不会重复通知
UPDATE "graduate_school" SET "content_hash" = NULL;