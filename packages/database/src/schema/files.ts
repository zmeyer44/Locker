import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { folders } from "./folders";
import { workspaces } from "./workspaces";
import { fileTags } from "./tags";
import { fileBlobs } from "./storage";

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    blobId: uuid("blob_id")
      .notNull()
      .references(() => fileBlobs.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    storagePath: text("storage_path").notNull(),
    storageProvider: varchar("storage_provider", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("ready"),
    thumbnailPath: text("thumbnail_path"),
    checksum: varchar("checksum", { length: 128 }),
    s3Key: text("s3_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  // Additional partial unique indexes managed via raw SQL migration (0019):
  //   files_unique_name_in_folder_idx — UNIQUE (workspace_id, folder_id, name) WHERE status='ready' AND folder_id IS NOT NULL
  //   files_unique_name_at_root_idx   — UNIQUE (workspace_id, name) WHERE status='ready' AND folder_id IS NULL
  (table) => [
    index("files_workspace_id_idx").on(table.workspaceId),
    index("files_user_id_idx").on(table.userId),
    index("files_folder_id_idx").on(table.folderId),
    index("files_blob_id_idx").on(table.blobId),
    index("files_workspace_folder_idx").on(table.workspaceId, table.folderId),
    index("files_workspace_s3key_idx").on(table.workspaceId, table.s3Key),
  ],
);

export const filesRelations = relations(files, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [files.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [files.userId],
    references: [users.id],
  }),
  folder: one(folders, {
    fields: [files.folderId],
    references: [folders.id],
  }),
  blob: one(fileBlobs, {
    fields: [files.blobId],
    references: [fileBlobs.id],
  }),
  fileTags: many(fileTags),
}));
