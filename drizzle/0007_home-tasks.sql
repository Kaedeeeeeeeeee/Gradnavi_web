ALTER TABLE "ai_conversation" ADD COLUMN "todo_id" text;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "proposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "proposed_change" jsonb;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "status" text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "proposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "proposed_change" jsonb;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "school_id" text;--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_todo_id_todo_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo" ADD CONSTRAINT "todo_school_id_graduate_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."graduate_school"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversation_todo_idx" ON "ai_conversation" USING btree ("todo_id");--> statement-breakpoint
-- 已勾选的 Todo 迁成「完成」
UPDATE "todo" SET "status" = 'done' WHERE "done" = true;