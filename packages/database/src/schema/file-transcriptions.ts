import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { files } from "./files";
import { workspaces } from "./workspaces";

export const fileTranscriptions = pgTable(
  "file_transcriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pluginSlug: varchar("plugin_slug", { length: 80 }).notNull(),
    content: text("content").notNull().default(""),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("file_transcriptions_file_plugin_idx").on(
      table.fileId,
      table.pluginSlug,
    ),
    index("file_transcriptions_workspace_idx").on(table.workspaceId),
    index("file_transcriptions_file_idx").on(table.fileId),
    index("file_transcriptions_status_idx").on(table.status),
  ],
);

export const fileTranscriptionsRelations = relations(
  fileTranscriptions,
  ({ one }) => ({
    file: one(files, {
      fields: [fileTranscriptions.fileId],
      references: [files.id],
    }),
    workspace: one(workspaces, {
      fields: [fileTranscriptions.workspaceId],
      references: [workspaces.id],
    }),
  }),
);
