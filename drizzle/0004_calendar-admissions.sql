CREATE TABLE "admission_guide" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_year" integer NOT NULL,
	"title" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"end_date" date,
	"kind" text DEFAULT 'other' NOT NULL,
	"note" text,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graduate_school" (
	"id" text PRIMARY KEY NOT NULL,
	"university" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"content_hash" text,
	"checked_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"check_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_watch" (
	"user_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_watch_user_id_school_id_pk" PRIMARY KEY("user_id","school_id")
);
--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "professor_id" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "admission_guide" ADD CONSTRAINT "admission_guide_school_id_graduate_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."graduate_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_watch" ADD CONSTRAINT "school_watch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_watch" ADD CONSTRAINT "school_watch_school_id_graduate_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."graduate_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_guide_school_year_idx" ON "admission_guide" USING btree ("school_id","admission_year");--> statement-breakpoint
CREATE INDEX "calendar_event_user_date_idx" ON "calendar_event" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "graduate_school_univ_name_idx" ON "graduate_school" USING btree ("university","name");--> statement-breakpoint
CREATE INDEX "school_watch_school_idx" ON "school_watch" USING btree ("school_id");--> statement-breakpoint
ALTER TABLE "todo" ADD CONSTRAINT "todo_professor_id_saved_professor_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."saved_professor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo" ADD CONSTRAINT "todo_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;