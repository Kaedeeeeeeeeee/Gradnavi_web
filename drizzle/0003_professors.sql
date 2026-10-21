CREATE TABLE "saved_professor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"university" text NOT NULL,
	"department" text,
	"lab" text,
	"research" text,
	"papers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepts_international" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'to_contact' NOT NULL,
	"note" text,
	"follow_up_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_professor" ADD CONSTRAINT "saved_professor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_professor_user_name_univ_idx" ON "saved_professor" USING btree ("user_id","name","university");