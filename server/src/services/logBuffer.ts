export interface LogEntry {
  timestamp: string;
  level: number;
  msg: string;
  req?: { method: string; url: string };
  res?: { statusCode: number };
  err?: { message: string; stack?: string };
}

const LEVEL_VALUES: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

export class LogRingBuffer {
  private buffer: LogEntry[];
  private maxSize: number;

  constructor(maxSize = 500) {
    this.buffer = [];
    this.maxSize = maxSize;
  }

  push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /** Parse a pino JSON log line and push to buffer. */
  ingest(line: string): void {
    try {
      const obj = JSON.parse(line);
      const entry: LogEntry = {
        timestamp: obj.time ? new Date(obj.time).toISOString() : new Date().toISOString(),
        level: typeof obj.level === 'number' ? obj.level : (LEVEL_VALUES[obj.level] || 30),
        msg: obj.msg || obj.message || '',
      };
      if (obj.req) {
        entry.req = { method: obj.req.method, url: obj.req.url };
      }
      if (obj.res) {
        entry.res = { statusCode: obj.res.statusCode };
      }
      if (obj.err) {
        entry.err = { message: obj.err.message, stack: obj.err.stack };
      }
      this.push(entry);
    } catch {
      // Skip unparseable lines
    }
  }

  /** Get entries, newest first. Optionally filter by minimum level. */
  getEntries(minLevel?: number): LogEntry[] {
    let entries = [...this.buffer];
    if (minLevel !== undefined) {
      entries = entries.filter((e) => e.level >= minLevel);
    }
    return entries.reverse();
  }

  /** Current number of entries in the buffer. */
  get size(): number {
    return this.buffer.length;
  }
}

export const logBuffer = new LogRingBuffer(500);
