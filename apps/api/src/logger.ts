// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  level?: string;
  enabled?: boolean;
  stream?: DestinationStream;
}

interface SerializableRequest {
  id?: string | number;
  method?: string;
  url?: string;
}

/**
 * GDPR data minimisation (Art. 5(1)(c)): request log lines carry only the
 * request id, HTTP method and URL *path*. Headers are never logged because
 * behind the reverse proxy they contain the client IP (`X-Forwarded-For`),
 * `User-Agent` and `Referer`. Query strings are dropped because they can carry
 * address searches (`/api/v1/geocode?q=…`) and email action tokens.
 */
export function toLoggablePath(url: unknown): string | undefined {
  if (typeof url !== 'string') {
    return undefined;
  }
  const queryIndex = url.indexOf('?');
  const pathOnly = queryIndex === -1 ? url : url.slice(0, queryIndex);
  // Conversation and message ids would reveal who talks when (GDPR Art. 5(1)(c)).
  return pathOnly.replace(
    /^(\/api\/v1\/chats\/).*[0-9a-f]{8}-.*$/i,
    '$1[redacted]',
  );
}

const REDACTED_PATHS = [
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'password',
  '*.password',
  '*.*.password',
  'newPassword',
  '*.newPassword',
  '*.*.newPassword',
  'recoveryCode',
  '*.recoveryCode',
  '*.*.recoveryCode',
  'sessionToken',
  '*.sessionToken',
  '*.*.sessionToken',
];

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const pinoOptions: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    enabled: options.enabled ?? true,
    redact: {
      paths: REDACTED_PATHS,
      censor: '[Redacted]',
    },
    serializers: {
      req(req: SerializableRequest) {
        const serialized: Record<string, unknown> = {
          method: req.method,
          url: toLoggablePath(req.url),
        };
        if (req.id !== undefined) {
          serialized.id = req.id;
        }
        return serialized;
      },
      err: pino.stdSerializers.err,
    },
  };

  if (options.stream) {
    return pino(pinoOptions, options.stream);
  }
  return pino(pinoOptions);
}
