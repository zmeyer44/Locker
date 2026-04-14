import { task } from "@renderinc/sdk/workflows";
import { syncWorkspaceStores, type ConflictStrategy } from "@locker/jobs";
import { resolveFileSource } from "../resolve-file-source.ts";

export const syncWorkspace = task(
  {
    name: "syncWorkspace",
    timeoutSeconds: 3600,
    retry: { maxRetries: 1, waitDurationMs: 5000 },
  },
  async function syncWorkspace(
    runId: string,
    workspaceId: string,
    targetStoreId: string | null,
    triggeredByUserId: string | null,
    conflictStrategy: string | null = "skip",
  ) {
    return syncWorkspaceStores({
      runId,
      workspaceId,
      targetStoreId: targetStoreId ?? undefined,
      triggeredByUserId: triggeredByUserId ?? undefined,
      conflictStrategy: (conflictStrategy ?? "skip") as ConflictStrategy,
      resolveFileSource,
    });
  },
);
