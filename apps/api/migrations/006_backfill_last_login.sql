-- Backfill last_login_at for accounts that authenticated prior to migration 005
UPDATE users u
SET last_login_at = COALESCE(
  (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id),
  (SELECT MAX(p.created_at) FROM polygons p WHERE p.user_id = u.id),
  u.email_verified_at
)
WHERE u.last_login_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id)
    OR EXISTS (SELECT 1 FROM polygons p WHERE p.user_id = u.id)
  );
