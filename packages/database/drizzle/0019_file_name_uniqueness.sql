-- Deduplicate existing files: for rows with duplicate (workspace_id, folder_id, name)
-- where status = 'ready', rename later duplicates by appending " (N)" to the name.
-- The earliest file (by created_at) keeps its original name.

-- Handle files within folders
WITH dupes_in_folder AS (
  SELECT id, name,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, folder_id, name ORDER BY created_at
    ) AS rn
  FROM files
  WHERE status = 'ready' AND folder_id IS NOT NULL
)
UPDATE files
SET name = dupes_in_folder.name || ' (' || (dupes_in_folder.rn - 1) || ')'
FROM dupes_in_folder
WHERE files.id = dupes_in_folder.id AND dupes_in_folder.rn > 1;--> statement-breakpoint

-- Handle files at workspace root (folder_id IS NULL)
WITH dupes_at_root AS (
  SELECT id, name,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, name ORDER BY created_at
    ) AS rn
  FROM files
  WHERE status = 'ready' AND folder_id IS NULL
)
UPDATE files
SET name = dupes_at_root.name || ' (' || (dupes_at_root.rn - 1) || ')'
FROM dupes_at_root
WHERE files.id = dupes_at_root.id AND dupes_at_root.rn > 1;--> statement-breakpoint

-- Partial unique index for files within a folder
CREATE UNIQUE INDEX files_unique_name_in_folder_idx
ON files (workspace_id, folder_id, name)
WHERE status = 'ready' AND folder_id IS NOT NULL;--> statement-breakpoint

-- Partial unique index for files at workspace root (folder_id IS NULL)
CREATE UNIQUE INDEX files_unique_name_at_root_idx
ON files (workspace_id, name)
WHERE status = 'ready' AND folder_id IS NULL;
