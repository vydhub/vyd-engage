import { pino } from 'pino';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Secret-redaction paths. pino-http logs the full req/res (incl. headers), and
 * services log arbitrary meta objects — these paths censor anything that could
 * leak credentials (JWT, refresh cookies, Mercado Pago / API tokens, passwords).
 */
const redactPaths = [
  // pino-http req/res serializers
  'req.headers.authorization',
  'req.headers.cookie',
  // Chave de API e assinatura das integrações da Captura: nenhum segredo em log (spec-mãe).
  'req.headers["x-api-key"]',
  'req.headers["x-vyd-assinatura"]',
  'req.headers["x-webhook-signature"]',
  'res.headers["set-cookie"]',
  // generic meta shapes used across services
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'jwt',
  'apiKey',
  'secret',
  '*.authorization',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
];

/**
 * Base pino instance. In production it emits raw JSON lines (Railway parses them);
 * in development it pretty-prints via pino-pretty (devDependency, never bundled in prod).
 */
export const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});

type LogMeta = Record<string, unknown>;

/**
 * Normalizes an arbitrary meta value into a pino merging-object. Some callers
 * pass plain objects, others pass an Error or a primitive (the old logger took
 * `any`) — keep all of those working and serialize Errors under `err`.
 */
function toObj(meta?: unknown): LogMeta {
  if (meta === undefined || meta === null) return {};
  if (meta instanceof Error) return { err: meta };
  if (typeof meta === 'object') return meta as LogMeta;
  return { detail: meta };
}

/**
 * Thin wrapper that preserves the historical `logger.info/warn/error/debug`
 * surface (message-first + optional meta) so the ~35 services need zero changes.
 */
class Logger {
  info(message: string, meta?: unknown): void {
    baseLogger.info(toObj(meta), message);
  }

  warn(message: string, meta?: unknown): void {
    baseLogger.warn(toObj(meta), message);
  }

  error(message: string, error?: Error | unknown, meta?: unknown): void {
    if (error instanceof Error) {
      baseLogger.error({ err: error, ...toObj(meta) }, message);
    } else if (error !== undefined) {
      baseLogger.error({ error, ...toObj(meta) }, message);
    } else {
      baseLogger.error(toObj(meta), message);
    }
  }

  debug(message: string, meta?: unknown): void {
    baseLogger.debug(toObj(meta), message);
  }
}

export const logger = new Logger();
