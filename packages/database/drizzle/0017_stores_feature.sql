CREATE TYPE "public"."store_provider" AS ENUM('s3', 'r2', 'vercel_blob', 'local');
--> statement-breakpoint
CREATE TYPE "public"."store_credential_source" AS ENUM('platform', 'store');
--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('active', 'disabled', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."store_write_mode" AS ENUM('write', 'read_only');
--> statement-breakpoint
CREATE TYPE "public"."store_ingest_mode" AS ENUM('none', 'scan');
--> statement-breakpoint
CREATE TYPE "public"."blob_state" AS ENUM('pending', 'ready', 'failed', 'deleted');
--> statement-breakpoint
CREATE TYPE "public"."blob_location_state" AS ENUM('pending', 'available', 'failed', 'missing');
--> statement-breakpoint
CREATE TYPE "public"."blob_location_origin" AS ENUM('primary_upload', 'replicated', 'ingested', 'manual_import');
--> statement-breakpoint
CREATE TYPE "public"."replication_run_kind" AS ENUM('upload_fanout', 'manual_sync', 'repair', 'ingest', 'rebalance');
--> statement-breakpoint
CREATE TYPE "public"."replication_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'canceled');
--> statement-breakpoint
CREATE TYPE "public"."replication_run_item_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');
--> statement-breakpoint
CREATE TYPE "public"."ingest_tombstone_reason" AS ENUM('user_deleted', 'manual_ignore', 'store_cleanup');
--> statement-breakpoint

CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider" "store_provider" NOT NULL,
	"credential_source" "store_credential_source" DEFAULT 'store' NOT NULL,
	"status" "store_status" DEFAULT 'active' NOT NULL,
	"write_mode" "store_write_mode" DEFAULT 'write' NOT NULL,
	"ingest_mode" "store_ingest_mode" DEFAULT 'none' NOT NULL,
	"read_priority" integer DEFAULT 100 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tested_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_secrets" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_storage_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"primary_store_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by_id" text,
	"object_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"checksum" varchar(128),
	"state" "blob_state" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"state" "blob_location_state" DEFAULT 'pending' NOT NULL,
	"origin" "blob_location_origin" NOT NULL,
	"last_verified_at" timestamp,
	"last_error" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replication_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "replication_run_kind" NOT NULL,
	"status" "replication_run_status" DEFAULT 'queued' NOT NULL,
	"source_store_id" uuid,
	"target_store_id" uuid,
	"triggered_by_user_id" text,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replication_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"blob_id" uuid NOT NULL,
	"source_store_id" uuid,
	"target_store_id" uuid NOT NULL,
	"status" "replication_run_item_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_path" text NOT NULL,
	"deleted_blob_id" uuid,
	"deleted_by_user_id" text,
	"reason" "ingest_tombstone_reason" DEFAULT 'user_deleted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "files" ADD COLUMN "blob_id" uuid;
--> statement-breakpoint

INSERT INTO "file_blobs" (
	"id",
	"workspace_id",
	"created_by_id",
	"object_key",
	"byte_size",
	"mime_type",
	"checksum",
	"state",
	"created_at",
	"updated_at"
)
SELECT
	"files"."id",
	"files"."workspace_id",
	"files"."user_id",
	"files"."storage_path",
	"files"."size",
	"files"."mime_type",
	"files"."checksum",
	CASE WHEN "files"."status" = 'ready' THEN 'ready'::"blob_state" ELSE 'pending'::"blob_state" END,
	"files"."created_at",
	"files"."updated_at"
FROM "files";
--> statement-breakpoint

UPDATE "files" SET "blob_id" = "id";
--> statement-breakpoint

ALTER TABLE "files" ALTER COLUMN "blob_id" SET NOT NULL;
--> statement-breakpoint

-- Migrate active BYOB configs into stores + store_secrets + workspace_storage_settings.
-- Must happen BEFORE storage_config_id is dropped from files.
INSERT INTO "stores" (
	"id",
	"workspace_id",
	"name",
	"provider",
	"credential_source",
	"status",
	"write_mode",
	"ingest_mode",
	"read_priority",
	"config",
	"last_tested_at",
	"created_at",
	"updated_at"
)
SELECT
	wsc."id",
	wsc."workspace_id",
	'BYOB ' || wsc."provider",
	CASE wsc."provider"
		WHEN 'vercel' THEN 'vercel_blob'::"store_provider"
		ELSE wsc."provider"::"store_provider"
	END,
	'store'::"store_credential_source",
	'active'::"store_status",
	'write'::"store_write_mode",
	'none'::"store_ingest_mode",
	100,
	jsonb_build_object(
		'bucket', wsc."bucket",
		'region', wsc."region",
		'endpoint', wsc."endpoint"
	),
	wsc."last_tested_at",
	wsc."created_at",
	wsc."updated_at"
FROM "workspace_storage_configs" wsc
WHERE wsc."is_active" = true;
--> statement-breakpoint

INSERT INTO "store_secrets" (
	"store_id",
	"encrypted_credentials",
	"created_at",
	"updated_at"
)
SELECT
	wsc."id",
	wsc."encrypted_credentials",
	wsc."created_at",
	wsc."updated_at"
FROM "workspace_storage_configs" wsc
WHERE wsc."is_active" = true;
--> statement-breakpoint

INSERT INTO "workspace_storage_settings" (
	"workspace_id",
	"primary_store_id",
	"created_at",
	"updated_at"
)
SELECT
	wsc."workspace_id",
	wsc."id",
	wsc."created_at",
	wsc."updated_at"
FROM "workspace_storage_configs" wsc
WHERE wsc."is_active" = true;
--> statement-breakpoint

-- Create blob_locations for files that were stored in BYOB buckets.
INSERT INTO "blob_locations" (
	"blob_id",
	"store_id",
	"storage_path",
	"state",
	"origin",
	"last_verified_at",
	"created_at",
	"updated_at"
)
SELECT
	f."blob_id",
	f."storage_config_id",
	f."storage_path",
	CASE WHEN f."status" = 'ready' THEN 'available'::"blob_location_state" ELSE 'pending'::"blob_location_state" END,
	'primary_upload'::"blob_location_origin",
	f."updated_at",
	f."created_at",
	f."updated_at"
FROM "files" f
WHERE f."storage_config_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "stores" s WHERE s."id" = f."storage_config_id");
--> statement-breakpoint

ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_storage_config_id_workspace_storage_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "storage_config_id";
--> statement-breakpoint

ALTER TABLE "stores" ADD CONSTRAINT "stores_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_secrets" ADD CONSTRAINT "store_secrets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_storage_settings" ADD CONSTRAINT "workspace_storage_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_storage_settings" ADD CONSTRAINT "workspace_storage_settings_primary_store_id_stores_id_fk" FOREIGN KEY ("primary_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blob_locations" ADD CONSTRAINT "blob_locations_blob_id_file_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."file_blobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blob_locations" ADD CONSTRAINT "blob_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_runs" ADD CONSTRAINT "replication_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_runs" ADD CONSTRAINT "replication_runs_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_runs" ADD CONSTRAINT "replication_runs_target_store_id_stores_id_fk" FOREIGN KEY ("target_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_runs" ADD CONSTRAINT "replication_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_run_items" ADD CONSTRAINT "replication_run_items_run_id_replication_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."replication_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_run_items" ADD CONSTRAINT "replication_run_items_blob_id_file_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."file_blobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_run_items" ADD CONSTRAINT "replication_run_items_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replication_run_items" ADD CONSTRAINT "replication_run_items_target_store_id_stores_id_fk" FOREIGN KEY ("target_store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ingest_tombstones" ADD CONSTRAINT "ingest_tombstones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ingest_tombstones" ADD CONSTRAINT "ingest_tombstones_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ingest_tombstones" ADD CONSTRAINT "ingest_tombstones_deleted_blob_id_file_blobs_id_fk" FOREIGN KEY ("deleted_blob_id") REFERENCES "public"."file_blobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ingest_tombstones" ADD CONSTRAINT "ingest_tombstones_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_blob_id_file_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."file_blobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "stores_workspace_id_idx" ON "stores" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "stores_workspace_status_idx" ON "stores" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX "stores_workspace_read_priority_idx" ON "stores" USING btree ("workspace_id","read_priority");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_storage_settings_primary_store_idx" ON "workspace_storage_settings" USING btree ("primary_store_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "file_blobs_workspace_object_key_idx" ON "file_blobs" USING btree ("workspace_id","object_key");
--> statement-breakpoint
CREATE INDEX "file_blobs_workspace_state_idx" ON "file_blobs" USING btree ("workspace_id","state");
--> statement-breakpoint
CREATE INDEX "file_blobs_workspace_checksum_idx" ON "file_blobs" USING btree ("workspace_id","checksum");
--> statement-breakpoint
CREATE UNIQUE INDEX "blob_locations_blob_store_idx" ON "blob_locations" USING btree ("blob_id","store_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "blob_locations_store_path_idx" ON "blob_locations" USING btree ("store_id","storage_path");
--> statement-breakpoint
CREATE INDEX "blob_locations_store_state_idx" ON "blob_locations" USING btree ("store_id","state");
--> statement-breakpoint
CREATE INDEX "blob_locations_blob_id_idx" ON "blob_locations" USING btree ("blob_id");
--> statement-breakpoint
CREATE INDEX "replication_runs_workspace_created_idx" ON "replication_runs" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "replication_runs_workspace_status_idx" ON "replication_runs" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "replication_run_items_run_blob_target_idx" ON "replication_run_items" USING btree ("run_id","blob_id","target_store_id");
--> statement-breakpoint
CREATE INDEX "replication_run_items_run_status_idx" ON "replication_run_items" USING btree ("run_id","status");
--> statement-breakpoint
CREATE INDEX "replication_run_items_target_status_idx" ON "replication_run_items" USING btree ("target_store_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_tombstones_store_path_idx" ON "ingest_tombstones" USING btree ("store_id","external_path");
--> statement-breakpoint
CREATE INDEX "ingest_tombstones_workspace_id_idx" ON "ingest_tombstones" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "files_blob_id_idx" ON "files" USING btree ("blob_id");
