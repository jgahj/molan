BEGIN;

-- A creation book can be linked to another project.  Keep its versioned Bible
-- attached when the composite workspace/project scope moves atomically.
ALTER TABLE luna.creation_bibles
  DROP CONSTRAINT IF EXISTS creation_bibles_workspace_id_project_id_book_id_fkey;
ALTER TABLE luna.creation_bibles
  ADD CONSTRAINT creation_bibles_workspace_id_project_id_book_id_fkey
  FOREIGN KEY (workspace_id, project_id, book_id)
  REFERENCES luna.creation_books(workspace_id, project_id, id)
  ON UPDATE CASCADE;

COMMIT;
