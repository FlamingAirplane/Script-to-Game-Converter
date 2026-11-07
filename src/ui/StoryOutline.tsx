import type { ReactNode } from 'react';
import { plainText } from '../core/emphasis';
import { describeCondition } from '../core/gating';
import { isActive, type Passage, type StoryProject } from '../core/isr';
import { sceneHeadingOf } from '../core/scenes';

// The Graph chapter's Outline: the story as an indented list that reads like a branching script. Each passage is
// written out once, where a reader first reaches it (going down the choices in order); a route to a passage already
// written out says "joins" and links to it. Passages that go straight on continue at the same level; choices indent.

const anchor = (id: string) => `outline-${id}`;
const EXIT = '\u0000exit';

/**
 * Where each choice's branches meet again: the first passage every way on from it passes through (its immediate
 * post-dominator), or nothing when they don't meet before the story ends. The outline writes the branches, then
 * carries on from there at the same level, so a shared continuation isn't buried inside the first branch.
 */
export function meetingPoints(project: StoryProject): Map<string, string> {
  const ids = project.passages.map((p) => p.id);
  const known = new Set(ids);
  const succ = new Map<string, string[]>();
  for (const p of project.passages) {
    const next = new Set<string>();
    for (const c of p.choices) if (isActive(c.review)) next.add(c.target && known.has(c.target) ? c.target : EXIT);
    if (p.divert) next.add(known.has(p.divert) ? p.divert : EXIT);
    if (!next.size || p.isEnding) next.add(EXIT);
    succ.set(p.id, [...next]);
  }
  // Post-dominators by repeated narrowing: each passage's set is itself plus what all its next passages share.
  const all = new Set([...ids, EXIT]);
  const pdom = new Map<string, Set<string>>(ids.map((id) => [id, new Set(all)]));
  pdom.set(EXIT, new Set([EXIT]));
  for (let changed = true, round = 0; changed && round < 200; round++) {
    changed = false;
    for (const id of [...ids].reverse()) {
      const nexts = succ.get(id)!.map((n) => pdom.get(n)!);
      const meet = new Set([...nexts[0]].filter((x) => nexts.every((sx) => sx.has(x))));
      meet.add(id);
      if (meet.size !== pdom.get(id)!.size) {
        pdom.set(id, meet);
        changed = true;
      }
    }
  }
  const out = new Map<string, string>();
  for (const id of ids) {
    if (succ.get(id)!.length < 2) continue;
    const strict = [...pdom.get(id)!].filter((x) => x !== id);
    // The nearest: the one whose own post-dominators are all the others.
    const near = strict.find((d) => pdom.get(d)!.size === strict.length);
    if (near && near !== EXIT) out.set(id, near);
  }
  return out;
}

function firstLine(p: Passage, heading?: string): string {
  const b = p.content.find((x) => (x.type === 'action' || x.type === 'dialogue') && plainText(x.text).split('\n')[0].trim() !== heading && plainText(x.text).replace(/\\/g, '').trim());
  if (!b || !('text' in b)) return '';
  const t = plainText(b.text).replace(/^\\\s*/, '').split('\n')[0].trim();
  return t.length > 110 ? `${t.slice(0, 109)}…` : t;
}

export function StoryOutline({ project, onOpen, selected }: { project: StoryProject; onOpen: (id: string) => void; selected?: string }) {
  const byId = new Map(project.passages.map((p) => [p.id, p]));
  const written = new Set<string>();
  const title = (id: string) => byId.get(id)?.title ?? id;
  const meets = meetingPoints(project);
  const jump = (id: string) => document.getElementById(anchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const joins = (id: string, key: string) =>
    id === 'END' ? (
      <span key={key} className="outline-end">
        ■ the end
      </span>
    ) : !byId.has(id) ? (
      <span key={key} className="outline-missing">
        ⚠ leads to “{id}”, which doesn’t exist
      </span>
    ) : (
      <span key={key} className="outline-join">
        ↪ joins{' '}
        <button className="link" onClick={() => jump(id)}>
          {title(id)}
        </button>
      </span>
    );

  /**
   * A passage and everything that follows it straight on, then its choices (each indented), stopping before `stop`
   * (where an enclosing choice's branches meet again, which the enclosing level writes).
   */
  const run = (startId: string, stop?: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let id: string | undefined = startId;
    while (id) {
      if (id === stop) break;
      const p = byId.get(id);
      if (!p) break;
      written.add(p.id);
      const heading = sceneHeadingOf(p);
      const line = firstLine(p, heading);
      out.push(
        <div key={p.id} id={anchor(p.id)} className={`outline-passage${selected === p.id ? ' selected' : ''}`}>
          {heading && <p className="outline-heading mono small">{heading}</p>}
          <button className="outline-title" onClick={() => onOpen(p.id)} title="Open in Review">
            {p.title}
          </button>
          {line && <span className="outline-first muted small"> — {line}</span>}
        </div>,
      );
      const choices = p.choices.filter((c) => isActive(c.review));
      // Where these branches meet again (if that's still to be written and isn't where the enclosing level stops).
      const meet: string | undefined = meets.get(p.id);
      const rejoin: string | undefined = meet && meet !== stop && !written.has(meet) ? meet : undefined;
      const inner = rejoin ?? stop;
      if (choices.length) {
        out.push(
          <ul key={`${p.id}-choices`} className="outline-choices">
            {choices.map((c) => {
              const needs = c.conditions.map((x) => describeCondition(x, project));
              const go = c.target || 'END';
              const straightOn = go === inner;
              const opens = !straightOn && go !== 'END' && byId.has(go) && !written.has(go);
              const branch = straightOn
                ? [
                    <span key="s" className="outline-join">
                      ↓ goes on below
                    </span>,
                  ]
                : opens
                  ? run(go, inner)
                  : [joins(go, 'j')];
              return (
                <li key={c.id}>
                  <details open>
                    <summary>
                      <span className="outline-choice">{plainText(c.text)}</span>
                      {needs.length > 0 && <span className="muted small"> (needs {needs.join(', ')})</span>}
                      {c.forced && needs.length > 0 && <span className="outline-forced small"> · forced: the only choice once it’s open</span>}
                      {!opens && <> {branch}</>}
                    </summary>
                    {opens && <div className="outline-branch">{branch}</div>}
                  </details>
                </li>
              );
            })}
          </ul>,
        );
        if (p.divert && p.divert !== inner) out.push(<p key={`${p.id}-otherwise`} className="outline-otherwise small">otherwise {joins(p.divert, 'o')}</p>);
        if (rejoin) {
          // The branches meet again here: carry on at this level.
          id = rejoin;
          continue;
        }
        break;
      }
      if (p.divert && p.divert === stop) break;
      if (p.divert && p.divert !== 'END' && byId.has(p.divert) && !written.has(p.divert)) {
        id = p.divert;
        continue;
      }
      out.push(<p key={`${p.id}-next`} className="outline-next small">{p.divert ? joins(p.divert, 'n') : p.isEnding ? joins('END', 'e') : <span className="outline-missing">⚠ the reader gets stuck here</span>}</p>);
      break;
    }
    return out;
  };

  const start = byId.has(project.project.startPassage) ? project.project.startPassage : project.passages[0]?.id;
  const main = start ? run(start) : [];
  const rest = project.passages.filter((p) => !written.has(p.id));
  const unreached: ReactNode[] = [];
  for (const p of rest) if (!written.has(p.id)) unreached.push(...run(p.id));

  return (
    <div className="story-outline" aria-label="Story outline">
      <p className="muted small">
        The story as a list: each passage once, where a reader first reaches it. Choices are indented (click one to fold it away), “joins” links to a passage
        already listed, and a title opens it in Review.
      </p>
      <div className="outline-main">{main}</div>
      {unreached.length > 0 && (
        <section className="outline-unreached">
          <h3>Not reached from the start</h3>
          {unreached}
        </section>
      )}
    </div>
  );
}
