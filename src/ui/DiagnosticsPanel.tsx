import { useState } from 'react';
import { sortDiagnostics, type Diagnostic, type Severity } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { SeverityIcon } from './common';
import { friendly, SEVERITY_LABEL } from './friendly';
import { Logbook } from './Logbook';
import { sceneFix, type SceneRequest } from './NewScene';

const SEVERITIES: Severity[] = ['error', 'review', 'warning', 'info'];

export type PanelView = 'notes' | 'log';

export function DiagnosticsPanel({
  diagnostics,
  project,
  onJump,
  onClose,
  view,
  onView,
  onApproveAll,
  onNewScene,
}: {
  diagnostics: Diagnostic[];
  project: StoryProject | null;
  onJump: (d: Diagnostic) => void;
  onClose: () => void;
  view: PanelView;
  onView: (v: PanelView) => void;
  /** Approves every waiting suggestion (undoable). */
  onApproveAll?: () => void;
  /** Opens the New scene form (for a missing destination, or a scene after a dead end). */
  onNewScene?: (r: SceneRequest) => void;
}) {
  const [hidden, setHidden] = useState<Set<Severity>>(new Set(['info']));
  const [technical, setTechnical] = useState(false);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, diagnostics.filter((d) => d.severity === s).length])) as Record<Severity, number>;
  const shown = sortDiagnostics(diagnostics).filter((d) => !hidden.has(d.severity));
  // Suggestions waiting for approval are listed once as a group, not one identical note each.
  const suggestions = shown.filter((d) => d.code === 'UNAPPROVED_GENERATED');
  const grouped = suggestions.length > 1;
  const firstSuggestion = grouped ? shown.indexOf(suggestions[0]) : -1;
  const rows = grouped ? shown.filter((d, i) => d.code !== 'UNAPPROVED_GENERATED' || i === firstSuggestion) : shown;

  const item = (d: Diagnostic, i: number | string) => {
    const f = friendly(d, project ?? undefined);
    const fix = project && onNewScene ? sceneFix(d.code, d.details, d.entityId, project) : null;
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
          {d.remediation && (
            <span className="small diag-fix">
              {d.remediation} <span className="diag-go">Go there →</span>
            </span>
          )}
          {technical && (
            <span className="mono muted small">
              {d.code} · {d.stage.replace(/_/g, ' ')}
              {d.entityId ? ` · ${d.entityId}` : ''}
              {d.source ? ` · line ${d.source.line}` : ''}
            </span>
          )}
        </button>
        {fix && (
          <button className="btn tiny diag-action" onClick={() => onNewScene!(fix.request)}>
            + {fix.label}
          </button>
        )}
      </li>
    );
  };

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
        {rows.map((d, i) =>
          grouped && d.code === 'UNAPPROVED_GENERATED' ? (
            <li key="suggestions" className="diag-group">
              <div className="diag-group-head">
                <span className="diag-head">
                  <SeverityIcon severity="review" />
                  <span className="sev-word sev-review">{SEVERITY_LABEL.review}</span>
                </span>
                <span className="diag-msg">{suggestions.length} suggestions are waiting for your OK.</span>
                <span className="small muted">Until you approve them they’re left out of Playtest and the export.</span>
                <span className="row">
                  {onApproveAll && (
                    <button className="btn tiny ok" onClick={onApproveAll} title="Approves every suggestion (you can undo this)">
                      Approve all
                    </button>
                  )}
                  <button className="btn tiny" onClick={() => onJump(suggestions[0])}>
                    Review the first
                  </button>
                </span>
              </div>
              <details>
                <summary className="small">Show each one</summary>
                <ul className="diag-list">{suggestions.map((x, j) => item(x, `s${j}`))}</ul>
              </details>
            </li>
          ) : (
            item(d, i)
          ),
        )}
      </ul>
        </>
      )}
    </aside>
  );
}
