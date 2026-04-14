export { encryptSecret, decryptSecret } from "./crypto";

export {
  hydrateStore,
  getActiveStores,
  getStoreById,
  buildStoragePathForStore,
  buildStorageConfig,
  type StoreRow,
  type WorkspaceStorageResult,
} from "./store-utils";

export {
  syncWorkspaceStores,
  syncFileToStores,
  type FileSourceResolver,
  type ConflictStrategy,
} from "./sync-workspace";

export {
  buildFolderPath,
  buildStoreTargetPath,
  isLegacyObjectKey,
  deduplicateObjectKey,
} from "./path-builder";
