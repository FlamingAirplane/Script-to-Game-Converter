import { useState } from 'react';
import { sortDiagnostics, type Diagnostic, type Severity } from '../core/diagnostics';
import { SeverityIcon } from './common';

const SEVERITIES: Severity[] = ['error', 'review', 'warning', 'info'];

export function DiagnosticsPanel({ diagnostics, onJump, onClose }: { diagnostics: Diagnostic[]; onJump: (d: Diagnostic) => void; onClose: () => void }) {
  const [hidden, setHidden] = useState<Set<Severity>>(new Set(['info']));
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, diagnostics.filter((d) => d.severity === s).length])) as Record<Severity, number>;
  const shown = sortDiagnostics(diagnostics).filter((d) => !hidden.has(d.severity));

  return (
    <aside className="diagnostics">
      <div className="pane-head">
        <strong>Diagnostics</strong>
        <span className="spacer" />
        <button className="icon" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="sev-filters">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            className={`sev-filter ${hidden.has(s) ? 'off' : ''}`}
            onClick={() => {
              const n = new Set(hidden);
              if (n.has(s)) n.delete(s);
              else n.add(s);
              setHidden(n);
            }}
          >
            <SeverityIcon severity={s} /> {counts[s]} {s}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="muted small pad">{diagnostics.length ? 'All diagnostics are filtered out.' : 'No issues. The story is ready to export.'}</p>}
      <ul className="diag-list">
        {shown.map((d, i) => (
          <li key={i}>
            <button className="diag" onClick={() => onJump(d)}>
              <span className="diag-head">
                <SeverityIcon severity={d.severity} />
                <span className="mono small">{d.code}</span>
                <span className="muted small">{d.stage.replace(/_/g, ' ')}</span>
                {d.exportBlocked && <span className="blocker small">blocks export</span>}
              </span>
              <span className="diag-msg">{d.message}</span>
              {d.remediation && <span className="muted small">→ {d.remediation}</span>}
              {(d.entityId || d.source) && (
                <span className="mono muted small">
                  {d.entityId}
                  {d.source ? ` · line ${d.source.line}` : ''}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
