import { Story } from 'inkjs/full';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fnv1a } from '../core/hash';
import { itemVar } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { Badge, Empty } from './common';

interface Line {
  text: string;
  speaker?: string;
  tags: string[];
  kind: 'text' | 'choice' | 'system';
}

interface Snapshot {
  state: string;
  lines: Line[];
}

export function PlaytestView({ processed, onOpen }: { processed: ProcessedStory; onOpen: (id: string) => void }) {
  const json = processed.compile.json;
  const version = fnv1a(processed.generated.ink);
  const story = useRef<Story | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [choices, setChoices] = useState<{ text: string; index: number }[]>([]);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [slot, setSlot] = useState<{ version: string; state: string; lines: Line[] } | null>(null);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [where, setWhere] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const varNames = [...processed.project.items.map((i) => itemVar(i.id)), ...processed.project.variables.map((v) => v.id)].filter((n) =>
    new RegExp(`^VAR ${n} `, 'm').test(processed.generated.ink),
  );

  const readVars = useCallback(() => {
    const s = story.current;
    if (!s) return;
    const out: Record<string, unknown> = {};
    for (const n of varNames) out[n] = s.variablesState.$(n);
    setVars(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varNames.join()]);

  const advance = useCallback(
    (prefix: Line[]) => {
      const s = story.current!;
      const out = [...prefix];
      while (s.canContinue) {
        const raw = (s.Continue() ?? '').trim();
        if (!raw) continue;
        const tags = s.currentTags ?? [];
        const speakerTag = tags.find((t) => t.startsWith('speaker:'));
        if (speakerTag) {
          const i = raw.indexOf(': ');
          out.push({ speaker: i > 0 ? raw.slice(0, i) : speakerTag.slice(8), text: i > 0 ? raw.slice(i + 2) : raw, tags, kind: 'text' });
        } else out.push({ text: raw, tags, kind: 'text' });
      }
      setLines(out);
      setChoices(s.currentChoices.map((c) => ({ text: c.text, index: c.index })));
      setWhere((s.currentChoices[0]?.sourcePath ?? '').split('.')[0]);
      readVars();
    },
    [readVars],
  );

  const restart = useCallback(() => {
    if (!json) return;
    const s = new Story(json);
    const errs: string[] = [];
    s.onError = (m: string) => {
      errs.push(m);
      setErrors([...errs]);
    };
    story.current = s;
    setErrors([]);
    setHistory([]);
    setNotice('');
    advance([]);
  }, [json, advance]);

  useEffect(() => {
    restart();
  }, [restart]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length]);

  if (!json)
    return (
      <div className="view">
        <Empty title="Nothing to play yet">
          <p className="muted">The story does not compile. Fix the errors in the Diagnostics panel first.</p>
        </Empty>
      </div>
    );

  const choose = (i: number, text: string) => {
    const s = story.current!;
    setHistory((h) => [...h, { state: s.state.toJson(), lines }]);
    s.ChooseChoiceIndex(i);
    advance([...lines, { text, tags: [], kind: 'choice' }]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last || !story.current) return;
    story.current.state.LoadJson(last.state);
    setHistory(history.slice(0, -1));
    setLines(last.lines);
    setChoices(story.current.currentChoices.map((c) => ({ text: c.text, index: c.index })));
    readVars();
  };

  const setVar = (name: string, value: unknown) => {
    const s = story.current!;
    s.variablesState.$(name, value as boolean | number | string);
    // Re-evaluate choice conditions from the current point, like a host inventory change would.
    setNotice(`Set ${name} = ${String(value)}. Conditions are re-checked at the next choice point.`);
    readVars();
  };

  const ended = choices.length === 0;
  const smoke = processed.smoke;

  return (
    <div className="view playtest-view">
      <main className="stage">
        <div className="stage-head">
          <h2>{processed.project.project.title}</h2>
          <div className="row">
            <button className="btn tiny" onClick={undo} disabled={!history.length}>
              ↶ Undo choice
            </button>
            <button className="btn tiny" onClick={restart}>
              Restart
            </button>
          </div>
        </div>
        <div className="transcript">
          {lines.map((l, i) =>
            l.kind === 'choice' ? (
              <p key={i} className="t-choice">
                › {l.text}
              </p>
            ) : l.speaker ? (
              <p key={i} className="t-dialogue">
                <span className="t-speaker">{l.speaker}</span>
                {l.tags.find((t) => t.startsWith('paren:')) && <span className="t-paren">({l.tags.find((t) => t.startsWith('paren:'))!.slice(6)})</span>}
                <span className="t-text">{l.text}</span>
              </p>
            ) : (
              <p key={i} className={l.tags.includes('transition') ? 't-transition' : 't-action'}>
                {l.tags.find((t) => t.startsWith('scene:')) && <span className="t-scene">{l.tags.find((t) => t.startsWith('scene:'))!.slice(6)}</span>}
                {l.text}
              </p>
            ),
          )}
          {ended && <p className="t-end">— The End —</p>}
          <div ref={bottom} />
        </div>
        <div className="choices">
          {choices.map((c) => (
            <button key={c.index} className="choice-btn" onClick={() => choose(c.index, c.text)}>
              {c.text}
            </button>
          ))}
          {ended && (
            <button className="choice-btn" onClick={restart}>
              Play again
            </button>
          )}
        </div>
        {errors.length > 0 && (
          <div className="error-box">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
      </main>

      <aside className="inspector">
        <section>
          <h3>Position</h3>
          {where ? (
            <button className="link mono" onClick={() => onOpen(where)}>
              {where}
            </button>
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
            <button
              className="btn tiny"
              onClick={() => {
                setSlot({ version, state: story.current!.state.toJson(), lines });
                setNotice(`Saved at story version ${version}.`);
              }}
            >
              Save
            </button>
            <button
              className="btn tiny"
              disabled={!slot}
              onClick={() => {
                if (!slot) return;
                if (slot.version !== version) {
                  setNotice(`Save rejected: it was made with story version ${slot.version}, the story is now ${version}. Restart instead of loading invalid state.`);
                  return;
                }
                story.current!.state.LoadJson(slot.state);
                setLines(slot.lines);
                setChoices(story.current!.currentChoices.map((c) => ({ text: c.text, index: c.index })));
                readVars();
                setNotice('Loaded.');
              }}
            >
              Load
            </button>
          </div>
          <p className="muted small">Edit the story and try loading: saves from another story version are refused.</p>
        </section>
        {smoke && (
          <section>
            <h3>Automated playthroughs</h3>
            <p className="small">
              <strong>{smoke.completedRuns}</strong>/{smoke.runs} reached an ending · {smoke.visited.length}/{processed.project.passages.length} passages visited
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
      </aside>
    </div>
  );
}
