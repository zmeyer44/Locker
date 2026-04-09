import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  files,
  folders,
  pluginInvocationLogs,
  pluginRegistryEntries,
  workspacePlugins,
  workspacePluginSecrets,
} from '@locker/database';
import {
  installWorkspacePluginSchema,
  listPluginActionsSchema,
  pluginManifestSchema,
  registerWorkspacePluginSchema,
  runPluginActionSchema,
  setWorkspacePluginStatusSchema,
  type PluginManifest,
  type PluginPermission,
  type PluginStatus,
  updateWorkspacePluginConfigSchema,
} from '@locker/common';
import { createRouter, workspaceProcedure, workspaceAdminProcedure } from '../init';
import { getBuiltinPluginBySlug, getBuiltinPluginCatalog } from '../../plugins/catalog';
import { encryptPluginSecret } from '../../plugins/secrets';
import { dispatchAction, getHandler } from '../../plugins/runtime';
// Ensure built-in handlers are registered
import '../../plugins/handlers';

type PluginConfigValue = string | number | boolean | null;
type PluginConfig = Record<string, PluginConfigValue>;

function parseManifestOrThrow(manifest: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Plugin manifest is invalid',
    });
  }
  return parsed.data;
}

function parseManifestSafe(manifest: unknown): PluginManifest | null {
  const parsed = pluginManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data : null;
}

function normalizeConfig(value: unknown): PluginConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: PluginConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null
    ) {
      result[key] = entry;
    }
  }
  return result;
}

function normalizeGrantedPermissions(value: unknown): PluginPermission[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const filtered = value.filter((permission): permission is PluginPermission =>
    typeof permission === 'string',
  );
  return Array.from(new Set(filtered));
}

function isSubsetOf(
  subset: PluginPermission[],
  superset: PluginPermission[],
): boolean {
  const superSet = new Set(superset);
  return subset.every((permission) => superSet.has(permission));
}

function hasRequiredPermissions(
  grantedPermissions: PluginPermission[],
  requiredPermissions: PluginPermission[],
): boolean {
  const grantedSet = new Set(grantedPermissions);
  return requiredPermissions.every((permission) => grantedSet.has(permission));
}

function missingRequiredConfigFields(params: {
  manifest: PluginManifest;
  config: PluginConfig;
  configuredSecretKeys: Set<string>;
}): string[] {
  const missingFields: string[] = [];

  for (const field of params.manifest.configFields) {
    if (!field.required) continue;

    if (field.type === 'secret') {
      if (!params.configuredSecretKeys.has(field.key)) {
        missingFields.push(field.key);
      }
      continue;
    }

    const value = params.config[field.key];
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);

    if (isMissing) {
      missingFields.push(field.key);
    }
  }

  return missingFields;
}

async function loadWorkspaceCatalog(
  db: ReturnType<typeof import('@locker/database/client').getDb>,
  workspaceId: string,
): Promise<PluginManifest[]> {
  const builtinCatalog = getBuiltinPluginCatalog();
  const customEntries = await db
    .select({
      manifest: pluginRegistryEntries.manifest,
      slug: pluginRegistryEntries.slug,
    })
    .from(pluginRegistryEntries)
    .where(
      and(
        eq(pluginRegistryEntries.workspaceId, workspaceId),
        eq(pluginRegistryEntries.isActive, true),
      ),
    )
    .orderBy(desc(pluginRegistryEntries.updatedAt));

  const catalogBySlug = new Map<string, PluginManifest>();

  for (const manifest of builtinCatalog) {
    catalogBySlug.set(manifest.slug, manifest);
  }

  for (const entry of customEntries) {
    const manifest = parseManifestSafe(entry.manifest);
    if (!manifest) continue;
    if (catalogBySlug.has(manifest.slug)) continue;
    catalogBySlug.set(manifest.slug, manifest);
  }

  return [...catalogBySlug.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function getConfiguredSecretKeysByPlugin(
  db: ReturnType<typeof import('@locker/database/client').getDb>,
  workspacePluginIds: string[],
): Promise<Map<string, Set<string>>> {
  const secretKeyMap = new Map<string, Set<string>>();
  if (workspacePluginIds.length === 0) return secretKeyMap;

  const rows = await db
    .select({
      workspacePluginId: workspacePluginSecrets.workspacePluginId,
      key: workspacePluginSecrets.key,
    })
    .from(workspacePluginSecrets)
    .where(inArray(workspacePluginSecrets.workspacePluginId, workspacePluginIds));

  for (const row of rows) {
    if (!secretKeyMap.has(row.workspacePluginId)) {
      secretKeyMap.set(row.workspacePluginId, new Set());
    }
    secretKeyMap.get(row.workspacePluginId)!.add(row.key);
  }

  return secretKeyMap;
}

async function resolvePluginTarget(params: {
  db: ReturnType<typeof import('@locker/database/client').getDb>;
  workspaceId: string;
  target: 'file' | 'folder' | 'workspace';
  targetId: string;
}) {
  if (params.target === 'workspace') {
    if (params.targetId !== params.workspaceId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Invalid workspace target',
      });
    }
    return { targetType: 'workspace' as const, targetName: 'Workspace' };
  }

  if (params.target === 'file') {
    const [file] = await params.db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(
        and(
          eq(files.id, params.targetId),
          eq(files.workspaceId, params.workspaceId),
        ),
      )
      .limit(1);
    if (!file) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
    }
    return { targetType: 'file' as const, targetName: file.name, file };
  }

  const [folder] = await params.db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(
      and(
        eq(folders.id, params.targetId),
        eq(folders.workspaceId, params.workspaceId),
      ),
    )
    .limit(1);

  if (!folder) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
  }
  return { targetType: 'folder' as const, targetName: folder.name, folder };
}

export const pluginsRouter = createRouter({
  catalog: workspaceProcedure.query(async ({ ctx }) => {
    const [catalog, installedRows] = await Promise.all([
      loadWorkspaceCatalog(ctx.db, ctx.workspaceId),
      ctx.db
        .select({
          id: workspacePlugins.id,
          pluginSlug: workspacePlugins.pluginSlug,
          status: workspacePlugins.status,
          grantedPermissions: workspacePlugins.grantedPermissions,
        })
        .from(workspacePlugins)
        .where(eq(workspacePlugins.workspaceId, ctx.workspaceId)),
    ]);

    const installedBySlug = new Map<
      string,
      {
        id: string;
        status: PluginStatus;
        grantedPermissions: PluginPermission[];
      }
    >();
    for (const row of installedRows) {
      installedBySlug.set(row.pluginSlug, {
        id: row.id,
        status: row.status as PluginStatus,
        grantedPermissions: normalizeGrantedPermissions(row.grantedPermissions),
      });
    }

    return catalog.map((manifest) => ({
      ...manifest,
      installed: installedBySlug.get(manifest.slug) ?? null,
    }));
  }),

  installed: workspaceProcedure.query(async ({ ctx }) => {
    const installedRows = await ctx.db
      .select({
        id: workspacePlugins.id,
        pluginSlug: workspacePlugins.pluginSlug,
        source: workspacePlugins.source,
        manifest: workspacePlugins.manifest,
        grantedPermissions: workspacePlugins.grantedPermissions,
        config: workspacePlugins.config,
        status: workspacePlugins.status,
        createdAt: workspacePlugins.createdAt,
        updatedAt: workspacePlugins.updatedAt,
      })
      .from(workspacePlugins)
      .where(eq(workspacePlugins.workspaceId, ctx.workspaceId))
      .orderBy(desc(workspacePlugins.updatedAt));

    const secretKeysByPlugin = await getConfiguredSecretKeysByPlugin(
      ctx.db,
      installedRows.map((row) => row.id),
    );

    const results = [];
    for (const row of installedRows) {
      const manifest = parseManifestSafe(row.manifest);
      if (!manifest) continue; // Skip plugins with invalid manifests

      const config = normalizeConfig(row.config);
      const configuredSecretKeys = secretKeysByPlugin.get(row.id) ?? new Set();
      const missingConfigFields = missingRequiredConfigFields({
        manifest,
        config,
        configuredSecretKeys,
      });

      results.push({
        id: row.id,
        pluginSlug: row.pluginSlug,
        source: row.source,
        status: row.status as PluginStatus,
        manifest,
        grantedPermissions: normalizeGrantedPermissions(row.grantedPermissions),
        config,
        configuredSecretKeys: [...configuredSecretKeys],
        missingConfigFields,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return results;
  }),

  registerCustom: workspaceAdminProcedure
    .input(registerWorkspacePluginSchema)
    .mutation(async ({ ctx, input }) => {
      const manifest = input.manifest;

      if (getBuiltinPluginBySlug(manifest.slug)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This slug is reserved by a built-in plugin',
        });
      }

      const [entry] = await ctx.db
        .insert(pluginRegistryEntries)
        .values({
          workspaceId: ctx.workspaceId,
          createdById: ctx.userId,
          slug: manifest.slug,
          manifest: { ...manifest, source: 'inhouse' },
          source: 'inhouse',
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [
            pluginRegistryEntries.workspaceId,
            pluginRegistryEntries.slug,
          ],
          set: {
            manifest: { ...manifest, source: 'inhouse' },
            source: 'inhouse',
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      return {
        id: entry!.id,
        slug: entry!.slug,
        source: entry!.source,
        manifest: entry!.manifest,
      };
    }),

  install: workspaceAdminProcedure
    .input(installWorkspacePluginSchema)
    .mutation(async ({ ctx, input }) => {
      const catalog = await loadWorkspaceCatalog(ctx.db, ctx.workspaceId);
      const manifest = catalog.find((entry) => entry.slug === input.slug);
      if (!manifest) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found' });
      }

      const [existing] = await ctx.db
        .select({
          id: workspacePlugins.id,
          config: workspacePlugins.config,
        })
        .from(workspacePlugins)
        .where(
          and(
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
            eq(workspacePlugins.pluginSlug, manifest.slug),
          ),
        )
        .limit(1);

      const requestedPermissions = normalizeGrantedPermissions(
        input.grantedPermissions ?? manifest.permissions,
      );
      if (!isSubsetOf(requestedPermissions, manifest.permissions)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Granted permissions must be a subset of the plugin's declared permissions",
        });
      }

      const nextConfig = {
        ...normalizeConfig(existing?.config),
        ...normalizeConfig(input.config),
      };

      const existingSecretKeys = existing
        ? await getConfiguredSecretKeysByPlugin(ctx.db, [existing.id])
        : new Map<string, Set<string>>();
      const mergedSecretKeys = new Set(
        existing ? [...(existingSecretKeys.get(existing.id) ?? new Set())] : [],
      );
      for (const key of Object.keys(input.secrets ?? {})) {
        mergedSecretKeys.add(key);
      }

      const missingConfigFields = missingRequiredConfigFields({
        manifest,
        config: nextConfig,
        configuredSecretKeys: mergedSecretKeys,
      });
      if (missingConfigFields.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Missing required configuration: ${missingConfigFields.join(', ')}`,
        });
      }

      const [installed] = existing
        ? await ctx.db
            .update(workspacePlugins)
            .set({
              source: manifest.source,
              manifest,
              grantedPermissions: requestedPermissions,
              config: nextConfig,
              status: 'active',
              updatedAt: new Date(),
            })
            .where(eq(workspacePlugins.id, existing.id))
            .returning()
        : await ctx.db
            .insert(workspacePlugins)
            .values({
              workspaceId: ctx.workspaceId,
              installedById: ctx.userId,
              pluginSlug: manifest.slug,
              source: manifest.source,
              manifest,
              grantedPermissions: requestedPermissions,
              config: nextConfig,
              status: 'active',
            })
            .returning();

      for (const [key, value] of Object.entries(input.secrets ?? {})) {
        await ctx.db
          .insert(workspacePluginSecrets)
          .values({
            workspacePluginId: installed!.id,
            key,
            encryptedValue: encryptPluginSecret(value),
          })
          .onConflictDoUpdate({
            target: [workspacePluginSecrets.workspacePluginId, workspacePluginSecrets.key],
            set: {
              encryptedValue: encryptPluginSecret(value),
              updatedAt: new Date(),
            },
          });
      }

      return {
        id: installed!.id,
        pluginSlug: installed!.pluginSlug,
        status: installed!.status as PluginStatus,
      };
    }),

  updateConfig: workspaceAdminProcedure
    .input(updateWorkspacePluginConfigSchema)
    .mutation(async ({ ctx, input }) => {
      const [plugin] = await ctx.db
        .select({
          id: workspacePlugins.id,
          manifest: workspacePlugins.manifest,
          config: workspacePlugins.config,
        })
        .from(workspacePlugins)
        .where(
          and(
            eq(workspacePlugins.id, input.id),
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      if (!plugin) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Installed plugin not found',
        });
      }

      const manifest = parseManifestOrThrow(plugin.manifest);
      const nextConfig = {
        ...normalizeConfig(plugin.config),
        ...normalizeConfig(input.config),
      };

      const existingSecretKeysMap = await getConfiguredSecretKeysByPlugin(ctx.db, [
        plugin.id,
      ]);
      const mergedSecretKeys = new Set(
        [...(existingSecretKeysMap.get(plugin.id) ?? new Set())],
      );
      for (const key of Object.keys(input.secrets ?? {})) {
        mergedSecretKeys.add(key);
      }

      const missingConfigFields = missingRequiredConfigFields({
        manifest,
        config: nextConfig,
        configuredSecretKeys: mergedSecretKeys,
      });
      if (missingConfigFields.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Missing required configuration: ${missingConfigFields.join(', ')}`,
        });
      }

      const [updated] = await ctx.db
        .update(workspacePlugins)
        .set({
          config: nextConfig,
          updatedAt: new Date(),
        })
        .where(eq(workspacePlugins.id, plugin.id))
        .returning({
          id: workspacePlugins.id,
          pluginSlug: workspacePlugins.pluginSlug,
          status: workspacePlugins.status,
        });

      for (const [key, value] of Object.entries(input.secrets ?? {})) {
        await ctx.db
          .insert(workspacePluginSecrets)
          .values({
            workspacePluginId: plugin.id,
            key,
            encryptedValue: encryptPluginSecret(value),
          })
          .onConflictDoUpdate({
            target: [workspacePluginSecrets.workspacePluginId, workspacePluginSecrets.key],
            set: {
              encryptedValue: encryptPluginSecret(value),
              updatedAt: new Date(),
            },
          });
      }

      return updated!;
    }),

  setStatus: workspaceAdminProcedure
    .input(setWorkspacePluginStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(workspacePlugins)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(workspacePlugins.id, input.id),
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
          ),
        )
        .returning({ id: workspacePlugins.id, status: workspacePlugins.status });

      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Installed plugin not found',
        });
      }

      return {
        id: updated.id,
        status: updated.status as PluginStatus,
      };
    }),

  uninstall: workspaceAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Look up plugin slug before deletion for storage cleanup
      const [plugin] = await ctx.db
        .select({ pluginSlug: workspacePlugins.pluginSlug })
        .from(workspacePlugins)
        .where(
          and(
            eq(workspacePlugins.id, input.id),
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      if (plugin) {
        // Clean up any files stored by this plugin
        const { createStorageForWorkspace } = await import("../../storage");
        const { cleanupPluginStorage } = await import("../../plugins/plugin-storage");
        const { storage } = await createStorageForWorkspace(ctx.workspaceId);
        await cleanupPluginStorage({
          db: ctx.db,
          storage,
          workspaceId: ctx.workspaceId,
          pluginSlug: plugin.pluginSlug,
        });
      }

      await ctx.db
        .delete(workspacePlugins)
        .where(
          and(
            eq(workspacePlugins.id, input.id),
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
          ),
        );

      return { success: true };
    }),

  fileActions: workspaceProcedure
    .input(listPluginActionsSchema)
    .query(async ({ ctx, input }) => {
      const installedRows = await ctx.db
        .select({
          id: workspacePlugins.id,
          pluginSlug: workspacePlugins.pluginSlug,
          manifest: workspacePlugins.manifest,
          grantedPermissions: workspacePlugins.grantedPermissions,
          config: workspacePlugins.config,
          status: workspacePlugins.status,
        })
        .from(workspacePlugins)
        .where(
          and(
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
            eq(workspacePlugins.status, 'active'),
          ),
        )
        .orderBy(desc(workspacePlugins.updatedAt));

      const secretKeysByPlugin = await getConfiguredSecretKeysByPlugin(
        ctx.db,
        installedRows.map((row) => row.id),
      );

      const actions: Array<{
        workspacePluginId: string;
        pluginSlug: string;
        pluginName: string;
        actionId: string;
        label: string;
        description?: string;
      }> = [];

      for (const row of installedRows) {
        const manifest = parseManifestSafe(row.manifest);
        if (!manifest) continue;

        // Only show actions for plugins with a registered handler
        const handler = getHandler(manifest.slug);
        if (!handler?.executeAction) continue;

        const grantedPermissions = normalizeGrantedPermissions(
          row.grantedPermissions,
        );
        const config = normalizeConfig(row.config);
        const configuredSecretKeys = secretKeysByPlugin.get(row.id) ?? new Set();

        if (
          missingRequiredConfigFields({
            manifest,
            config,
            configuredSecretKeys,
          }).length > 0
        ) {
          continue;
        }

        for (const action of manifest.actions) {
          if (action.target !== input.target) continue;
          if (
            !hasRequiredPermissions(grantedPermissions, action.requiresPermissions)
          ) {
            continue;
          }

          actions.push({
            workspacePluginId: row.id,
            pluginSlug: manifest.slug,
            pluginName: manifest.name,
            actionId: action.id,
            label: action.label,
            description: action.description,
          });
        }
      }

      return actions.sort((left, right) => left.label.localeCompare(right.label));
    }),

  runAction: workspaceProcedure
    .input(runPluginActionSchema)
    .mutation(async ({ ctx, input }) => {
      const [plugin] = await ctx.db
        .select({
          id: workspacePlugins.id,
          pluginSlug: workspacePlugins.pluginSlug,
          manifest: workspacePlugins.manifest,
          grantedPermissions: workspacePlugins.grantedPermissions,
          config: workspacePlugins.config,
          status: workspacePlugins.status,
        })
        .from(workspacePlugins)
        .where(
          and(
            eq(workspacePlugins.id, input.workspacePluginId),
            eq(workspacePlugins.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);

      if (!plugin) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Installed plugin not found',
        });
      }
      if (plugin.status !== 'active') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Plugin is disabled',
        });
      }

      const manifest = parseManifestOrThrow(plugin.manifest);
      const action = manifest.actions.find(
        (entry) => entry.id === input.actionId,
      );
      if (!action) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Plugin action not found',
        });
      }
      if (action.target !== input.target) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid target for this plugin action',
        });
      }

      const grantedPermissions = normalizeGrantedPermissions(
        plugin.grantedPermissions,
      );
      if (
        !hasRequiredPermissions(grantedPermissions, action.requiresPermissions)
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This action is not permitted in the current plugin grant',
        });
      }

      const secretKeysByPlugin = await getConfiguredSecretKeysByPlugin(ctx.db, [
        plugin.id,
      ]);
      const configuredSecretKeys = secretKeysByPlugin.get(plugin.id) ?? new Set();
      const missingConfigFields = missingRequiredConfigFields({
        manifest,
        config: normalizeConfig(plugin.config),
        configuredSecretKeys,
      });
      if (missingConfigFields.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Plugin is missing required configuration: ${missingConfigFields.join(', ')}`,
        });
      }

      const target = await resolvePluginTarget({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        target: input.target,
        targetId: input.targetId,
      });

      let response: Awaited<ReturnType<typeof dispatchAction>>;
      try {
        response = await dispatchAction({
          db: ctx.db,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          pluginSlug: manifest.slug,
          pluginId: plugin.id,
          config: normalizeConfig(plugin.config),
          actionId: input.actionId,
          target: {
            type: input.target,
            id: input.targetId,
            name: target.targetName,
          },
        });
      } catch (error) {
        await ctx.db.insert(pluginInvocationLogs).values({
          workspacePluginId: plugin.id,
          actorUserId: ctx.userId,
          actionId: action.id,
          targetType: input.target,
          targetId: input.targetId,
          status: 'error',
          details: {
            pluginSlug: manifest.slug,
            actionLabel: action.label,
            message: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }

      await ctx.db.insert(pluginInvocationLogs).values({
        workspacePluginId: plugin.id,
        actorUserId: ctx.userId,
        actionId: action.id,
        targetType: input.target,
        targetId: input.targetId,
        status: response.status,
        details: {
          pluginSlug: manifest.slug,
          actionLabel: action.label,
          message: response.message,
        },
      });

      return response;
    }),
});
