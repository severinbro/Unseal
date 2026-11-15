-- Provenance & auto-clipping metadata on polygons (non-personal spatial attributes).
ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'citizen'
    CHECK (origin IN ('citizen', 'initiative_import', 'remote_sensing')),
  ADD COLUMN IF NOT EXISTS was_auto_clipped BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS clipped_area_m2 DOUBLE PRECISION NOT NULL DEFAULT 0
    CHECK (clipped_area_m2 >= 0);

CREATE INDEX IF NOT EXISTS idx_polygons_origin
  ON polygons (origin);

-- GDPR Art. 5(1)(c) & Art. 25: anonymous daily aggregate counters only (no user_id,
-- no polygon_id, no IP address, no sub-day timestamps) for VGI quality & dynamics research.
CREATE TABLE IF NOT EXISTS daily_telemetry_counters (
  day DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT 'none',
  event_count BIGINT NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  area_sum_m2 DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (area_sum_m2 >= 0),
  PRIMARY KEY (day, metric, dimension)
);
