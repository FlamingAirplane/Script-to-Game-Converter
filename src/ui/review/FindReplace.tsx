import { useMemo, useState } from 'react';
import { type StoryProject } from '../../core/isr';
import { type Update, findText, replaceText } from '../projectOps';

export function FindReplace({ project, update, onSelect }: { project: StoryProject; update: Update; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [done, setDone] = useState('');
  const hits = useMemo(() => findText(project, query, matchCase), [project, query, matchCase]);
  const titles = new Map(project.passages.map((p) => [p.id, p.title]));
  return (
    <details className="find-panel" onToggle={() => setDone('')}>
      <summary>Find &amp; replace</summary>
      <input className="input small" placeholder="Find…" value={query} onChange={(e) => (setQuery(e.target.value), setDone(''))} aria-label="Find text" />
      <input className="input small" placeholder="Replace with…" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replace with" />
      <div className="row">
        <label className="check small">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> match case
        </label>
        <span className="spacer" />
        <button
          className="btn tiny"
          disabled={!hits.length}
          onClick={() => {
            const n = hits.length;
            update((d) => replaceText(d, query, replacement, matchCase));
            setDone(`Replaced ${n} ${n === 1 ? 'match' : 'matches'}. Undo with ↶ if needed.`);
          }}
        >
          Replace all
        </button>
      </div>
      {query && <p className="muted small">{done || `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}</p>}
      {hits.length > 0 && (
        <ul className="find-hits">
          {hits.slice(0, 40).map((h, i) => (
            <li key={i}>
              <button className="link small" onClick={() => onSelect(h.passageId)}>
                <span className="find-where">{titles.get(h.passageId)}</span> {h.excerpt}
              </button>
            </li>
          ))}
          {hits.length > 40 && <li className="muted small">…and {hits.length - 40} more</li>}
        </ul>
      )}
    </details>
  );
}
