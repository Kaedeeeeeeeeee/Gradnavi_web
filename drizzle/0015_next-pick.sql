CREATE TABLE "next_pick" (
	"user_id" text PRIMARY KEY NOT NULL,
	"input_key" text NOT NULL,
	"pick" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "prep_days" integer;--> statement-breakpoint
ALTER TABLE "next_pick" ADD CONSTRAINT "next_pick_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;