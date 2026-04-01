import { createRouter } from './init';
import { filesRouter } from './routers/files';
import { foldersRouter } from './routers/folders';
import { sharesRouter } from './routers/shares';
import { uploadLinksRouter } from './routers/upload-links';
import { storageRouter } from './routers/storage';
import { workspacesRouter } from './routers/workspaces';
import { membersRouter } from './routers/members';
import { uploadsRouter } from './routers/uploads';

export const appRouter = createRouter({
  files: filesRouter,
  folders: foldersRouter,
  shares: sharesRouter,
  uploadLinks: uploadLinksRouter,
  storage: storageRouter,
  workspaces: workspacesRouter,
  members: membersRouter,
  uploads: uploadsRouter,
});

export type AppRouter = typeof appRouter;
