CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_code_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pseudonym_lower ON users (LOWER(pseudonym));

CREATE TABLE IF NOT EXISTS reserved_pseudonyms (
  pseudonym_hash BYTEA PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);

CREATE TABLE IF NOT EXISTS polygons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  surface_type TEXT NOT NULL,
  note TEXT,
  area_m2 DOUBLE PRECISION NOT NULL,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polygons_geom ON polygons USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_polygons_user_created ON polygons (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polygons_score_created ON polygons (score DESC, created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_polygons_created_id ON polygons (created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS polygon_creations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polygon_creations_user_created ON polygon_creations (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS votes (
  polygon_id UUID NOT NULL REFERENCES polygons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (polygon_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes (user_id);
