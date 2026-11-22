import type { ProcessedStory } from '../../core/pipeline';
import { Badge } from '../common';

/** The automated playthroughs: how many reached an ending, which endings, which conditional choices were ever available. */
export function SmokeReport({ processed, onOpen }: { processed: ProcessedStory; onOpen: (id: string) => void }) {
  const smoke = processed.smoke;
  return (
    <>
      {processed.smokePending && (
        <section>
          <h3>Automated playthroughs</h3>
          <p className="muted small">Running…</p>
        </section>
      )}
      {smoke && (
        <section>
          <h3>Automated playthroughs</h3>
          <p className="small">
            <strong>{smoke.completedRuns}</strong>/{smoke.runs} reached an ending · {smoke.visited.length}/{processed.project.passages.length} passages visited
            {smoke.stopReason === 'deterministic' && <span className="muted"> · the story has no choices, so one playthrough covers it</span>}
            {smoke.stopReason === 'no-new-coverage' && <span className="muted"> · stopped once more runs found nothing new</span>}
          </p>
          <ul className="endings">
            {Object.entries(smoke.endingsReached).map(([id, n]) => (
              <li key={id}>
                <button className="link mono small" onClick={() => onOpen(id)}>
                  {id}
                </button>
                <span className="bar" style={{ width: `${(n / smoke.runs) * 100}%` }} />
                <span className="muted small">{n}</span>
              </li>
            ))}
          </ul>
          {smoke.gatedChoices.length > 0 && (
            <>
              <h4 className="small">Conditional choices</h4>
              <ul className="gates">
                {smoke.gatedChoices.map((g) => (
                  <li key={g.id} className="small">
                    {g.seenEnabled > 0 ? <Badge tone="ok">seen {g.seenEnabled}×</Badge> : <Badge tone="warning">never available</Badge>} {g.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {smoke.unvisited.length > 0 && <p className="muted small">Never reached: {smoke.unvisited.join(', ')}</p>}
        </section>
      )}
    </>
  );
}
