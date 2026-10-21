CREATE TABLE "document_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"round" integer NOT NULL,
	"quote" text NOT NULL,
	"body" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"op" jsonb NOT NULL,
	"zh" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"source" text NOT NULL,
	"comment_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"number" integer NOT NULL,
	"markdown" text NOT NULL,
	"zh" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"name" text,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "zh" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "outline" jsonb;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "write_mode" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "parent_version" integer;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "attachment_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "pending_changes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "last_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_comment" ADD CONSTRAINT "document_comment_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_suggestion" ADD CONSTRAINT "document_suggestion_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_comment_doc_idx" ON "document_comment" USING btree ("document_id","round");--> statement-breakpoint
CREATE INDEX "document_suggestion_doc_idx" ON "document_suggestion" USING btree ("document_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_doc_number_idx" ON "document_version" USING btree ("document_id","number");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_parent_id_document_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_attachment_id_document_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_parent_idx" ON "document" USING btree ("parent_id");