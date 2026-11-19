-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Unseal Contributors

ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS polygon_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polygon_id UUID NOT NULL REFERENCES polygons(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES polygon_comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) >= 1 AND char_length(body) <= 1000),
  upvotes INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT polygon_comments_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_polygon_comments_polygon_rating
  ON polygon_comments (polygon_id, upvotes DESC, created_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_polygon_comments_parent_id
  ON polygon_comments (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_polygon_comments_user_id
  ON polygon_comments (user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS polygon_comment_votes (
  comment_id UUID NOT NULL REFERENCES polygon_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_polygon_comment_votes_user_id
  ON polygon_comment_votes (user_id);
