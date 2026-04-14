import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  files,
  replicationRuns,
  storeSecrets,
  stores,
  workspaceStorageSettings,
} from "@locker/database";
import { createRouter, workspaceAdminProcedure } from "../init";
import { createStorageFromConfig, type WorkspaceStorageConfig } from "@locker/storage";
import { getStoreById, saveStoreSecret, makeWebFileSourceResolver } from "../../storage";
import { syncWorkspaceStores, ingestFromReadOnlyStore, pullFromStore } from "../../stores/sync";
import type { ConflictStrategy } from "../../stores/sync";
import { runtime } from "../../runtime-context";
import { shouldDelegateToWorkflow } from "../../jobs/dispatch";
import { dispatchSyncWorkspace } from "../../jobs/workflow-client";

const providerSchema = z.enum(["s3", "r2", "vercel_blob", "local"]);
const writeModeSchema = z.enum(["write", "read_only"]);
const ingestModeSchema = z.enum(["none", "scan"]);

const storePayloadSchema = z
  .object({
    name: z.string().min(1).max(255),
    provider: providerSchema,
    writeMode: writeModeSchema.default("write"),
    ingestMode: ingestModeSchema.default("none"),
    readPriority: z.number().int().min(0).max(1000).default(100),
    bucket: z.string().optional(),
    region: z.string().optional(),
    endpoint: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
        message: "Endpoint must use http:// or https://",
      })
      .optional(),
    accountId: z.string().optional(),
    publicUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
        message: "Public URL must use http:// or https://",
      })
      .optional(),
    baseDir: z.string().optional(),
    rootPrefix: z.string().optional(),
    credentials: z
      .object({
        accessKeyId: z.string().optional(),
        secretAccessKey: z.string().optional(),
        accountId: z.string().optional(),
        readWriteToken: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.writeMode === "read_only" && value.ingestMode === "none") {
      // Read-only is still fine without ingest, so no-op.
    }

    if (value.provider === "s3") {
      if (!value.bucket) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bucket is required for S3 stores",
          path: ["bucket"],
        });
      }
      if (!value.credentials?.accessKeyId || !value.credentials?.secretAccessKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Access key and secret are required for S3 stores",
          path: ["credentials"],
        });
      }
    }

    if (value.provider === "r2") {
      if (!value.bucket) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bucket is required for R2 stores",
          path: ["bucket"],
        });
      }
      if (!value.accountId && !value.credentials?.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Account ID is required for R2 stores",
          path: ["accountId"],
        });
      }
      if (!value.credentials?.accessKeyId || !value.credentials?.secretAccessKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Access key and secret are required for R2 stores",
          path: ["credentials"],
        });
      }
    }

    if (value.provider === "vercel_blob" && !value.credentials?.readWriteToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A Vercel Blob token is required",
        path: ["credentials"],
      });
    }

    if (value.provider === "local" && !value.baseDir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Base directory is required for local stores",
        path: ["baseDir"],
      });
    }
  });

function buildStoreConfig(input: z.infer<typeof storePayloadSchema>) {
  return {
    bucket: input.bucket ?? null,
    region: input.region ?? null,
    endpoint: input.endpoint ?? null,
    accountId: input.accountId ?? input.credentials?.accountId ?? null,
    publicUrl: input.publicUrl ?? null,
    baseDir: input.baseDir ?? null,
    rootPrefix: input.rootPrefix ?? null,
  } satisfies Record<string, string | null>;
}

function buildRuntimeConfig(input: z.infer<typeof storePayloadSchema>): WorkspaceStorageConfig {
  if (input.provider === "s3") {
    return {
      provider: "s3",
      bucket: input.bucket,
      region: input.region,
      endpoint: input.endpoint,
      credentials: {
        provider: "s3",
        accessKeyId: input.credentials!.accessKeyId!,
        secretAccessKey: input.credentials!.secretAccessKey!,
      },
    };
  }

  if (input.provider === "r2") {
    return {
      provider: "r2",
      bucket: input.bucket,
      accountId: input.accountId ?? input.credentials?.accountId,
      publicUrl: input.publicUrl,
      credentials: {
        provider: "r2",
        accountId: input.accountId ?? input.credentials!.accountId!,
        accessKeyId: input.credentials!.accessKeyId!,
        secretAccessKey: input.credentials!.secretAccessKey!,
      },
    };
  }

  if (input.provider === "vercel_blob") {
    return {
      provider: "vercel_blob",
      credentials: {
        provider: "vercel_blob",
        readWriteToken: input.credentials!.readWriteToken!,
      },
    };
  }

  return {
    provider: "local",
    baseDir: input.baseDir,
  };
}

async function testStoreConnection(input: z.infer<typeof storePayloadSchema>) {
  const storage = createStorageFromConfig(buildRuntimeConfig(input));
  const testPath = `.locker-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await storage.upload({
    path: testPath,
    data: Buffer.from("locker-store-test"),
    contentType: "text/plain",
  });
  await storage.delete(testPath).catch(() => {});
}

export const storesRouter = createRouter({
  list: workspaceAdminProcedure.query(async ({ ctx }) => {
    const [settings] = await ctx.db
      .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
      .from(workspaceStorageSettings)
      .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId))
      .limit(1);

    const rows = await ctx.db
      .select({
        id: stores.id,
        name: stores.name,
        provider: stores.provider,
        credentialSource: stores.credentialSource,
        status: stores.status,
        writeMode: stores.writeMode,
        ingestMode: stores.ingestMode,
        readPriority: stores.readPriority,
        config: stores.config,
        lastTestedAt: stores.lastTestedAt,
        lastSyncedAt: stores.lastSyncedAt,
        createdAt: stores.createdAt,
        updatedAt: stores.updatedAt,
        hasStoredSecret: sql<boolean>`${storeSecrets.storeId} is not null`,
      })
      .from(stores)
      .leftJoin(storeSecrets, eq(storeSecrets.storeId, stores.id))
      .where(and(eq(stores.workspaceId, ctx.workspaceId), eq(stores.status, "active")))
      .orderBy(asc(stores.readPriority), asc(stores.createdAt));

    return rows.map((row) => ({
      ...row,
      isPrimary: row.id === settings?.primaryStoreId,
    }));
  }),

  get: workspaceAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [settings] = await ctx.db
        .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
        .from(workspaceStorageSettings)
        .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId))
        .limit(1);

      const [row] = await ctx.db
        .select({
          id: stores.id,
          name: stores.name,
          provider: stores.provider,
          credentialSource: stores.credentialSource,
          status: stores.status,
          writeMode: stores.writeMode,
          ingestMode: stores.ingestMode,
          readPriority: stores.readPriority,
          config: stores.config,
          lastTestedAt: stores.lastTestedAt,
          lastSyncedAt: stores.lastSyncedAt,
          createdAt: stores.createdAt,
          updatedAt: stores.updatedAt,
          hasStoredSecret: sql<boolean>`${storeSecrets.storeId} is not null`,
        })
        .from(stores)
        .leftJoin(storeSecrets, eq(storeSecrets.storeId, stores.id))
        .where(and(eq(stores.id, input.id), eq(stores.workspaceId, ctx.workspaceId)))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }

      return {
        ...row,
        isPrimary: row.id === settings?.primaryStoreId,
      };
    }),

  create: workspaceAdminProcedure
    .input(storePayloadSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.provider === "local" && !runtime.localFilesystemAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Local storage is not available on this runtime (${runtime.environment}). Choose a cloud storage provider.`,
        });
      }

      await testStoreConnection(input);

      const [existingSettings] = await ctx.db
        .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
        .from(workspaceStorageSettings)
        .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId))
        .limit(1);

      if (!existingSettings && input.writeMode === "read_only") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The first store cannot be read-only",
        });
      }

      return ctx.db.transaction(async (tx) => {
        const [store] = await tx
          .insert(stores)
          .values({
            workspaceId: ctx.workspaceId,
            name: input.name,
            provider: input.provider,
            credentialSource: "store",
            status: "active",
            writeMode: input.writeMode,
            ingestMode: input.ingestMode,
            readPriority: input.readPriority,
            config: buildStoreConfig(input),
            lastTestedAt: new Date(),
          })
          .returning({ id: stores.id });

        if (input.credentials) {
          await saveStoreSecret(store!.id, input.credentials, tx);
        }

        if (!existingSettings) {
          await tx
            .insert(workspaceStorageSettings)
            .values({
              workspaceId: ctx.workspaceId,
              primaryStoreId: store!.id,
            })
            .onConflictDoNothing();
        }

        return { id: store!.id };
      });
    }),

  update: workspaceAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        store: storePayloadSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.store.provider === "local" && !runtime.localFilesystemAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Local storage is not available on this runtime (${runtime.environment}). Choose a cloud storage provider.`,
        });
      }

      const [existing] = await ctx.db
        .select({
          id: stores.id,
          workspaceId: stores.workspaceId,
        })
        .from(stores)
        .where(and(eq(stores.id, input.id), eq(stores.workspaceId, ctx.workspaceId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }

      const [settings] = await ctx.db
        .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
        .from(workspaceStorageSettings)
        .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId))
        .limit(1);

      if (
        settings?.primaryStoreId === input.id &&
        input.store.writeMode === "read_only"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Primary stores must remain writable",
        });
      }

      await testStoreConnection(input.store);

      return ctx.db.transaction(async (tx) => {
        await tx
          .update(stores)
          .set({
            name: input.store.name,
            provider: input.store.provider,
            ...(input.store.credentials ? { credentialSource: "store" as const } : {}),
            writeMode: input.store.writeMode,
            ingestMode: input.store.ingestMode,
            readPriority: input.store.readPriority,
            config: buildStoreConfig(input.store),
            updatedAt: new Date(),
            lastTestedAt: new Date(),
          })
          .where(eq(stores.id, input.id));

        if (input.store.credentials) {
          await saveStoreSecret(input.id, input.store.credentials, tx);
        }

        return { success: true };
      });
    }),

  remove: workspaceAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const activeStores = await tx
          .select({ id: stores.id })
          .from(stores)
          .where(and(eq(stores.workspaceId, ctx.workspaceId), eq(stores.status, "active")));

        if (activeStores.length <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A workspace must keep at least one active store",
          });
        }

        const [settings] = await tx
          .select({ primaryStoreId: workspaceStorageSettings.primaryStoreId })
          .from(workspaceStorageSettings)
          .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId))
          .limit(1);

        if (settings?.primaryStoreId === input.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Set another store as primary before removing this one",
          });
        }

        await tx
          .update(stores)
          .set({
            status: "archived",
            updatedAt: new Date(),
          })
          .where(and(eq(stores.id, input.id), eq(stores.workspaceId, ctx.workspaceId)));

        return { success: true };
      });
    }),

  setPrimary: workspaceAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select({
          id: stores.id,
          writeMode: stores.writeMode,
          status: stores.status,
        })
        .from(stores)
        .where(and(eq(stores.id, input.id), eq(stores.workspaceId, ctx.workspaceId)))
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }
      if (target.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only active stores can be primary",
        });
      }
      if (target.writeMode !== "write") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Read-only stores cannot be primary",
        });
      }

      const [existing] = await ctx.db
        .select({ workspaceId: workspaceStorageSettings.workspaceId })
        .from(workspaceStorageSettings)
        .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId))
        .limit(1);

      if (existing) {
        await ctx.db
          .update(workspaceStorageSettings)
          .set({
            primaryStoreId: input.id,
            updatedAt: new Date(),
          })
          .where(eq(workspaceStorageSettings.workspaceId, ctx.workspaceId));
      } else {
        await ctx.db.insert(workspaceStorageSettings).values({
          workspaceId: ctx.workspaceId,
          primaryStoreId: input.id,
        });
      }

      return { success: true };
    }),

  test: workspaceAdminProcedure
    .input(storePayloadSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.provider === "local" && !runtime.localFilesystemAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Local storage is not available on this runtime (${runtime.environment}). Choose a cloud storage provider.`,
        });
      }

      await testStoreConnection(input);
      return { success: true };
    }),

  sync: workspaceAdminProcedure
    .input(
      z
        .object({
          storeId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!runtime.longRunningSupported && !runtime.taskQueueAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Store sync requires a persistent runtime or task queue. Not supported on ${runtime.environment}.`,
        });
      }

      if (shouldDelegateToWorkflow()) {
        const workspaceFiles = await ctx.db
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.workspaceId, ctx.workspaceId),
              eq(files.status, "ready"),
            ),
          );

        const [run] = await ctx.db
          .insert(replicationRuns)
          .values({
            workspaceId: ctx.workspaceId,
            kind: "manual_sync",
            status: "queued",
            targetStoreId: input?.storeId ?? null,
            triggeredByUserId: ctx.userId,
            totalItems: workspaceFiles.length,
          })
          .returning({ id: replicationRuns.id });

        try {
          await dispatchSyncWorkspace({
            runId: run!.id,
            workspaceId: ctx.workspaceId,
            targetStoreId: input?.storeId,
            triggeredByUserId: ctx.userId,
          });
        } catch (err) {
          await ctx.db
            .update(replicationRuns)
            .set({
              status: "failed",
              errorMessage:
                err instanceof Error
                  ? err.message
                  : "Failed to dispatch to task queue",
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(replicationRuns.id, run!.id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to dispatch sync to task queue",
          });
        }

        return { runId: run!.id };
      }

      return syncWorkspaceStores({
        workspaceId: ctx.workspaceId,
        targetStoreId: input?.storeId,
        triggeredByUserId: ctx.userId,
        resolveFileSource: makeWebFileSourceResolver(),
      });
    }),

  syncStatus: workspaceAdminProcedure
    .input(
      z
        .object({
          storeId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(replicationRuns)
        .where(
          input?.storeId
            ? and(
                eq(replicationRuns.workspaceId, ctx.workspaceId),
                eq(replicationRuns.targetStoreId, input.storeId),
              )
            : eq(replicationRuns.workspaceId, ctx.workspaceId),
        )
        .orderBy(desc(replicationRuns.createdAt))
        .limit(10);
    }),

  ingest: workspaceAdminProcedure
    .input(z.object({ storeId: z.string().uuid(), clearTombstones: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!runtime.longRunningSupported) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Store ingest requires a persistent runtime. This operation is not supported on ${runtime.environment}.`,
        });
      }

      const { store } = await getStoreById(input.storeId);
      if (store.workspaceId !== ctx.workspaceId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Store not found" });
      }

      return ingestFromReadOnlyStore({
        storeId: input.storeId,
        triggeredByUserId: ctx.userId,
        clearTombstones: input.clearTombstones,
      });
    }),

  push: workspaceAdminProcedure
    .input(
      z.object({
        storeId: z.string().uuid().optional(),
        conflictStrategy: z.enum(["skip", "keep_newer", "overwrite"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!runtime.longRunningSupported && !runtime.taskQueueAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Push requires a persistent runtime or task queue. Not supported on ${runtime.environment}.`,
        });
      }

      if (shouldDelegateToWorkflow()) {
        const workspaceFiles = await ctx.db
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.workspaceId, ctx.workspaceId),
              eq(files.status, "ready"),
            ),
          );

        const [run] = await ctx.db
          .insert(replicationRuns)
          .values({
            workspaceId: ctx.workspaceId,
            kind: "manual_push",
            status: "queued",
            targetStoreId: input.storeId ?? null,
            triggeredByUserId: ctx.userId,
            totalItems: workspaceFiles.length,
          })
          .returning({ id: replicationRuns.id });

        try {
          await dispatchSyncWorkspace({
            runId: run!.id,
            workspaceId: ctx.workspaceId,
            targetStoreId: input.storeId,
            triggeredByUserId: ctx.userId,
            conflictStrategy: input.conflictStrategy,
          });
        } catch (err) {
          await ctx.db
            .update(replicationRuns)
            .set({
              status: "failed",
              errorMessage:
                err instanceof Error
                  ? err.message
                  : "Failed to dispatch to task queue",
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(replicationRuns.id, run!.id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to dispatch push to task queue",
          });
        }

        return { runId: run!.id };
      }

      return syncWorkspaceStores({
        workspaceId: ctx.workspaceId,
        targetStoreId: input.storeId,
        triggeredByUserId: ctx.userId,
        conflictStrategy: input.conflictStrategy,
        kind: "manual_push",
        resolveFileSource: makeWebFileSourceResolver(),
      });
    }),

  pull: workspaceAdminProcedure
    .input(
      z.object({
        storeId: z.string().uuid(),
        conflictStrategy: z.enum(["skip", "keep_newer", "overwrite"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!runtime.longRunningSupported) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Pull requires a persistent runtime. Not supported on ${runtime.environment}.`,
        });
      }

      const { store } = await getStoreById(input.storeId);
      if (store.workspaceId !== ctx.workspaceId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Store not found" });
      }

      return pullFromStore({
        storeId: input.storeId,
        conflictStrategy: input.conflictStrategy,
        triggeredByUserId: ctx.userId,
      });
    }),
});
