import { and, eq, inArray } from "drizzle-orm";
import { createStorageForWorkspace } from "../storage";
import { workspacePlugins, workspacePluginSecrets } from "@locker/database";
import type { Database } from "@locker/database";
import type { PluginPermission } from "@locker/common";
import { decryptPluginSecret } from "./secrets";
import { createPluginStorage } from "./plugin-storage";
import type {
  PluginHandler,
  PluginContext,
  ActionResult,
  ActionTarget,
} from "./types";

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const handlersBySlug = new Map<string, PluginHandler>();

export function registerHandler(handler: PluginHandler): void {
  handlersBySlug.set(handler.manifest.slug, handler);
}

export function getHandler(slug: string): PluginHandler | undefined {
  return handlersBySlug.get(slug);
}

export function getAllHandlers(): PluginHandler[] {
  return [...handlersBySlug.values()];
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildPluginContext(params: {
  db: Database;
  workspaceId: string;
  userId: string;
  pluginId: string;
  pluginSlug: string;
  config: Record<string, string | number | boolean | null>;
}): Promise<PluginContext> {
  const secretRows = await params.db
    .select({
      key: workspacePluginSecrets.key,
      encryptedValue: workspacePluginSecrets.encryptedValue,
    })
    .from(workspacePluginSecrets)
    .where(eq(workspacePluginSecrets.workspacePluginId, params.pluginId));

  const secrets: Record<string, string> = {};
  for (const row of secretRows) {
    try {
      secrets[row.key] = decryptPluginSecret(row.encryptedValue);
    } catch {
      // Skip secrets that fail to decrypt (e.g. key rotation)
    }
  }

  const storageResult = await createStorageForWorkspace(params.workspaceId);

  return {
    workspaceId: params.workspaceId,
    userId: params.userId,
    db: params.db,
    storage: storageResult.storage,
    pluginStorage: createPluginStorage({
      db: params.db,
      storage: storageResult.storage,
      workspaceId: params.workspaceId,
      userId: params.userId,
      pluginSlug: params.pluginSlug,
      storageConfigId: storageResult.configId,
      providerName: storageResult.providerName,
    }),
    config: params.config,
    secrets,
  };
}

// ---------------------------------------------------------------------------
// Action dispatcher
// ---------------------------------------------------------------------------

export async function dispatchAction(params: {
  db: Database;
  workspaceId: string;
  userId: string;
  pluginSlug: string;
  pluginId: string;
  config: Record<string, string | number | boolean | null>;
  actionId: string;
  target: ActionTarget;
}): Promise<ActionResult> {
  const handler = getHandler(params.pluginSlug);
  if (!handler?.executeAction) {
    throw new Error("Plugin does not implement action execution");
  }

  const ctx = await buildPluginContext({
    db: params.db,
    workspaceId: params.workspaceId,
    userId: params.userId,
    pluginId: params.pluginId,
    pluginSlug: params.pluginSlug,
    config: params.config,
  });

  return handler.executeAction(ctx, params.actionId, params.target);
}

// ---------------------------------------------------------------------------
// Search dispatcher
// ---------------------------------------------------------------------------

/**
 * Re-rank search results using all active search-capable plugins
 * installed in the workspace. Falls back to the original order if
 * no search plugins are active.
 */
export async function dispatchSearch<
  T extends { id: string; name: string; updatedAt: Date },
>(params: {
  db: Database;
  workspaceId: string;
  query: string;
  results: T[];
}): Promise<T[]> {
  if (!params.query.trim() || params.results.length <= 1) {
    return params.results;
  }

  // Find active plugins with search.enhance permission
  const activePlugins = await params.db
    .select({
      id: workspacePlugins.id,
      pluginSlug: workspacePlugins.pluginSlug,
      config: workspacePlugins.config,
      grantedPermissions: workspacePlugins.grantedPermissions,
    })
    .from(workspacePlugins)
    .where(
      and(
        eq(workspacePlugins.workspaceId, params.workspaceId),
        eq(workspacePlugins.status, "active"),
      ),
    );

  for (const plugin of activePlugins) {
    const permissions = Array.isArray(plugin.grantedPermissions)
      ? (plugin.grantedPermissions as PluginPermission[])
      : [];

    if (!permissions.includes("search.enhance")) continue;

    const handler = getHandler(plugin.pluginSlug);
    if (!handler?.search) continue;

    const config =
      plugin.config &&
      typeof plugin.config === "object" &&
      !Array.isArray(plugin.config)
        ? (plugin.config as Record<string, string | number | boolean | null>)
        : {};

    const ctx = await buildPluginContext({
      db: params.db,
      workspaceId: params.workspaceId,
      userId: "system:search", // search dispatched without a specific actor
      pluginId: plugin.id,
      pluginSlug: plugin.pluginSlug,
      config,
    });

    try {
      const searchResults = await handler.search(ctx, {
        query: params.query,
      });

      if (searchResults.length > 0) {
        const scoreById = new Map(
          searchResults.map((r) => [r.fileId, r.score]),
        );

        return [...params.results].sort((a, b) => {
          const scoreA = scoreById.get(a.id) ?? 0;
          const scoreB = scoreById.get(b.id) ?? 0;
          if (scoreA !== scoreB) return scoreB - scoreA;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
      }
    } catch {
      // If a plugin's search fails, fall through to original order
    }
  }

  return params.results;
}
