import { useState } from 'react';
import { sortDiagnostics, type Diagnostic, type Severity } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { SeverityIcon } from './common';
import { friendly, SEVERITY_LABEL } from './friendly';
import { Logbook } from './Logbook';

const SEVERITIES: Severity[] = ['error', 'review', 'warning', 'info'];

export type PanelView = 'notes' | 'log';

export function DiagnosticsPanel({
  diagnostics,
  project,
  onJump,
  onClose,
  view,
  onView,
}: {
  diagnostics: Diagnostic[];
  project: StoryProject | null;
  onJump: (d: Diagnostic) => void;
  onClose: () => void;
  view: PanelView;
  onView: (v: PanelView) => void;
}) {
  const [hidden, setHidden] = useState<Set<Severity>>(new Set(['info']));
  const [technical, setTechnical] = useState(false);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, diagnostics.filter((d) => d.severity === s).length])) as Record<Severity, number>;
  const shown = sortDiagnostics(diagnostics).filter((d) => !hidden.has(d.severity));

  return (
    <aside className="diagnostics">
      <div className="pane-head">
        <span className="pane-tabs" role="tablist" aria-label="Side panel">
          <button role="tab" aria-selected={view === 'notes'} className={`pane-tab ${view === 'notes' ? 'active' : ''}`} onClick={() => onView('notes')}>
            Diagnostics
          </button>
          <button role="tab" aria-selected={view === 'log'} className={`pane-tab ${view === 'log' ? 'active' : ''}`} onClick={() => onView('log')}>
            Logbook
          </button>
        </span>
        <span className="spacer" />
        {view === 'notes' && (
          <label className="check small muted" title="Show error codes and pipeline stages">
            <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} /> details
          </label>
        )}
        <button className="icon" onClick={onClose} title="Close" aria-label="Close side panel">
          ×
        </button>
      </div>
      {view === 'log' ? (
        <Logbook />
      ) : (
        <>
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
            <SeverityIcon severity={s} /> {counts[s]} {SEVERITY_LABEL[s]}
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="muted small pad">
          {counts.error + counts.review + counts.warning === 0
            ? `Nothing to fix — the proofs are clean and the story is ready to export.${counts.info ? ` ${counts.info === 1 ? '1 note is' : `${counts.info} notes are`} hidden; click “note” above to read ${counts.info === 1 ? 'it' : 'them'}.` : ''}`
            : 'Everything here is hidden by the filters above. Click a filter to show it again.'}
        </p>
      )}
      <ul className="diag-list">
        {shown.map((d, i) => {
          const f = friendly(d, project ?? undefined);
          return (
            <li key={i}>
              <button className="diag" onClick={() => onJump(d)}>
                <span className="diag-head">
                  <SeverityIcon severity={d.severity} />
                  <span className={`sev-word sev-${d.severity}`}>{SEVERITY_LABEL[d.severity]}</span>
                  {f.where && <span className="muted small diag-where">in {f.where}</span>}
                  {d.exportBlocked && <span className="blocker small">blocks export</span>}
                </span>
                <span className="diag-msg">{f.title}</span>
                {f.detail && <span className="muted small">{f.detail}</span>}
                {d.remediation && <span className="small diag-fix">→ {d.remediation}</span>}
                {technical && (
                  <span className="mono muted small">
                    {d.code} · {d.stage.replace(/_/g, ' ')}
                    {d.entityId ? ` · ${d.entityId}` : ''}
                    {d.source ? ` · line ${d.source.line}` : ''}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
        </>
      )}
    </aside>
  );
}
