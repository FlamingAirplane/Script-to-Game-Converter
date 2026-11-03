import { useEffect, useMemo, useState } from 'react';
import { formatEntry, LEVELS, logbook, type LogEntry, type LogLevel } from '../core/log';
import { download } from './common';

// The Logbook: a live view of what the app has been doing (parsing, processing, playthroughs,
// exports, errors), for troubleshooting and bug reports. It never contains story text.

const LEVEL_NAMES: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function useLogEntries(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(() => logbook.all());
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      // Batch bursts (e.g. a pipeline run) into one render per frame.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setEntries(logbook.all()));
    };
    const off = logbook.subscribe(refresh);
    refresh();
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, []);
  return entries;
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function Logbook() {
  const entries = useLogEntries();
  const [minLevel, setMinLevel] = useState<LogLevel>('info');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => LEVELS[e.level] >= LEVELS[minLevel])
      .filter((e) => !q || `${e.scope} ${e.msg} ${JSON.stringify(e.data ?? '')}`.toLowerCase().includes(q))
      .reverse();
  }, [entries, minLevel, query]);
  const text = () => entries.map(formatEntry).join('\n') + '\n';
  const counts = { warn: entries.filter((e) => e.level === 'warn').length, error: entries.filter((e) => e.level === 'error').length };

  return (
    <div className="logbook">
      <div className="logbook-tools">
        <select className="input tiny-select" value={minLevel} onChange={(e) => setMinLevel(e.target.value as LogLevel)} aria-label="Show log entries from this level up">
          {LEVEL_NAMES.map((l) => (
            <option key={l} value={l}>
              {l === 'debug' ? 'everything' : `${l} and above`}
            </option>
          ))}
        </select>
        <input className="input small" placeholder="Search the log…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the log" />
      </div>
      <div className="logbook-tools">
        <span className="muted small">
          {entries.length} entries{counts.error ? ` · ${counts.error} errors` : ''}
          {counts.warn ? ` · ${counts.warn} warnings` : ''}
        </span>
        <span className="spacer" />
        <button
          className="btn tiny"
          onClick={() => {
            void navigator.clipboard?.writeText(text());
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <button className="btn tiny" onClick={() => download(`narrative-bridge-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`, text())}>
          download
        </button>
        <button className="btn tiny" onClick={() => logbook.clear()}>
          clear
        </button>
      </div>
      <p className="muted small logbook-note">Newest first. The log stays on this computer and never contains story text — safe to attach to a bug report.</p>
      <ol className="log-list" aria-label="Log entries, newest first">
        {shown.map((e, i) => (
          <li key={`${e.t}-${i}`} className={`log-entry log-${e.level}`}>
            <span className="log-time mono">{clock(e.t)}</span>
            <span className={`log-level sev-${e.level === 'warn' ? 'warning' : e.level === 'debug' ? 'info' : e.level}`}>{e.level}</span>
            <span className="log-scope">
              {e.scope}
              {e.src === 'worker' ? ' · worker' : ''}
            </span>
            <span className="log-msg">
              {e.msg}
              {e.ms !== undefined && <span className="log-ms"> {e.ms} ms</span>}
            </span>
            {e.data && Object.keys(e.data).length > 0 && (
              <span className="log-data mono">
                {Object.entries(e.data)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                  .join('  ')}
              </span>
            )}
          </li>
        ))}
        {!shown.length && <li className="muted small">Nothing logged at this level yet.</li>}
      </ol>
    </div>
  );
}
