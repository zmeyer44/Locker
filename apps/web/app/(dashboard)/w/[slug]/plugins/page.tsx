'use client';

import { useMemo, useState } from 'react';
import {
  Puzzle,
  PlugZap,
  Settings2,
  Power,
  PowerOff,
  Trash2,
  Plus,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  PLUGIN_PERMISSION_LABELS,
  pluginManifestSchema,
  type PluginConfigField,
  type PluginManifest,
} from '@openstore/common';
import { trpc } from '@/lib/trpc/client';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

type ConfigDraft = Record<string, string>;

function getFieldInitialValue(
  field: PluginConfigField,
  config: Record<string, string | number | boolean | null>,
): string {
  const value = config[field.key];
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function normalizeConfigForSubmit(
  manifest: PluginManifest,
  draft: ConfigDraft,
): {
  config: Record<string, string | number | boolean | null>;
  secrets: Record<string, string>;
} {
  const config: Record<string, string | number | boolean | null> = {};
  const secrets: Record<string, string> = {};

  for (const field of manifest.configFields) {
    const rawValue = draft[field.key]?.trim() ?? '';

    if (field.type === 'secret') {
      if (rawValue.length > 0) {
        secrets[field.key] = rawValue;
      }
      continue;
    }

    if (rawValue.length === 0) {
      continue;
    }

    if (field.type === 'number') {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) continue;
      config[field.key] = parsed;
      continue;
    }

    if (field.type === 'boolean') {
      config[field.key] = rawValue === 'true';
      continue;
    }

    config[field.key] = rawValue;
  }

  return { config, secrets };
}

export default function PluginsPage() {
  const workspace = useWorkspace();
  const isAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const utils = trpc.useUtils();

  const { data: catalog, isLoading: catalogLoading } = trpc.plugins.catalog.useQuery();
  const { data: installed, isLoading: installedLoading } = trpc.plugins.installed.useQuery();

  const [activeManifestSlug, setActiveManifestSlug] = useState<string | null>(null);
  const [activeInstallId, setActiveInstallId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft>({});
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [manifestText, setManifestText] = useState(
    JSON.stringify(
      {
        slug: 'my-plugin',
        name: 'My Plugin',
        description: 'Describe what your plugin does.',
        version: '0.1.0',
        developer: 'Your Team',
        source: 'inhouse',
        permissions: ['files.read'],
        capabilities: ['file_actions'],
        actions: [
          {
            id: 'my-plugin.action',
            label: 'Run Action',
            target: 'file',
            requiresPermissions: ['files.read'],
          },
        ],
        configFields: [],
      },
      null,
      2,
    ),
  );

  const selectedManifest = useMemo(
    () => catalog?.find((entry) => entry.slug === activeManifestSlug) ?? null,
    [catalog, activeManifestSlug],
  );
  const selectedInstalled = useMemo(
    () => installed?.find((entry) => entry.id === activeInstallId) ?? null,
    [installed, activeInstallId],
  );

  const installMutation = trpc.plugins.install.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.plugins.catalog.invalidate(),
        utils.plugins.installed.invalidate(),
      ]);
      setActiveManifestSlug(null);
      setConfigDraft({});
      toast.success('Plugin installed');
    },
    onError: (error) => toast.error(error.message),
  });

  const updateConfigMutation = trpc.plugins.updateConfig.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.plugins.catalog.invalidate(),
        utils.plugins.installed.invalidate(),
      ]);
      setActiveInstallId(null);
      setConfigDraft({});
      toast.success('Plugin configuration updated');
    },
    onError: (error) => toast.error(error.message),
  });

  const setStatusMutation = trpc.plugins.setStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.plugins.catalog.invalidate(),
        utils.plugins.installed.invalidate(),
      ]);
      toast.success('Plugin status updated');
    },
    onError: (error) => toast.error(error.message),
  });

  const uninstallMutation = trpc.plugins.uninstall.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.plugins.catalog.invalidate(),
        utils.plugins.installed.invalidate(),
      ]);
      toast.success('Plugin uninstalled');
    },
    onError: (error) => toast.error(error.message),
  });

  const registerCustomMutation = trpc.plugins.registerCustom.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.plugins.catalog.invalidate(),
        utils.plugins.installed.invalidate(),
      ]);
      setRegisterDialogOpen(false);
      toast.success('Plugin registered to this workspace');
    },
    onError: (error) => toast.error(error.message),
  });

  const installedBySlug = useMemo(() => {
    const map = new Map<string, NonNullable<typeof installed>[number]>();
    for (const plugin of installed ?? []) {
      map.set(plugin.pluginSlug, plugin);
    }
    return map;
  }, [installed]);

  const availableCatalog = useMemo(
    () => (catalog ?? []).filter((entry) => !installedBySlug.has(entry.slug)),
    [catalog, installedBySlug],
  );

  const openInstallDialog = (manifest: PluginManifest) => {
    if (!isAdmin) return;
    const nextDraft: ConfigDraft = {};
    for (const field of manifest.configFields) {
      nextDraft[field.key] = '';
    }
    setConfigDraft(nextDraft);
    setActiveManifestSlug(manifest.slug);
  };

  const openConfigureDialog = (pluginId: string) => {
    if (!isAdmin) return;
    const plugin = installed?.find((entry) => entry.id === pluginId);
    if (!plugin) return;

    const nextDraft: ConfigDraft = {};
    for (const field of plugin.manifest.configFields) {
      nextDraft[field.key] = getFieldInitialValue(field, plugin.config);
    }
    setConfigDraft(nextDraft);
    setActiveInstallId(pluginId);
  };

  const handleInstall = async () => {
    if (!selectedManifest) return;
    const { config, secrets } = normalizeConfigForSubmit(
      selectedManifest,
      configDraft,
    );

    await installMutation.mutateAsync({
      slug: selectedManifest.slug,
      grantedPermissions: selectedManifest.permissions,
      config,
      secrets,
    });
  };

  const handleConfigure = async () => {
    if (!selectedInstalled) return;
    const { config, secrets } = normalizeConfigForSubmit(
      selectedInstalled.manifest,
      configDraft,
    );

    await updateConfigMutation.mutateAsync({
      id: selectedInstalled.id,
      config,
      secrets,
    });
  };

  const renderConfigField = (field: PluginConfigField) => {
    const value = configDraft[field.key] ?? '';
    const setValue = (nextValue: string) =>
      setConfigDraft((current) => ({ ...current, [field.key]: nextValue }));

    const requiredLabel = field.required ? ' *' : '';
    const inputType =
      field.type === 'secret'
        ? 'password'
        : field.type === 'url'
          ? 'url'
          : field.type === 'number'
            ? 'number'
            : 'text';

    return (
      <div key={field.key} className="space-y-1.5">
        <label className="text-sm font-medium">
          {field.label}
          {requiredLabel}
        </label>
        {field.type === 'boolean' ? (
          <select
            value={value || 'false'}
            onChange={(event) => setValue(event.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
        ) : (
          <Input
            type={inputType}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={field.placeholder}
          />
        )}
        {field.description ? (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <Puzzle className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Plugins</span>
        </div>
        {isAdmin ? (
          <div className="px-4">
            <Button size="sm" variant="outline" onClick={() => setRegisterDialogOpen(true)}>
              <Plus />
              Register In-House Plugin
            </Button>
          </div>
        ) : null}
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-8">
        {!isAdmin ? (
          <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-4 flex items-start gap-2">
            <AlertTriangle className="size-4 text-amber-700 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-900">
              You can use installed plugins, but only workspace admins can install
              or configure them.
            </p>
          </div>
        ) : null}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <PlugZap className="size-4 text-primary" />
            <h2 className="text-lg font-semibold">Installed Plugins</h2>
          </div>
          {installedLoading ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              Loading installed plugins...
            </div>
          ) : !installed || installed.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              No plugins installed yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {installed.map((plugin) => (
                <div key={plugin.id} className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{plugin.manifest.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {plugin.manifest.description}
                      </p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-muted text-muted-foreground">
                      {plugin.status}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Granted permissions: {plugin.grantedPermissions.length}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {plugin.grantedPermissions.map((permission) => (
                      <span
                        key={permission}
                        className="text-[11px] px-2 py-1 rounded bg-muted text-muted-foreground"
                        title={PLUGIN_PERMISSION_LABELS[permission].description}
                      >
                        {PLUGIN_PERMISSION_LABELS[permission].label}
                      </span>
                    ))}
                  </div>

                  {plugin.missingConfigFields.length > 0 ? (
                    <div className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Missing required config: {plugin.missingConfigFields.join(', ')}
                    </div>
                  ) : null}

                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfigureDialog(plugin.id)}
                      >
                        <Settings2 />
                        Configure
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setStatusMutation.mutate({
                            id: plugin.id,
                            status: plugin.status === 'active' ? 'disabled' : 'active',
                          })
                        }
                        disabled={setStatusMutation.isPending}
                      >
                        {plugin.status === 'active' ? (
                          <>
                            <PowerOff />
                            Disable
                          </>
                        ) : (
                          <>
                            <Power />
                            Enable
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (confirm(`Uninstall ${plugin.manifest.name}?`)) {
                            uninstallMutation.mutate({ id: plugin.id });
                          }
                        }}
                        disabled={uninstallMutation.isPending}
                      >
                        <Trash2 />
                        Uninstall
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Puzzle className="size-4 text-primary" />
            <h2 className="text-lg font-semibold">Plugin Catalog</h2>
          </div>
          {catalogLoading ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              Loading plugin catalog...
            </div>
          ) : !availableCatalog || availableCatalog.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              No additional plugins available for this workspace.
            </div>
          ) : (
            <div className="grid gap-3">
              {availableCatalog.map((plugin) => (
                <div key={plugin.slug} className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{plugin.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {plugin.description}
                      </p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-muted text-muted-foreground">
                      {plugin.source}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {plugin.permissions.map((permission) => (
                      <span
                        key={permission}
                        className="text-[11px] px-2 py-1 rounded bg-muted text-muted-foreground"
                        title={PLUGIN_PERMISSION_LABELS[permission].description}
                      >
                        {PLUGIN_PERMISSION_LABELS[permission].label}
                      </span>
                    ))}
                  </div>

                  {isAdmin ? (
                    <div>
                      <Button size="sm" onClick={() => openInstallDialog(plugin)}>
                        Install Plugin
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={!!selectedManifest}
        onOpenChange={(open) => {
          if (!open) {
            setActiveManifestSlug(null);
            setConfigDraft({});
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Install {selectedManifest?.name}</DialogTitle>
            <DialogDescription>
              Review permissions and provide any required configuration before
              installing.
            </DialogDescription>
          </DialogHeader>

          {selectedManifest ? (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium">Permissions</p>
                <div className="space-y-1">
                  {selectedManifest.permissions.map((permission) => (
                    <div key={permission}>
                      <p className="text-xs font-medium">
                        {PLUGIN_PERMISSION_LABELS[permission].label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {PLUGIN_PERMISSION_LABELS[permission].description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {selectedManifest.configFields.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Configuration</p>
                  {selectedManifest.configFields.map(renderConfigField)}
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActiveManifestSlug(null);
                setConfigDraft({});
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleInstall} disabled={installMutation.isPending}>
              {installMutation.isPending ? <Loader2 className="animate-spin" /> : null}
              Install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedInstalled}
        onOpenChange={(open) => {
          if (!open) {
            setActiveInstallId(null);
            setConfigDraft({});
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Configure {selectedInstalled?.manifest.name}
            </DialogTitle>
            <DialogDescription>
              Update runtime configuration and secret values for this plugin.
            </DialogDescription>
          </DialogHeader>

          {selectedInstalled ? (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {selectedInstalled.manifest.configFields.length === 0 ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  This plugin does not require any configuration.
                </div>
              ) : (
                selectedInstalled.manifest.configFields.map(renderConfigField)
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActiveInstallId(null);
                setConfigDraft({});
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfigure}
              disabled={updateConfigMutation.isPending}
            >
              {updateConfigMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Register In-House Plugin</DialogTitle>
            <DialogDescription>
              Paste a plugin manifest JSON document. It will become available in this
              workspace catalog.
            </DialogDescription>
          </DialogHeader>

          <textarea
            value={manifestText}
            onChange={(event) => setManifestText(event.target.value)}
            className="w-full h-72 rounded-md border bg-background p-3 font-mono text-xs"
            spellCheck={false}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                try {
                  const parsed = JSON.parse(manifestText) as unknown;
                  const manifest = pluginManifestSchema.parse(parsed);
                  registerCustomMutation.mutate({ manifest });
                } catch {
                  toast.error('Invalid JSON manifest');
                }
              }}
              disabled={registerCustomMutation.isPending}
            >
              {registerCustomMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Register Plugin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
