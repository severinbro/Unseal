-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Unseal Contributors

-- Persist upstream dataset license & attribution notices for admin bulk imports
-- so the public ODbL-1.0 GeoJSON export retains required credits and waiver records.
CREATE TABLE IF NOT EXISTS import_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license TEXT NOT NULL,
  attribution_text TEXT NOT NULL,
  source_url TEXT,
  waiver_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS import_attribution_id UUID
    REFERENCES import_attributions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_polygons_import_attribution_id
  ON polygons (import_attribution_id)
  WHERE import_attribution_id IS NOT NULL;
