// Structured logging shared by the web app, its background worker and the CLI.
//
// Entries carry a level, a scope (which part of the pipeline), a short message and optional
// data — counts, ids, sizes and timings only. Story text is never logged: scripts may be
// confidential, and logs are meant to be safe to attach to a bug report.
//
// Entries go to an in-memory ring buffer (the app's Logbook reads it), to subscribers (the worker
// forwards its entries to the page this way), and optionally to the console.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Milliseconds since the Unix epoch. */
  t: number;
  level: LogLevel;
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
  /** Duration in milliseconds, for timed operations. */
  ms?: number;
  /** Where the entry came from: 'page', 'worker' or 'cli'. */
  src?: string;
}

export const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const CAPACITY = 1000;

type Sink = (e: LogEntry) => void;

class LogBook {
  private entries: LogEntry[] = [];
  private sinks = new Set<Sink>();
  /** Minimum level mirrored to the console ('off' = none). */
  consoleLevel: LogLevel | 'off' = 'warn';
  /** Minimum level recorded at all. */
  level: LogLevel = 'debug';
  src = 'page';

  write(e: LogEntry) {
    if (LEVELS[e.level] < LEVELS[this.level]) return;
    this.entries.push(e);
    if (this.entries.length > CAPACITY) this.entries.splice(0, this.entries.length - CAPACITY);
    for (const s of this.sinks) s(e);
    if (this.consoleLevel !== 'off' && LEVELS[e.level] >= LEVELS[this.consoleLevel] && typeof console !== 'undefined') {
      const fn = e.level === 'error' ? console.error : e.level === 'warn' ? console.warn : console.log;
      fn(`[${e.scope}] ${e.msg}`, ...(e.data ? [e.data] : []), ...(e.ms !== undefined ? [`${e.ms} ms`] : []));
    }
  }

  /** Adds entries recorded elsewhere (e.g. in the worker) without re-forwarding them to the console. */
  import(entries: LogEntry[]) {
    for (const e of entries) {
      this.entries.push(e);
      for (const s of this.sinks) s(e);
    }
    if (this.entries.length > CAPACITY) this.entries.splice(0, this.entries.length - CAPACITY);
  }

  all(): LogEntry[] {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
    for (const s of this.sinks) s({ t: Date.now(), level: 'info', scope: 'log', msg: 'Logbook cleared', src: this.src });
  }

  subscribe(s: Sink): () => void {
    this.sinks.add(s);
    return () => this.sinks.delete(s);
  }

  scope(name: string): Logger {
    return new Logger(this, name);
  }
}

export class Logger {
  constructor(
    private book: LogBook,
    readonly name: string,
  ) {}

  private emit(level: LogLevel, msg: string, data?: Record<string, unknown>, ms?: number) {
    this.book.write({ t: Date.now(), level, scope: this.name, msg, data, ms, src: this.book.src });
  }

  debug(msg: string, data?: Record<string, unknown>) {
    this.emit('debug', msg, data);
  }
  info(msg: string, data?: Record<string, unknown>) {
    this.emit('info', msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>) {
    this.emit('warn', msg, data);
  }
  error(msg: string, data?: Record<string, unknown>) {
    this.emit('error', msg, data);
  }

  /** Starts a timer; call the returned function to log the elapsed time (rounded to 0.1 ms). */
  time(msg: string, level: LogLevel = 'debug'): (data?: Record<string, unknown>) => number {
    const start = now();
    return (data) => {
      const ms = Math.round((now() - start) * 10) / 10;
      this.emit(level, msg, data, ms);
      return ms;
    };
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** The process-wide logbook (one per page, per worker, per CLI run). */
export const logbook = new LogBook();
export const log = (scope: string) => logbook.scope(scope);

/** Describes an error for a log entry without its stack's file paths. */
export function errorData(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { message: String(e) };
}

/** One line per entry, for the Logbook download and the CLI. */
export function formatEntry(e: LogEntry): string {
  const time = new Date(e.t).toISOString().replace('T', ' ').replace('Z', '');
  const data = e.data && Object.keys(e.data).length ? ` ${JSON.stringify(e.data)}` : '';
  const ms = e.ms !== undefined ? ` (${e.ms} ms)` : '';
  return `${time} ${e.level.toUpperCase().padEnd(5)} ${(e.src ?? '').padEnd(6)} ${e.scope}: ${e.msg}${ms}${data}`;
}
