import { z } from "zod";

export const PLUGIN_SOURCES = ["official", "community", "inhouse"] as const;
export type PluginSource = (typeof PLUGIN_SOURCES)[number];

export const PLUGIN_STATUSES = ["active", "disabled"] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const PLUGIN_PERMISSIONS = [
  "files.read",
  "files.write",
  "folders.read",
  "folders.write",
  "search.read",
  "search.enhance",
  "links.read",
  "links.write",
  "workspace.read",
  "workspace.members.read",
  "external.network",
  "external.storage-service",
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PLUGIN_PERMISSION_LABELS: Record<
  PluginPermission,
  { label: string; description: string }
> = {
  "files.read": {
    label: "Read Files",
    description:
      "Read file names, metadata, and content pointers in this workspace.",
  },
  "files.write": {
    label: "Write Files",
    description: "Create, update, move, or delete files in this workspace.",
  },
  "folders.read": {
    label: "Read Folders",
    description:
      "Read folder structure, metadata, and hierarchy in this workspace.",
  },
  "folders.write": {
    label: "Write Folders",
    description: "Create, rename, move, or delete folders in this workspace.",
  },
  "search.read": {
    label: "Search Access",
    description:
      "Read searchable metadata to respond to discovery and search requests.",
  },
  "search.enhance": {
    label: "Search Enhancement",
    description:
      "Re-rank or enrich native search results for better discovery.",
  },
  "links.read": {
    label: "Read Links",
    description:
      "Read share, tracked, and upload link metadata for this workspace.",
  },
  "links.write": {
    label: "Write Links",
    description:
      "Create or update share, tracked, and upload links for this workspace.",
  },
  "workspace.read": {
    label: "Read Workspace",
    description: "Read workspace-level settings and metadata.",
  },
  "workspace.members.read": {
    label: "Read Members",
    description: "Read workspace member list and roles.",
  },
  "external.network": {
    label: "Outbound Network",
    description: "Call external APIs and services on behalf of this workspace.",
  },
  "external.storage-service": {
    label: "External Storage Service",
    description:
      "Transfer files to and from external storage services (Google Drive, Dropbox, etc.).",
  },
};

export const PLUGIN_CAPABILITIES = [
  "workspace_search",
  "file_actions",
  "folder_actions",
  "import_export",
  "document_transcription",
] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_ACTION_TARGETS = ["file", "folder", "workspace"] as const;
export type PluginActionTarget = (typeof PLUGIN_ACTION_TARGETS)[number];

export const PLUGIN_CONFIG_FIELD_TYPES = [
  "text",
  "url",
  "number",
  "boolean",
  "secret",
] as const;
export type PluginConfigFieldType = (typeof PLUGIN_CONFIG_FIELD_TYPES)[number];

export const pluginSourceSchema = z.enum(PLUGIN_SOURCES);
export const pluginStatusSchema = z.enum(PLUGIN_STATUSES);
export const pluginPermissionSchema = z.enum(PLUGIN_PERMISSIONS);
export const pluginCapabilitySchema = z.enum(PLUGIN_CAPABILITIES);
export const pluginActionTargetSchema = z.enum(PLUGIN_ACTION_TARGETS);
export const pluginConfigFieldTypeSchema = z.enum(PLUGIN_CONFIG_FIELD_TYPES);

export const pluginConfigFieldSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(
      /^[A-Za-z][A-Za-z0-9_.-]*$/,
      'Config field keys must start with a letter and contain only letters, numbers, ".", "_" or "-"',
    ),
  label: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  type: pluginConfigFieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
});

export const pluginTranscriptionSchema = z.object({
  supportedMimeTypes: z.array(z.string()).min(1),
  priority: z.number().int().min(0).max(100).default(50),
});

export const pluginActionSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(120)
    .regex(
      /^[a-z][a-z0-9_.:-]*$/,
      'Action ids must start with a letter and contain lowercase letters, numbers, ".", "_", ":" or "-"',
    ),
  label: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  target: pluginActionTargetSchema,
  requiresPermissions: z.array(pluginPermissionSchema).default([]),
});

export const pluginManifestSchema = z
  .object({
    slug: z
      .string()
      .min(2)
      .max(80)
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        "Plugin slug must be lowercase letters, numbers, and hyphens",
      ),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(1200),
    version: z.string().min(1).max(40),
    developer: z.string().min(1).max(120),
    homepageUrl: z.string().url().optional(),
    source: pluginSourceSchema.default("community"),
    permissions: z.array(pluginPermissionSchema).min(1),
    capabilities: z.array(pluginCapabilitySchema).default([]),
    actions: z.array(pluginActionSchema).default([]),
    configFields: z.array(pluginConfigFieldSchema).default([]),
    transcription: pluginTranscriptionSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const permissionSet = new Set(value.permissions);
    const duplicatedPermissions =
      value.permissions.filter(
        (permission, index) => value.permissions.indexOf(permission) !== index,
      ) ?? [];
    for (const permission of duplicatedPermissions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate permission "${permission}"`,
        path: ["permissions"],
      });
    }

    for (const action of value.actions) {
      for (const requiredPermission of action.requiresPermissions) {
        if (!permissionSet.has(requiredPermission)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Action "${action.id}" requires undeclared permission "${requiredPermission}"`,
            path: ["actions"],
          });
        }
      }
    }

    const configKeys = new Set<string>();
    for (const field of value.configFields) {
      if (configKeys.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate config field "${field.key}"`,
          path: ["configFields"],
        });
      }
      configKeys.add(field.key);
    }

    if (
      value.transcription &&
      !value.capabilities.includes("document_transcription")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Plugins with a "transcription" field must include the "document_transcription" capability',
        path: ["transcription"],
      });
    }
  });

export const registerWorkspacePluginSchema = z.object({
  manifest: pluginManifestSchema,
});

const pluginConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const installWorkspacePluginSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  grantedPermissions: z.array(pluginPermissionSchema).optional(),
  config: z.record(z.string(), pluginConfigValueSchema).optional(),
  secrets: z.record(z.string(), z.string().min(1)).optional(),
});

export const updateWorkspacePluginConfigSchema = z.object({
  id: z.string().uuid(),
  config: z.record(z.string(), pluginConfigValueSchema).optional(),
  secrets: z.record(z.string(), z.string().min(1)).optional(),
});

export const setWorkspacePluginStatusSchema = z.object({
  id: z.string().uuid(),
  status: pluginStatusSchema,
});

export const listPluginActionsSchema = z.object({
  target: pluginActionTargetSchema,
});

export const runPluginActionSchema = z.object({
  workspacePluginId: z.string().uuid(),
  actionId: z.string().min(3).max(120),
  target: pluginActionTargetSchema,
  targetId: z.string().uuid(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginAction = z.infer<typeof pluginActionSchema>;
export type PluginConfigField = z.infer<typeof pluginConfigFieldSchema>;
