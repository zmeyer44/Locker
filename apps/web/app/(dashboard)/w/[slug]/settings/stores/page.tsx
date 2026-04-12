"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleCheck,
  CircleX,
  Cloud,
  FolderOpen,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Template } from "@/components/modal/template";
import { Button as ModalButton } from "@/components/button";
import { useModal } from "@/components/modal/provider";
import { ConfirmModal } from "@/components/modal/modals/confirm-modal";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types & Constants                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

type Provider = "s3" | "r2" | "vercel_blob" | "local";
type WriteMode = "write" | "read_only";
type IngestMode = "none" | "scan";

type StoreForm = {
  name: string;
  provider: Provider;
  writeMode: WriteMode;
  ingestMode: IngestMode;
  readPriority: number;
  bucket: string;
  region: string;
  endpoint: string;
  accountId: string;
  publicUrl: string;
  baseDir: string;
  rootPrefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  readWriteToken: string;
};

const PROVIDER_META: Record<
  Provider,
  { label: string; icon: typeof Cloud; color: string }
> = {
  s3: { label: "Amazon S3", icon: Cloud, color: "text-amber-500" },
  r2: { label: "Cloudflare R2", icon: Cloud, color: "text-orange-500" },
  vercel_blob: { label: "Vercel Blob", icon: Cloud, color: "text-blue-500" },
  local: { label: "Local Disk", icon: FolderOpen, color: "text-emerald-500" },
};

function emptyForm(provider: Provider = "s3"): StoreForm {
  return {
    name: "",
    provider,
    writeMode: "write",
    ingestMode: "none",
    readPriority: 100,
    bucket: "",
    region: "",
    endpoint: "",
    accountId: "",
    publicUrl: "",
    baseDir: "",
    rootPrefix: "",
    accessKeyId: "",
    secretAccessKey: "",
    readWriteToken: "",
  };
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formFromStore(store: any): StoreForm {
  const config = (store?.config ?? {}) as Record<string, unknown>;
  return {
    name: store.name ?? "",
    provider: store.provider,
    writeMode: store.writeMode,
    ingestMode: store.ingestMode,
    readPriority: store.readPriority ?? 100,
    bucket: coerceString(config.bucket),
    region: coerceString(config.region),
    endpoint: coerceString(config.endpoint),
    accountId: coerceString(config.accountId),
    publicUrl: coerceString(config.publicUrl),
    baseDir: coerceString(config.baseDir),
    rootPrefix: coerceString(config.rootPrefix),
    accessKeyId: "",
    secretAccessKey: "",
    readWriteToken: "",
  };
}

function buildPayload(form: StoreForm) {
  return {
    name: form.name,
    provider: form.provider,
    writeMode: form.writeMode,
    ingestMode: form.ingestMode,
    readPriority: Number(form.readPriority) || 100,
    bucket: form.bucket || undefined,
    region: form.region || undefined,
    endpoint: form.endpoint || undefined,
    accountId: form.accountId || undefined,
    publicUrl: form.publicUrl || undefined,
    baseDir: form.baseDir || undefined,
    rootPrefix: form.rootPrefix || undefined,
    credentials:
      form.provider === "s3"
        ? {
            accessKeyId: form.accessKeyId,
            secretAccessKey: form.secretAccessKey,
          }
        : form.provider === "r2"
          ? {
              accountId: form.accountId,
              accessKeyId: form.accessKeyId,
              secretAccessKey: form.secretAccessKey,
            }
          : form.provider === "vercel_blob"
            ? { readWriteToken: form.readWriteToken }
            : undefined,
  };
}

function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Store Form Modal                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function StoreFormModal({
  store,
  onSuccess,
}: {
  store?: any;
  onSuccess: () => void;
}) {
  const modal = useModal();
  const [form, setForm] = useState<StoreForm>(
    store ? formFromStore(store) : emptyForm(),
  );

  const createStore = trpc.stores.create.useMutation({
    onSuccess: () => {
      toast.success("Store created");
      onSuccess();
      modal.hide();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateStore = trpc.stores.update.useMutation({
    onSuccess: () => {
      toast.success("Store updated");
      onSuccess();
      modal.hide();
    },
    onError: (error) => toast.error(error.message),
  });

  const testStore = trpc.stores.test.useMutation({
    onSuccess: () => toast.success("Connection successful"),
    onError: (error) => toast.error(error.message),
  });

  const isSaving = createStore.isPending || updateStore.isPending;

  const canSave =
    form.name.trim().length > 0 &&
    (form.provider === "local" ||
      form.provider === "vercel_blob" ||
      form.bucket.trim().length > 0);

  function handleSave() {
    if (store) {
      updateStore.mutate({ id: store.id, store: buildPayload(form) });
    } else {
      createStore.mutate(buildPayload(form));
    }
  }

  const fieldDelay = 0.03;

  return (
    <Template
      title={store ? `Edit ${store.name}` : "Add store"}
      description="Configure where workspace files should live."
      className="md:max-w-lg"
      footer={
        <div className="flex flex-1 items-center justify-between gap-x-3">
          <ModalButton
            onClick={() => modal.hide()}
            variant="ghost"
            text="Cancel"
          />
          <div className="flex items-center gap-2">
            <ModalButton
              onClick={() => testStore.mutate(buildPayload(form))}
              variant="outline"
              loading={testStore.isPending}
              icon={
                !testStore.isPending ? (
                  <CheckCircle2 className="size-3.5" />
                ) : undefined
              }
              text="Test"
            />
            <ModalButton
              onClick={handleSave}
              loading={isSaving}
              disabled={!canSave}
              text={store ? "Save changes" : "Create store"}
            />
          </div>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="space-y-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: fieldDelay * 0 }}
          className="space-y-1.5"
        >
          <label className="text-[13px] font-medium text-muted-foreground">
            Name <span className="text-destructive">*</span>
          </label>
          <Input
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="e.g. Production S3"
            autoFocus
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: fieldDelay * 1 }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">
              Provider
            </label>
            <Select
              value={form.provider}
              disabled={!!store}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...emptyForm(value as Provider),
                  name: prev.name,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(PROVIDER_META) as [Provider, (typeof PROVIDER_META)[Provider]][]).map(
                  ([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      {meta.label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">
              Write mode
            </label>
            <Select
              value={form.writeMode}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  writeMode: value as WriteMode,
                  ingestMode:
                    value === "read_only" && prev.ingestMode === "none"
                      ? "scan"
                      : prev.ingestMode,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="write">Writable</SelectItem>
                <SelectItem value="read_only">Read-only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: fieldDelay * 2 }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">
              Ingest mode
            </label>
            <Select
              value={form.ingestMode}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  ingestMode: value as IngestMode,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No scanning</SelectItem>
                <SelectItem value="scan">Scan for files</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">
              Read priority
            </label>
            <Input
              type="number"
              value={form.readPriority}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  readPriority: Number(e.target.value) || 100,
                }))
              }
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: fieldDelay * 3 }}
          className="space-y-1.5"
        >
          <label className="text-[13px] font-medium text-muted-foreground">
            Root prefix
          </label>
          <Input
            value={form.rootPrefix}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, rootPrefix: e.target.value }))
            }
            placeholder="locker-data"
          />
        </motion.div>

        {/* Provider-specific fields */}
        {(form.provider === "s3" || form.provider === "r2") && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: fieldDelay * 4 }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-muted-foreground">
                Bucket <span className="text-destructive">*</span>
              </label>
              <Input
                value={form.bucket}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, bucket: e.target.value }))
                }
                placeholder="workspace-storage"
              />
            </div>
          </motion.div>
        )}

        {form.provider === "s3" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: fieldDelay * 5 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FieldInput
                label="Region"
                value={form.region}
                onChange={(v) => setForm((p) => ({ ...p, region: v }))}
                placeholder="us-east-1"
              />
              <FieldInput
                label="Endpoint"
                value={form.endpoint}
                onChange={(v) => setForm((p) => ({ ...p, endpoint: v }))}
                placeholder="https://s3.amazonaws.com"
              />
            </div>
            <FieldInput
              label="Access Key ID"
              value={form.accessKeyId}
              onChange={(v) => setForm((p) => ({ ...p, accessKeyId: v }))}
              placeholder="AKIA..."
            />
            <FieldInput
              label="Secret Access Key"
              value={form.secretAccessKey}
              onChange={(v) => setForm((p) => ({ ...p, secretAccessKey: v }))}
              placeholder="Enter secret"
            />
          </motion.div>
        )}

        {form.provider === "r2" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: fieldDelay * 5 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FieldInput
                label="Account ID"
                value={form.accountId}
                onChange={(v) => setForm((p) => ({ ...p, accountId: v }))}
                placeholder="Cloudflare account ID"
              />
              <FieldInput
                label="Public URL"
                value={form.publicUrl}
                onChange={(v) => setForm((p) => ({ ...p, publicUrl: v }))}
                placeholder="https://files.example.com"
              />
            </div>
            <FieldInput
              label="Access Key ID"
              value={form.accessKeyId}
              onChange={(v) => setForm((p) => ({ ...p, accessKeyId: v }))}
              placeholder="R2 access key"
            />
            <FieldInput
              label="Secret Access Key"
              value={form.secretAccessKey}
              onChange={(v) => setForm((p) => ({ ...p, secretAccessKey: v }))}
              placeholder="Enter secret"
            />
          </motion.div>
        )}

        {form.provider === "vercel_blob" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: fieldDelay * 4 }}
          >
            <FieldInput
              label="Read/Write Token"
              value={form.readWriteToken}
              onChange={(v) => setForm((p) => ({ ...p, readWriteToken: v }))}
              placeholder="vercel_blob_rw_..."
            />
          </motion.div>
        )}

        {form.provider === "local" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: fieldDelay * 4 }}
          >
            <FieldInput
              label="Base directory"
              value={form.baseDir}
              onChange={(v) => setForm((p) => ({ ...p, baseDir: v }))}
              placeholder="/var/lib/locker"
            />
          </motion.div>
        )}
      </form>
    </Template>
  );
}

function FieldInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-medium text-muted-foreground">
        {props.label}
      </label>
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export default function StoresSettingsPage() {
  const workspace = useWorkspace();
  const modal = useModal();
  const utils = trpc.useUtils();
  const { data: stores = [], isLoading } = trpc.stores.list.useQuery();

  // Track which stores have in-flight operations
  const [busyStores, setBusyStores] = useState<
    Record<string, { action: string } | undefined>
  >({});

  function markBusy(storeId: string | undefined, action: string) {
    const key = storeId ?? "_all";
    setBusyStores((prev) => ({ ...prev, [key]: { action } }));
  }
  function clearBusy(storeId: string | undefined) {
    const key = storeId ?? "_all";
    setBusyStores((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const hasAnyBusy = Object.keys(busyStores).length > 0;

  // Poll sync status faster while operations are in-flight
  const { data: syncRuns = [] } = trpc.stores.syncStatus.useQuery(undefined, {
    refetchInterval: hasAnyBusy ? 2000 : 8000,
  });

  const invalidate = () => {
    utils.stores.list.invalidate();
    utils.stores.syncStatus.invalidate();
  };

  const setPrimary = trpc.stores.setPrimary.useMutation({
    onSuccess: () => {
      toast.success("Primary store updated");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const syncStores = trpc.stores.sync.useMutation({
    onMutate: (vars) => markBusy(vars?.storeId, "Syncing"),
    onSuccess: (_data, vars) => {
      clearBusy(vars?.storeId);
      toast.success("Sync completed");
      invalidate();
    },
    onError: (error, vars) => {
      clearBusy(vars?.storeId);
      toast.error(error.message);
    },
  });

  const removeStore = trpc.stores.remove.useMutation({
    onSuccess: () => {
      toast.success("Store archived");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const ingestStore = trpc.stores.ingest.useMutation({
    onMutate: (vars) => markBusy(vars.storeId, "Ingesting"),
    onSuccess: (result, vars) => {
      clearBusy(vars.storeId);
      toast.success(
        `Ingested ${result.ingested} file(s)${result.skipped ? `, ${result.skipped} skipped` : ""}`,
      );
      invalidate();
    },
    onError: (error, vars) => {
      clearBusy(vars.storeId);
      toast.error(error.message);
    },
  });

  const latestRun = syncRuns[0];
  const isRunActive =
    latestRun?.status === "running" || latestRun?.status === "queued";
  const runProgress =
    latestRun && latestRun.totalItems > 0
      ? Math.round((latestRun.processedItems / latestRun.totalItems) * 100)
      : 0;

  function openAddModal() {
    modal.show(<StoreFormModal onSuccess={invalidate} />);
  }

  function openEditModal(store: any) {
    modal.show(<StoreFormModal store={store} onSuccess={invalidate} />);
  }

  function openArchiveConfirm(storeId: string) {
    modal.show(
      <ConfirmModal
        title="Archive store"
        description="Are you sure? Existing synced copies will remain, but new files won't be written here."
        onConfirm={() => removeStore.mutate({ id: storeId })}
        buttonProps={{ variant: "destructive", text: "Archive" }}
      />,
    );
  }

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Stores</span>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/w/${workspace.slug}/settings`}>
              <ArrowLeft className="size-4" />
              Settings
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl p-6 space-y-6">
        {/* Header card */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Workspace Stores</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Attach storage backends, set a primary write destination, and
              replicate for redundancy.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncStores.mutate({})}
              disabled={syncStores.isPending || isRunActive}
            >
              {syncStores.isPending || isRunActive ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {syncStores.isPending ? "Starting..." : "Sync all"}
            </Button>
            <Button size="sm" onClick={openAddModal}>
              <Plus className="size-4" />
              Add store
            </Button>
          </div>
        </div>

        {/* Sync status */}
        <AnimatePresence>
          {latestRun && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-xs",
                  isRunActive
                    ? "border-primary/20 bg-primary/5"
                    : latestRun.failedItems > 0
                      ? "border-destructive/20 bg-destructive/5"
                      : "bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {isRunActive ? (
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                    ) : latestRun.status === "completed" ? (
                      <CircleCheck className="size-3.5 text-emerald-500" />
                    ) : latestRun.status === "failed" ? (
                      <CircleX className="size-3.5 text-destructive" />
                    ) : null}
                    <span className="font-medium text-foreground">
                      {isRunActive
                        ? `Syncing ${latestRun.processedItems} of ${latestRun.totalItems} files...`
                        : latestRun.status === "completed"
                          ? `Sync completed \u2014 ${latestRun.processedItems} file(s) processed`
                          : latestRun.status === "failed"
                            ? "Sync failed"
                            : `Sync ${latestRun.status}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {latestRun.failedItems > 0 && (
                      <span className="text-destructive">
                        {latestRun.failedItems} failed
                      </span>
                    )}
                    {latestRun.completedAt && !isRunActive && (
                      <span>{relativeTime(latestRun.completedAt)}</span>
                    )}
                  </div>
                </div>
                {isRunActive && latestRun.totalItems > 0 && (
                  <Progress
                    value={runProgress}
                    className="mt-2 h-1.5"
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Store list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center rounded-lg border bg-card py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading stores...
            </div>
          ) : stores.length === 0 ? (
            <button
              type="button"
              onClick={openAddModal}
              className="group flex w-full flex-col items-center gap-2 rounded-lg border border-dashed bg-card py-12 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              <HardDrive className="size-5 transition-transform group-hover:scale-110" />
              <span>No stores configured. Add one to get started.</span>
            </button>
          ) : (
            stores.map((store, i) => {
              const meta = PROVIDER_META[store.provider];
              const Icon = meta.icon;
              const activity =
                busyStores[store.id] ?? busyStores["_all"];
              const isBusy = !!activity;

              return (
                <motion.div
                  key={store.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={cn(
                    "group rounded-lg border bg-card transition-colors hover:border-foreground/15",
                    isBusy && "border-primary/20",
                  )}
                >
                  <div className="flex items-center gap-3 p-4">
                    {/* Icon */}
                    <div
                      className={cn(
                        "relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
                        meta.color,
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 transition-opacity",
                          isBusy && "opacity-40",
                        )}
                      />
                      {isBusy && (
                        <Loader2 className="absolute size-4 animate-spin text-primary" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {store.name}
                        </span>
                        {store.isPrimary && (
                          <Badge className="text-[10px] px-1.5 py-0">
                            Primary
                          </Badge>
                        )}
                        {store.writeMode === "read_only" && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Read-only
                          </Badge>
                        )}
                        {store.credentialSource === "platform" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Platform
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        {isBusy ? (
                          <span className="text-primary font-medium">
                            {activity.action}...
                          </span>
                        ) : (
                          <>
                            <span>{meta.label}</span>
                            <span className="text-border">|</span>
                            <span>
                              Synced {relativeTime(store.lastSyncedAt)}
                            </span>
                            <span className="text-border">|</span>
                            <span>
                              Tested {relativeTime(store.lastTestedAt)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(store)}
                        className="text-xs opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={isBusy}
                            onClick={() =>
                              syncStores.mutate({ storeId: store.id })
                            }
                          >
                            <RefreshCw className="mr-2 size-3.5" />
                            Sync
                          </DropdownMenuItem>
                          {store.writeMode === "read_only" && (
                            <>
                              <DropdownMenuItem
                                disabled={isBusy}
                                onClick={() =>
                                  ingestStore.mutate({ storeId: store.id })
                                }
                              >
                                <Upload className="mr-2 size-3.5" />
                                Ingest
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isBusy}
                                onClick={() =>
                                  ingestStore.mutate({
                                    storeId: store.id,
                                    clearTombstones: true,
                                  })
                                }
                              >
                                <RefreshCw className="mr-2 size-3.5" />
                                Re-ingest all
                              </DropdownMenuItem>
                            </>
                          )}
                          {!store.isPrimary &&
                            store.writeMode === "write" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setPrimary.mutate({ id: store.id })
                                }
                              >
                                <ShieldCheck className="mr-2 size-3.5" />
                                Make primary
                              </DropdownMenuItem>
                            )}
                          {!store.isPrimary && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => openArchiveConfirm(store.id)}
                              >
                                <Trash2 className="mr-2 size-3.5" />
                                Archive
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
