-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 OpenUnseal Contributors

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
