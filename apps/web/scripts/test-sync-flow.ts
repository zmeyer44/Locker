/**
 * Integration test for the full sync flow.
 *
 * Verifies that:
 *  1. totalItems is set correctly on the replication run from the start (not 0)
 *  2. Files are actually synced from a local store to a Vercel Blob store
 *  3. The run completes successfully
 *
 * Usage:
 *   npx tsx scripts/test-sync-flow.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { getDb } from "@locker/database/client";
import {
  blobLocations,
  fileBlobs,
  files,
  replicationRunItems,
  replicationRuns,
  stores,
  storeSecrets,
  workspaceStorageSettings,
  workspaces,
  users,
} from "@locker/database";
import { VercelBlobAdapter } from "@locker/storage";
import { encryptSecret } from "@locker/jobs";
import { syncWorkspaceStores, type FileSourceResolver } from "@locker/jobs";
import { LocalStorageAdapter } from "@locker/storage";

// ── Load .env manually (no dotenv dependency) ─────────────────────────────

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ── Configuration ──────────────────────────────────────────────────────────

const VERCEL_BLOB_TOKEN = process.env.TEST_VERCEL_BLOB_TOKEN;
if (!VERCEL_BLOB_TOKEN) {
  console.error("TEST_VERCEL_BLOB_TOKEN is not set");
  process.exit(1);
}

if (!process.env.S3_API_KEY_ENCRYPTION_SECRET) {
  // Set a test encryption key if not already set
  process.env.S3_API_KEY_ENCRYPTION_SECRET = "test-encryption-secret-for-sync";
}

const TEST_PREFIX = `sync-test-${Date.now()}`;
const TMP_DIR = path.join(os.tmpdir(), TEST_PREFIX);
const TEST_FILE_CONTENT = "Hello from sync integration test!";
const TEST_FILE_NAME = "sync-test-file.txt";
const OBJECT_KEY = `${TEST_PREFIX}/${TEST_FILE_NAME}`;

const db = getDb();

// ── Track IDs for cleanup ──────────────────────────────────────────────────

let userId: string;
let workspaceId: string;
let localStoreId: string;
let vercelStoreId: string;
let blobId: string;
let fileId: string;
let runId: string;

// ── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[sync-test] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[sync-test] FAIL: ${msg}`);
  process.exit(1);
}

function assert(cond: boolean, msg: string) {
  if (!cond) fail(msg);
  log(`  ✓ ${msg}`);
}

// ── Setup ──────────────────────────────────────────────────────────────────

async function setup() {
  log("Setting up test data...");

  // Create temp directory and test file
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, OBJECT_KEY);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, TEST_FILE_CONTENT);
  log(`  Created local file at ${filePath}`);

  // Create test user
  userId = `sync-test-user-${Date.now()}`;
  await db.insert(users).values({
    id: userId,
    email: `sync-test-${Date.now()}@test.local`,
    name: "Sync Test User",
  });
  log(`  Created user ${userId}`);

  // Create test workspace
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: "Sync Test Workspace",
      slug: `sync-test-${Date.now()}`,
      ownerId: userId,
    })
    .returning({ id: workspaces.id });
  workspaceId = ws!.id;
  log(`  Created workspace ${workspaceId}`);

  // Create local store (primary, writable)
  const [localStore] = await db
    .insert(stores)
    .values({
      workspaceId,
      name: "Test Local Store",
      provider: "local",
      credentialSource: "platform",
      status: "active",
      writeMode: "write",
      readPriority: 50,
      config: { baseDir: TMP_DIR },
    })
    .returning({ id: stores.id });
  localStoreId = localStore!.id;
  log(`  Created local store ${localStoreId}`);

  // Create Vercel Blob store (writable target)
  const [vercelStore] = await db
    .insert(stores)
    .values({
      workspaceId,
      name: "Test Vercel Blob Store",
      provider: "vercel_blob",
      credentialSource: "store",
      status: "active",
      writeMode: "write",
      readPriority: 100,
      config: {},
    })
    .returning({ id: stores.id });
  vercelStoreId = vercelStore!.id;
  log(`  Created Vercel Blob store ${vercelStoreId}`);

  // Encrypt and store Vercel Blob credentials
  const encryptedCreds = encryptSecret(
    JSON.stringify({ provider: "vercel_blob", readWriteToken: VERCEL_BLOB_TOKEN }),
  );
  await db.insert(storeSecrets).values({
    storeId: vercelStoreId,
    encryptedCredentials: encryptedCreds,
  });
  log(`  Stored encrypted credentials for Vercel Blob store`);

  // Set local store as primary
  await db.insert(workspaceStorageSettings).values({
    workspaceId,
    primaryStoreId: localStoreId,
  });
  log(`  Set local store as primary`);

  // Create file blob
  const [blob] = await db
    .insert(fileBlobs)
    .values({
      workspaceId,
      createdById: userId,
      objectKey: OBJECT_KEY,
      byteSize: Buffer.byteLength(TEST_FILE_CONTENT),
      mimeType: "text/plain",
      state: "ready",
    })
    .returning({ id: fileBlobs.id });
  blobId = blob!.id;
  log(`  Created file blob ${blobId}`);

  // Create file record
  const [file] = await db
    .insert(files)
    .values({
      workspaceId,
      userId,
      blobId,
      name: TEST_FILE_NAME,
      mimeType: "text/plain",
      size: Buffer.byteLength(TEST_FILE_CONTENT),
      storagePath: OBJECT_KEY,
      storageProvider: "local",
      status: "ready",
    })
    .returning({ id: files.id });
  fileId = file!.id;
  log(`  Created file ${fileId}`);

  // Create blob location on local store
  await db.insert(blobLocations).values({
    blobId,
    storeId: localStoreId,
    storagePath: OBJECT_KEY,
    state: "available",
    origin: "primary_upload",
  });
  log(`  Created blob location on local store`);

  log("Setup complete.\n");
}

// ── Run sync ───────────────────────────────────────────────────────────────

async function runSync() {
  log("Running syncWorkspaceStores...");

  // Build a file source resolver that reads from the local store
  const localStorage = new LocalStorageAdapter({ baseDir: TMP_DIR });

  const resolveFileSource: FileSourceResolver = async (fId, preferredStoreId) => {
    const [file] = await db
      .select({
        blobId: files.blobId,
        objectKey: fileBlobs.objectKey,
      })
      .from(files)
      .innerJoin(fileBlobs, eq(files.blobId, fileBlobs.id))
      .where(eq(files.id, fId))
      .limit(1);

    if (!file) throw new Error(`File ${fId} not found`);

    return {
      storage: localStorage,
      storagePath: file.objectKey,
      storeId: localStoreId,
    };
  };

  const result = await syncWorkspaceStores({
    workspaceId,
    resolveFileSource,
    db,
  });
  runId = result.runId;
  log(`  Sync started with runId: ${runId}\n`);
  return runId;
}

// ── Verify ─────────────────────────────────────────────────────────────────

async function verify() {
  log("Verifying results...");

  // 1. Check the replication run
  const [run] = await db
    .select()
    .from(replicationRuns)
    .where(eq(replicationRuns.id, runId))
    .limit(1);

  assert(!!run, "Replication run exists");
  assert(run!.totalItems === 1, `totalItems is 1 (got ${run!.totalItems})`);
  assert(run!.processedItems === 1, `processedItems is 1 (got ${run!.processedItems})`);
  assert(
    run!.status === "completed",
    `Run status is "completed" (got "${run!.status}")`,
  );
  assert(run!.failedItems === 0, `failedItems is 0 (got ${run!.failedItems})`);

  // 2. Check blob location was created on Vercel Blob store
  const [location] = await db
    .select()
    .from(blobLocations)
    .where(
      and(
        eq(blobLocations.blobId, blobId),
        eq(blobLocations.storeId, vercelStoreId),
      ),
    )
    .limit(1);

  assert(!!location, "Blob location on Vercel Blob store exists");
  assert(
    location!.state === "available",
    `Blob location state is "available" (got "${location!.state}")`,
  );

  // 3. Verify the file actually exists in Vercel Blob
  const vercelAdapter = new VercelBlobAdapter({ token: VERCEL_BLOB_TOKEN });
  const exists = await vercelAdapter.exists(location!.storagePath);
  assert(exists, `File exists in Vercel Blob at "${location!.storagePath}"`);

  // 4. Verify run items (one per target store: skipped for local, completed for vercel)
  const items = await db
    .select()
    .from(replicationRunItems)
    .where(eq(replicationRunItems.runId, runId));

  assert(items.length >= 1, `At least 1 run item recorded (got ${items.length})`);

  const vercelItem = items.find((i) => i.targetStoreId === vercelStoreId);
  assert(!!vercelItem, "Run item exists for Vercel Blob target");
  assert(
    vercelItem!.status === "completed",
    `Vercel Blob run item status is "completed" (got "${vercelItem!.status}")`,
  );

  const localItem = items.find((i) => i.targetStoreId === localStoreId);
  if (localItem) {
    assert(
      localItem.status === "skipped",
      `Local store run item was skipped (got "${localItem.status}")`,
    );
  }

  log("\nAll assertions passed!");
}

// ── Cleanup ────────────────────────────────────────────────────────────────

async function cleanup() {
  log("\nCleaning up...");

  // Delete the file from Vercel Blob if it was synced there
  try {
    const locations = await db
      .select({ storagePath: blobLocations.storagePath })
      .from(blobLocations)
      .where(
        and(
          eq(blobLocations.blobId, blobId),
          eq(blobLocations.storeId, vercelStoreId),
        ),
      );

    if (locations.length > 0) {
      const vercelAdapter = new VercelBlobAdapter({ token: VERCEL_BLOB_TOKEN });
      for (const loc of locations) {
        await vercelAdapter.delete(loc.storagePath).catch(() => {});
      }
      log("  Deleted file from Vercel Blob");
    }
  } catch {
    log("  (skipped Vercel Blob cleanup)");
  }

  // Delete DB records in dependency order
  if (runId) {
    await db
      .delete(replicationRunItems)
      .where(eq(replicationRunItems.runId, runId));
    await db
      .delete(replicationRuns)
      .where(eq(replicationRuns.id, runId));
  }

  if (blobId) {
    await db.delete(blobLocations).where(eq(blobLocations.blobId, blobId));
  }

  if (fileId) {
    await db.delete(files).where(eq(files.id, fileId));
  }

  if (blobId) {
    await db.delete(fileBlobs).where(eq(fileBlobs.id, blobId));
  }

  if (vercelStoreId) {
    await db.delete(storeSecrets).where(eq(storeSecrets.storeId, vercelStoreId));
  }

  if (workspaceId) {
    await db
      .delete(workspaceStorageSettings)
      .where(eq(workspaceStorageSettings.workspaceId, workspaceId));
  }

  if (localStoreId) {
    await db.delete(stores).where(eq(stores.id, localStoreId));
  }
  if (vercelStoreId) {
    await db.delete(stores).where(eq(stores.id, vercelStoreId));
  }

  if (workspaceId) {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  }

  if (userId) {
    await db.delete(users).where(eq(users.id, userId));
  }

  // Remove temp directory
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  log("  Cleanup complete.");
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Sync Flow Integration Test ===\n");

  try {
    await setup();
    await runSync();
    await verify();
  } catch (err) {
    console.error("\n[sync-test] ERROR:", err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    process.exit(process.exitCode ?? 0);
  }
}

main();
