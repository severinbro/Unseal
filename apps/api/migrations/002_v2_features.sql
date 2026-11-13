ALTER TABLE users
  ALTER COLUMN recovery_code_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));

UPDATE users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL AND email IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS reserved_emails (
  email_hash BYTEA PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash BYTEA UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose
  ON email_tokens (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS municipalities (
  id SERIAL PRIMARY KEY,
  ags TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  designation TEXT,
  state_code TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_municipalities_geom
  ON municipalities USING GIST (geom);

ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'finished')),
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS photo_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_polygons_municipality_score
  ON polygons (municipality_id, status, score DESC);

CREATE INDEX IF NOT EXISTS idx_polygons_status
  ON polygons (status);

CREATE TABLE IF NOT EXISTS polygon_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polygon_id UUID NOT NULL REFERENCES polygons(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT UNIQUE NOT NULL,
  thumb_name TEXT UNIQUE NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  gps_verified BOOLEAN NOT NULL DEFAULT FALSE,
  real_votes INTEGER NOT NULL DEFAULT 0,
  fake_votes INTEGER NOT NULL DEFAULT 0,
  credibility_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polygon_photos_polygon_created
  ON polygon_photos (polygon_id, created_at DESC, id ASC);

CREATE TABLE IF NOT EXISTS polygon_photo_votes (
  photo_id UUID NOT NULL REFERENCES polygon_photos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (photo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_polygon_photo_votes_user_id
  ON polygon_photo_votes (user_id);
