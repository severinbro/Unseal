-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Unseal Contributors

-- GDPR data minimisation (Art. 5(1)(c)): author activity is kept with day precision only.
-- Public API responses expose just a coarse "active within the last 30 days" flag.
UPDATE users
SET last_login_at = date_trunc('day', last_login_at)
WHERE last_login_at IS NOT NULL
  AND last_login_at <> date_trunc('day', last_login_at);
