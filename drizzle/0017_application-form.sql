CREATE TABLE "application_form" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"source_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_pages" integer DEFAULT 0 NOT NULL,
	"pdf" "bytea" NOT NULL,
	"mode" text NOT NULL,
	"layout" jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handwriting" jsonb,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"professor_id" text,
	"school_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_form" ADD CONSTRAINT "application_form_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_form" ADD CONSTRAINT "application_form_professor_id_saved_professor_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."saved_professor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_form" ADD CONSTRAINT "application_form_school_id_graduate_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."graduate_school"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_form_user_idx" ON "application_form" USING btree ("user_id","updated_at");