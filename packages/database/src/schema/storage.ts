import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  bigint,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workspaces } from './workspaces';
import { users } from './users';
import { files } from './files';

export const storeProviderEnum = pgEnum('store_provider', [
  's3',
  'r2',
  'vercel_blob',
  'local',
]);

export const storeCredentialSourceEnum = pgEnum('store_credential_source', [
  'platform',
  'store',
]);

export const storeStatusEnum = pgEnum('store_status', [
  'active',
  'disabled',
  'archived',
]);

export const storeWriteModeEnum = pgEnum('store_write_mode', [
  'write',
  'read_only',
]);

export const storeIngestModeEnum = pgEnum('store_ingest_mode', [
  'none',
  'scan',
]);

export const blobStateEnum = pgEnum('blob_state', [
  'pending',
  'ready',
  'failed',
  'deleted',
]);

export const blobLocationStateEnum = pgEnum('blob_location_state', [
  'pending',
  'available',
  'failed',
  'missing',
]);

export const blobLocationOriginEnum = pgEnum('blob_location_origin', [
  'primary_upload',
  'replicated',
  'ingested',
  'manual_import',
]);

export const replicationRunKindEnum = pgEnum('replication_run_kind', [
  'upload_fanout',
  'manual_sync',
  'repair',
  'ingest',
  'rebalance',
  'manual_pull',
  'manual_push',
]);

export const replicationRunStatusEnum = pgEnum('replication_run_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
]);

export const replicationRunItemStatusEnum = pgEnum(
  'replication_run_item_status',
  ['pending', 'running', 'completed', 'failed', 'skipped'],
);

export const ingestTombstoneReasonEnum = pgEnum('ingest_tombstone_reason', [
  'user_deleted',
  'manual_ignore',
  'store_cleanup',
]);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    provider: storeProviderEnum('provider').notNull(),
    credentialSource: storeCredentialSourceEnum('credential_source')
      .notNull()
      .default('store'),
    status: storeStatusEnum('status').notNull().default('active'),
    writeMode: storeWriteModeEnum('write_mode').notNull().default('write'),
    ingestMode: storeIngestModeEnum('ingest_mode')
      .notNull()
      .default('none'),
    readPriority: integer('read_priority').notNull().default(100),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    lastTestedAt: timestamp('last_tested_at'),
    lastSyncedAt: timestamp('last_synced_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('stores_workspace_id_idx').on(table.workspaceId),
    index('stores_workspace_status_idx').on(table.workspaceId, table.status),
    index('stores_workspace_read_priority_idx').on(
      table.workspaceId,
      table.readPriority,
    ),
  ],
);

export const storeSecrets = pgTable('store_secrets', {
  storeId: uuid('store_id')
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workspaceStorageSettings = pgTable(
  'workspace_storage_settings',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    primaryStoreId: uuid('primary_store_id')
      .notNull()
      .references(() => stores.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('workspace_storage_settings_primary_store_idx').on(
      table.primaryStoreId,
    ),
  ],
);

export const fileBlobs = pgTable(
  'file_blobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    objectKey: text('object_key').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    checksum: varchar('checksum', { length: 128 }),
    state: blobStateEnum('state').notNull().default('pending'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('file_blobs_workspace_object_key_idx').on(
      table.workspaceId,
      table.objectKey,
    ),
    index('file_blobs_workspace_state_idx').on(table.workspaceId, table.state),
    index('file_blobs_workspace_checksum_idx').on(
      table.workspaceId,
      table.checksum,
    ),
  ],
);

export const blobLocations = pgTable(
  'blob_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    blobId: uuid('blob_id')
      .notNull()
      .references(() => fileBlobs.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    state: blobLocationStateEnum('state').notNull().default('pending'),
    origin: blobLocationOriginEnum('origin').notNull(),
    lastVerifiedAt: timestamp('last_verified_at'),
    lastError: text('last_error'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('blob_locations_blob_store_idx').on(table.blobId, table.storeId),
    uniqueIndex('blob_locations_store_path_idx').on(
      table.storeId,
      table.storagePath,
    ),
    index('blob_locations_store_state_idx').on(table.storeId, table.state),
    index('blob_locations_blob_id_idx').on(table.blobId),
  ],
);

export const replicationRuns = pgTable(
  'replication_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: replicationRunKindEnum('kind').notNull(),
    status: replicationRunStatusEnum('status').notNull().default('queued'),
    sourceStoreId: uuid('source_store_id').references(() => stores.id, {
      onDelete: 'set null',
    }),
    targetStoreId: uuid('target_store_id').references(() => stores.id, {
      onDelete: 'set null',
    }),
    triggeredByUserId: text('triggered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    totalItems: integer('total_items').notNull().default(0),
    processedItems: integer('processed_items').notNull().default(0),
    failedItems: integer('failed_items').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('replication_runs_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    index('replication_runs_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const replicationRunItems = pgTable(
  'replication_run_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => replicationRuns.id, { onDelete: 'cascade' }),
    blobId: uuid('blob_id')
      .notNull()
      .references(() => fileBlobs.id, { onDelete: 'cascade' }),
    sourceStoreId: uuid('source_store_id').references(() => stores.id, {
      onDelete: 'set null',
    }),
    targetStoreId: uuid('target_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    status: replicationRunItemStatusEnum('status')
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('replication_run_items_run_blob_target_idx').on(
      table.runId,
      table.blobId,
      table.targetStoreId,
    ),
    index('replication_run_items_run_status_idx').on(table.runId, table.status),
    index('replication_run_items_target_status_idx').on(
      table.targetStoreId,
      table.status,
    ),
  ],
);

export const ingestTombstones = pgTable(
  'ingest_tombstones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    externalPath: text('external_path').notNull(),
    deletedBlobId: uuid('deleted_blob_id').references(() => fileBlobs.id, {
      onDelete: 'set null',
    }),
    deletedByUserId: text('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: ingestTombstoneReasonEnum('reason')
      .notNull()
      .default('user_deleted'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ingest_tombstones_store_path_idx').on(
      table.storeId,
      table.externalPath,
    ),
    index('ingest_tombstones_workspace_id_idx').on(table.workspaceId),
  ],
);

export const storesRelations = relations(stores, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [stores.workspaceId],
    references: [workspaces.id],
  }),
  secret: one(storeSecrets, {
    fields: [stores.id],
    references: [storeSecrets.storeId],
  }),
  blobLocations: many(blobLocations),
}));

export const storeSecretsRelations = relations(storeSecrets, ({ one }) => ({
  store: one(stores, {
    fields: [storeSecrets.storeId],
    references: [stores.id],
  }),
}));

export const workspaceStorageSettingsRelations = relations(
  workspaceStorageSettings,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceStorageSettings.workspaceId],
      references: [workspaces.id],
    }),
    primaryStore: one(stores, {
      fields: [workspaceStorageSettings.primaryStoreId],
      references: [stores.id],
    }),
  }),
);

export const fileBlobsRelations = relations(fileBlobs, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [fileBlobs.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [fileBlobs.createdById],
    references: [users.id],
  }),
  files: many(files),
  locations: many(blobLocations),
}));

export const blobLocationsRelations = relations(blobLocations, ({ one }) => ({
  blob: one(fileBlobs, {
    fields: [blobLocations.blobId],
    references: [fileBlobs.id],
  }),
  store: one(stores, {
    fields: [blobLocations.storeId],
    references: [stores.id],
  }),
}));

export const replicationRunsRelations = relations(
  replicationRuns,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [replicationRuns.workspaceId],
      references: [workspaces.id],
    }),
    sourceStore: one(stores, {
      fields: [replicationRuns.sourceStoreId],
      references: [stores.id],
      relationName: 'replicationRunSourceStore',
    }),
    targetStore: one(stores, {
      fields: [replicationRuns.targetStoreId],
      references: [stores.id],
      relationName: 'replicationRunTargetStore',
    }),
    triggeredBy: one(users, {
      fields: [replicationRuns.triggeredByUserId],
      references: [users.id],
    }),
    items: many(replicationRunItems),
  }),
);

export const replicationRunItemsRelations = relations(
  replicationRunItems,
  ({ one }) => ({
    run: one(replicationRuns, {
      fields: [replicationRunItems.runId],
      references: [replicationRuns.id],
    }),
    blob: one(fileBlobs, {
      fields: [replicationRunItems.blobId],
      references: [fileBlobs.id],
    }),
    sourceStore: one(stores, {
      fields: [replicationRunItems.sourceStoreId],
      references: [stores.id],
      relationName: 'replicationRunItemSourceStore',
    }),
    targetStore: one(stores, {
      fields: [replicationRunItems.targetStoreId],
      references: [stores.id],
      relationName: 'replicationRunItemTargetStore',
    }),
  }),
);

export const ingestTombstonesRelations = relations(
  ingestTombstones,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [ingestTombstones.workspaceId],
      references: [workspaces.id],
    }),
    store: one(stores, {
      fields: [ingestTombstones.storeId],
      references: [stores.id],
    }),
    deletedBlob: one(fileBlobs, {
      fields: [ingestTombstones.deletedBlobId],
      references: [fileBlobs.id],
    }),
    deletedBy: one(users, {
      fields: [ingestTombstones.deletedByUserId],
      references: [users.id],
    }),
  }),
);
