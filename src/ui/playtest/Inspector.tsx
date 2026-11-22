import type { ProcessedStory } from '../../core/pipeline';
import type { SceneRequest } from '../NewScene';
import { SmokeReport } from './SmokeReport';

/** The side panel: where the story is, the variables to toggle, the save slot and the automated playthroughs. */
export function Inspector({
  processed,
  where,
  ended,
  onOpen,
  onNewScene,
  varNames,
  vars,
  setVar,
  notice,
  hasSlot,
  onSave,
  onLoad,
}: {
  processed: ProcessedStory;
  where: string;
  ended: boolean;
  onOpen: (id: string) => void;
  onNewScene?: (r: SceneRequest) => void;
  varNames: string[];
  vars: Record<string, unknown>;
  setVar: (name: string, value: boolean | number | string) => void;
  notice: string;
  hasSlot: boolean;
  onSave: () => void;
  onLoad: () => void;
}) {
  return (
    <aside className="inspector">
      <section>
        <h3>Position</h3>
        {where ? (
          <>
            <button className="link mono" onClick={() => onOpen(where)}>
              {where}
            </button>
            {onNewScene && processed.project.passages.some((p) => p.id === where) && (
              <button className="btn tiny" onClick={() => onNewScene({ from: where })} title="Add a scene after this passage, or as a new choice in it">
                + New scene after it
              </button>
            )}
          </>
        ) : (
          <span className="muted small">{ended ? 'ended' : '—'}</span>
        )}
      </section>
      <section>
        <h3>State</h3>
        <p className="muted small">Toggle items to simulate the host game's inventory.</p>
        {varNames.length === 0 && <p className="muted small">This story declares no variables.</p>}
        <ul className="vars">
          {varNames.map((n) => (
            <li key={n}>
              <span className="mono small">{n}</span>
              {typeof vars[n] === 'boolean' ? (
                <input type="checkbox" checked={vars[n] as boolean} onChange={(e) => setVar(n, e.target.checked)} />
              ) : typeof vars[n] === 'number' ? (
                <input className="input tiny-num" type="number" value={vars[n] as number} onChange={(e) => setVar(n, parseInt(e.target.value || '0', 10))} />
              ) : (
                <span className="mono small">{JSON.stringify(vars[n])}</span>
              )}
            </li>
          ))}
        </ul>
        {notice && <p className="muted small">{notice}</p>}
      </section>
      <section>
        <h3>Save slot</h3>
        <div className="row">
          <button className="btn tiny" onClick={onSave}>
            Save
          </button>
          <button className="btn tiny" disabled={!hasSlot} onClick={onLoad}>
            Load
          </button>
        </div>
        <p className="muted small">Edit the story and try loading: a save from another version replays its choices in the new version, as readers' saves do.</p>
      </section>
      <SmokeReport processed={processed} onOpen={onOpen} />
    </aside>
  );
}
