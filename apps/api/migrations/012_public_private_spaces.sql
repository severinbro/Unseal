-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 OpenUnseal Contributors

-- Public/private classification. Rows that predate it stay 'unknown': nothing
-- is asserted about ground that was never classified.
ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS space_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (space_type IN ('public', 'private', 'unknown')),
  ADD COLUMN IF NOT EXISTS detected_space_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (detected_space_type IN ('public', 'private', 'unknown')),
  ADD COLUMN IF NOT EXISTS private_overlap_ratio DOUBLE PRECISION
    CHECK (private_overlap_ratio BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS space_verification TEXT NOT NULL DEFAULT 'unverified'
    CHECK (space_verification IN ('gis_verified', 'user_override', 'admin_override', 'unverified')),
  ADD COLUMN IF NOT EXISTS space_verification_source TEXT
    CHECK (space_verification_source IN ('alkis', 'osm_local', 'osm_overpass')),
  ADD COLUMN IF NOT EXISTS open_for_public_access BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allow_chat_contact BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS entitlement_confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'polygons_private_contact_flags'
  ) THEN
    ALTER TABLE polygons ADD CONSTRAINT polygons_private_contact_flags CHECK (
      space_type = 'private'
      OR (NOT open_for_public_access AND NOT allow_chat_contact)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_polygons_space_created_id
  ON polygons (space_type, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_polygons_status_created_id
  ON polygons (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_polygons_user_override
  ON polygons (space_verification)
  WHERE space_verification = 'user_override';

-- Attribution rows also credit reference datasets; those rows are never pruned
-- because stored classifications keep depending on them.
ALTER TABLE import_attributions
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'polygon_import'
    CHECK (purpose IN ('polygon_import', 'space_zones', 'land_cover'));

CREATE TABLE IF NOT EXISTS space_reference_zones (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('alkis', 'osm_local')),
  tier TEXT NOT NULL CHECK (tier IN ('explicit_private', 'public', 'landuse_private')),
  category TEXT NOT NULL,
  import_attribution_id UUID REFERENCES import_attributions(id) ON DELETE RESTRICT,
  geom GEOMETRY(Geometry, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_space_reference_zones_geom
  ON space_reference_zones USING GIST (geom);

-- Versioned acceptance: accounts on an older version must accept again.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_version INTEGER NOT NULL DEFAULT 1;
