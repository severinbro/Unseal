// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import { ApiError, UuidParamSchema } from '@openunseal/shared';

export interface TimeCursor {
  timestamp: string;
  id: string;
}

/** `timestamp` is PostgreSQL text with full precision, so ties page correctly. */
export function encodeTimeCursor(timestamp: string, id: string): string {
  return Buffer.from(`${timestamp}|${id}`, 'utf8').toString('base64url');
}

const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::?\d{2})?$/;

export function decodeTimeCursor(raw: string): TimeCursor {
  const [timestamp, id, ...rest] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  if (
    timestamp === undefined ||
    id === undefined ||
    rest.length > 0 ||
    !TIMESTAMP_RE.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))) ||
    !UuidParamSchema.safeParse(id).success
  ) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid pagination cursor.');
  }
  return { timestamp, id };
}
