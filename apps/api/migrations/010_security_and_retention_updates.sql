-- Persistent failed-login counter, re-verification lock after 5 failed attempts,
-- and permanent lock-in timestamp for trusted contributor status once earned.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (failed_login_attempts >= 0),
  ADD COLUMN IF NOT EXISTS login_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMPTZ;

UPDATE users u
SET trusted_at = COALESCE(u.trusted_at, NOW())
WHERE u.trusted_at IS NULL
  AND (
    u.role = 'admin'
    OR (
      u.created_at <= NOW() - INTERVAL '14 days'
      AND (
        SELECT COUNT(*)
        FROM polygons p_clean
        WHERE p_clean.user_id = u.id
          AND p_clean.score > 0
      ) >= 3
    )
  );

-- Remove any pre-existing self-votes on photos and comments and recompute aggregates.
WITH removed_photo_self_votes AS (
  DELETE FROM polygon_photo_votes pv
  USING polygon_photos pp
  WHERE pv.photo_id = pp.id
    AND pp.user_id IS NOT NULL
    AND pv.user_id = pp.user_id
  RETURNING pv.photo_id
),
affected_photos AS (
  SELECT DISTINCT photo_id FROM removed_photo_self_votes
)
UPDATE polygon_photos pp
SET
  real_votes = COALESCE(
    (SELECT COUNT(*) FILTER (WHERE value = 1) FROM polygon_photo_votes pv WHERE pv.photo_id = pp.id),
    0
  )::int,
  fake_votes = COALESCE(
    (SELECT COUNT(*) FILTER (WHERE value = -1) FROM polygon_photo_votes pv WHERE pv.photo_id = pp.id),
    0
  )::int,
  credibility_score = COALESCE(
    (SELECT SUM(value) FROM polygon_photo_votes pv WHERE pv.photo_id = pp.id),
    0
  )::int
FROM affected_photos ap
WHERE pp.id = ap.photo_id;

WITH removed_comment_self_votes AS (
  DELETE FROM polygon_comment_votes cv
  USING polygon_comments pc
  WHERE cv.comment_id = pc.id
    AND pc.user_id IS NOT NULL
    AND cv.user_id = pc.user_id
  RETURNING cv.comment_id
),
affected_comments AS (
  SELECT DISTINCT comment_id FROM removed_comment_self_votes
)
UPDATE polygon_comments pc
SET upvotes = COALESCE(
  (SELECT COUNT(*) FROM polygon_comment_votes cv WHERE cv.comment_id = pc.id),
  0
)::int
FROM affected_comments ac
WHERE pc.id = ac.comment_id;

-- Only proposed polygons without ratings, photos, or comments are eligible for stale cleanup.
DROP INDEX IF EXISTS idx_polygons_unrated_cleanup;

CREATE INDEX IF NOT EXISTS idx_polygons_unrated_cleanup
  ON polygons (created_at)
  WHERE status = 'proposed'
    AND upvotes = 0
    AND downvotes = 0
    AND photo_count = 0
    AND comment_count = 0;
