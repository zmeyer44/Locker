-- Column to track which file a pending upload will replace on completion.
-- Server-only — never exposed to clients. Null for non-replace uploads.
ALTER TABLE files ADD COLUMN replaces_file_id UUID;--> statement-breakpoint

-- Deduplicate existing files with colliding (workspace_id, folder_id, name)
-- where status = 'ready'. The earliest file (by created_at) keeps its name.
-- Later duplicates get renamed to "name (N)" using the first available suffix
-- that doesn't collide with any existing name in the same folder.
DO $$
DECLARE
  rec RECORD;
  new_name TEXT;
  suffix INT;
  stem TEXT;
  ext TEXT;
  dot_pos INT;
BEGIN
  FOR rec IN
    WITH ranked AS (
      SELECT id, workspace_id, folder_id, name,
        ROW_NUMBER() OVER (
          PARTITION BY workspace_id, folder_id, name ORDER BY created_at
        ) AS rn
      FROM files
      WHERE status = 'ready'
    )
    SELECT id, workspace_id, folder_id, name
    FROM ranked
    WHERE rn > 1
    ORDER BY workspace_id, folder_id, name
  LOOP
    -- Split name into stem and extension
    dot_pos := length(rec.name) - position('.' in reverse(rec.name));
    IF dot_pos > 0 AND dot_pos < length(rec.name) THEN
      stem := left(rec.name, dot_pos);
      ext := substring(rec.name FROM dot_pos + 1);
    ELSE
      stem := rec.name;
      ext := '';
    END IF;

    -- Find the smallest suffix that doesn't collide
    suffix := 1;
    LOOP
      new_name := stem || ' (' || suffix || ')' || ext;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM files
        WHERE workspace_id = rec.workspace_id
          AND status = 'ready'
          AND name = new_name
          AND (folder_id = rec.folder_id
               OR (folder_id IS NULL AND rec.folder_id IS NULL))
      );
      suffix := suffix + 1;
    END LOOP;

    UPDATE files SET name = new_name WHERE id = rec.id;
  END LOOP;
END $$;--> statement-breakpoint

-- Partial unique index for files within a folder
CREATE UNIQUE INDEX files_unique_name_in_folder_idx
ON files (workspace_id, folder_id, name)
WHERE status = 'ready' AND folder_id IS NOT NULL;--> statement-breakpoint

-- Partial unique index for files at workspace root (folder_id IS NULL)
CREATE UNIQUE INDEX files_unique_name_at_root_idx
ON files (workspace_id, name)
WHERE status = 'ready' AND folder_id IS NULL;
