import { pino, type Logger } from 'pino';

/**
 * Creates the application logger. Credential-like fields are redacted from the
 * output; full environment objects are never logged wholesale.
 */
export function createLogger(name: string, level: string): Logger {
  return pino({
    name,
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'headers.authorization',
        '*.apiKey',
        'apiKey',
        'token',
        '*.token',
        'authorization',
      ],
      censor: '[REDACTED]',
    },
  });
}