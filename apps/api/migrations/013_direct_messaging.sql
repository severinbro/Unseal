-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 OpenUnseal Contributors

-- Opt-in 1:1 messaging, off by default (GDPR Art. 25(2)).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allow_direct_messages BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_high_id UUID REFERENCES users(id) ON DELETE SET NULL,
  initiator_is_low BOOLEAN NOT NULL,
  opened_via_polygon_id UUID REFERENCES polygons(id) ON DELETE SET NULL,
  -- Creation time of the newest message the participant has read, not of the reading.
  low_last_read_at TIMESTAMPTZ,
  high_last_read_at TIMESTAMPTZ,
  blocked_by_low BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_by_high BOOLEAN NOT NULL DEFAULT FALSE,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_low_id < user_high_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_pair
  ON chat_threads (user_low_id, user_high_id)
  WHERE user_low_id IS NOT NULL AND user_high_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_threads_low
  ON chat_threads (user_low_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_high
  ON chat_threads (user_high_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_opened_via
  ON chat_threads (opened_via_polygon_id)
  WHERE opened_via_polygon_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  -- Messages are erased with their sender, so there is no anonymised remainder.
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  referenced_polygon_id UUID REFERENCES polygons(id) ON DELETE SET NULL,
  referenced_comment_id UUID REFERENCES polygon_comments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON chat_messages (thread_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON chat_messages (sender_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created
  ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_polygon
  ON chat_messages (referenced_polygon_id)
  WHERE referenced_polygon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_comment
  ON chat_messages (referenced_comment_id)
  WHERE referenced_comment_id IS NOT NULL;
