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
  headers?: Record<string, unknown>;
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
          url: req.url,
        };
        if (req.id !== undefined) {
          serialized.id = req.id;
        }
        if (req.headers !== undefined && req.headers !== null) {
          serialized.headers = { ...req.headers };
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
