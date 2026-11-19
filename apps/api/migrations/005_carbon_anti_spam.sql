-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Unseal Contributors

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canonical_email_hash BYTEA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_canonical_email_hash
  ON users (canonical_email_hash)
  WHERE canonical_email_hash IS NOT NULL;

ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS flag_count INTEGER NOT NULL DEFAULT 0 CHECK (flag_count >= 0);

CREATE INDEX IF NOT EXISTS idx_polygons_unrated_cleanup
  ON polygons (created_at)
  WHERE status = 'proposed' AND upvotes = 0 AND downvotes = 0;

CREATE INDEX IF NOT EXISTS idx_polygons_flagged_unrated
  ON polygons (flag_count)
  WHERE flag_count > 0 AND upvotes = 0 AND downvotes = 0;

CREATE INDEX IF NOT EXISTS idx_polygons_created_at_desc
  ON polygons (created_at DESC);

CREATE TABLE IF NOT EXISTS polygon_flags (
  polygon_id UUID NOT NULL REFERENCES polygons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('implausible', 'already_unsealed', 'duplicate', 'spam')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (polygon_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_polygon_flags_user_id
  ON polygon_flags (user_id);

CREATE TABLE IF NOT EXISTS land_cover_exclusions (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('osm', 'alkis')),
  category TEXT NOT NULL CHECK (category IN ('water', 'forest_wood', 'park_green', 'farmland', 'railway', 'building')),
  geom GEOMETRY(Geometry, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_land_cover_exclusions_geom
  ON land_cover_exclusions USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_land_cover_exclusions_source_category
  ON land_cover_exclusions (source, category);
