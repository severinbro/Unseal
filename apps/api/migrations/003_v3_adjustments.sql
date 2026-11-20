-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 OpenUnseal Contributors

DO $$
DECLARE
  con_record RECORD;
BEGIN
  FOR con_record IN
    SELECT c.conname
    FROM pg_constraint c
    INNER JOIN pg_class t ON t.oid = c.conrelid
    INNER JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'polygons'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE polygons DROP CONSTRAINT %I', con_record.conname);
  END LOOP;
END $$;

ALTER TABLE polygons
  ADD CONSTRAINT polygons_status_check
  CHECK (status IN ('proposed', 'in_progress', 'finished'));
