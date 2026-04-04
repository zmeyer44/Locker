import { createRouter } from "./init";
import { filesRouter } from "./routers/files";
import { foldersRouter } from "./routers/folders";
import { sharesRouter } from "./routers/shares";
import { uploadLinksRouter } from "./routers/upload-links";
import { storageRouter } from "./routers/storage";
import { workspacesRouter } from "./routers/workspaces";
import { membersRouter } from "./routers/members";
import { uploadsRouter } from "./routers/uploads";
import { s3KeysRouter } from "./routers/s3-keys";
import { trackedLinksRouter } from "./routers/tracked-links";
import { pluginsRouter } from "./routers/plugins";
import { transcriptionsRouter } from "./routers/transcriptions";
import { vfsShellRouter } from "./routers/vfs-shell";
import { storageConfigRouter } from "./routers/storage-config";

export const appRouter = createRouter({
  files: filesRouter,
  folders: foldersRouter,
  shares: sharesRouter,
  uploadLinks: uploadLinksRouter,
  storage: storageRouter,
  storageConfig: storageConfigRouter,
  workspaces: workspacesRouter,
  members: membersRouter,
  uploads: uploadsRouter,
  s3Keys: s3KeysRouter,
  trackedLinks: trackedLinksRouter,
  plugins: pluginsRouter,
  transcriptions: transcriptionsRouter,
  vfsShell: vfsShellRouter,
});

export type AppRouter = typeof appRouter;
