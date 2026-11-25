-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 OpenUnseal Contributors

-- Feed position: creation, or the latest report of progress on the area.
ALTER TABLE polygons
  ADD COLUMN IF NOT EXISTS feed_at TIMESTAMPTZ,
  -- A public call for help on private ground; it lapses on this date by itself.
  ADD COLUMN IF NOT EXISTS help_wanted_until TIMESTAMPTZ;

UPDATE polygons
SET feed_at = GREATEST(created_at, COALESCE(finished_at, created_at))
WHERE feed_at IS NULL;

ALTER TABLE polygons
  ALTER COLUMN feed_at SET DEFAULT NOW(),
  ALTER COLUMN feed_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'polygons_private_help_wanted'
  ) THEN
    ALTER TABLE polygons ADD CONSTRAINT polygons_private_help_wanted CHECK (
      space_type = 'private' OR help_wanted_until IS NULL
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_polygons_feed_at_id
  ON polygons (feed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_polygons_help_wanted
  ON polygons (help_wanted_until)
  WHERE help_wanted_until IS NOT NULL;

-- Message requests: until the person addressed answers, the person who started
-- the conversation may send one message.
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS request_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

UPDATE chat_threads t
SET request_sent_at = first_sent.at
FROM (
  SELECT m.thread_id, MIN(m.created_at) AS at
  FROM chat_messages m
  GROUP BY m.thread_id
) first_sent
WHERE first_sent.thread_id = t.id AND t.request_sent_at IS NULL;

UPDATE chat_threads t
SET accepted_at = answered.at
FROM (
  SELECT m.thread_id, MIN(m.created_at) AS at
  FROM chat_messages m
  INNER JOIN chat_threads ct ON ct.id = m.thread_id
  WHERE m.sender_user_id =
    CASE WHEN ct.initiator_is_low THEN ct.user_high_id ELSE ct.user_low_id END
  GROUP BY m.thread_id
) answered
WHERE answered.thread_id = t.id AND t.accepted_at IS NULL;

-- Contact attempts per calendar day. Only a date and a number are kept, never
-- who was looked up (GDPR Art. 5(1)(c)).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chat_contact_day DATE,
  ADD COLUMN IF NOT EXISTS chat_contact_count INTEGER NOT NULL DEFAULT 0
    CHECK (chat_contact_count >= 0);
