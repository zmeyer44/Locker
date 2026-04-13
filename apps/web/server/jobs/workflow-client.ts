import { Render } from "@renderinc/sdk";

let client: Render | null = null;

function getClient(): Render {
  if (!client) {
    client = new Render();
  }
  return client;
}

function slug(): string {
  return process.env.RENDER_WORKFLOW_SLUG!;
}

export async function dispatchSyncWorkspace(params: {
  runId: string;
  workspaceId: string;
  targetStoreId?: string;
  triggeredByUserId?: string;
}): Promise<{ taskRunId: string }> {
  const render = getClient();
  const started = await render.workflows.startTask(
    `${slug()}/syncWorkspace`,
    [
      params.runId,
      params.workspaceId,
      params.targetStoreId ?? null,
      params.triggeredByUserId ?? null,
    ],
  );
  return { taskRunId: started.taskRunId };
}
