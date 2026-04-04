CREATE TABLE "file_transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_slug" varchar(80) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_transcriptions" ADD CONSTRAINT "file_transcriptions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_transcriptions" ADD CONSTRAINT "file_transcriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_transcriptions_file_plugin_idx" ON "file_transcriptions" USING btree ("file_id","plugin_slug");--> statement-breakpoint
CREATE INDEX "file_transcriptions_workspace_idx" ON "file_transcriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "file_transcriptions_file_idx" ON "file_transcriptions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_transcriptions_status_idx" ON "file_transcriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_storage_configs_active_workspace_idx" ON "workspace_storage_configs" USING btree ("workspace_id") WHERE "is_active" = true;