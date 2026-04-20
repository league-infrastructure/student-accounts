/**
 * Shared pino logger factory.
 *
 * Every service/route/job should get its logger via `createLogger(name)`
 * from this module. All output goes to two sinks:
 *
 *   1. process.stdout (visible in the dev terminal)
 *   2. the in-memory LogRingBuffer, which is exposed via /api/admin/logs
 *      for the admin Logs panel.
 *
 * Previously each module did `pino({ name })` directly, which wrote to
 * stdout only — errors from service code never appeared in the admin
 * Logs panel, only pino-http request-completion lines did.
 */

import pino from 'pino';
import { Writable } from 'stream';
import { logBuffer } from './logBuffer.js';

const bufferStream = new Writable({
  write(chunk, _encoding, callback) {
    logBuffer.ingest(chunk.toString());
    callback();
  },
});

const level =
  process.env.NODE_ENV === 'test'
    ? 'silent'
    : (process.env.LOG_LEVEL || 'info');

const multistream = pino.multistream([
  { stream: process.stdout },
  { stream: bufferStream },
]);

/**
 * Create a pino logger scoped to a named subsystem. Writes to stdout and
 * the in-memory ring buffer consumed by the admin Logs panel.
 */
export function createLogger(name: string): pino.Logger {
  return pino({ name, level }, multistream);
}

/** Re-export multistream so pino-http can share the same sinks. */
export { multistream as loggerStream };
