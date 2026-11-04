// Engine-only runtime: the compiler isn't needed to play an already compiled story.
import { Story } from 'inkjs';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { fnv1a } from '../core/hash';
import { CONTINUE_TEXT, itemVar } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { audioFileName, referencedAudio } from '../core/audio';
import { Badge, Empty } from './common';
import { sfx } from './sfx';
import { plainKey } from './Shortcuts';
import { VoiceQueue, type VoiceItem } from './voice';

const VOICES_KEY = 'narrative-bridge.voices';

interface Line {
  text: string;
  speaker?: string;
  tags: string[];
  kind: 'text' | 'choice' | 'system';
  /** A Continue break was taken here (a choice line that isn't shown). */
  pause?: boolean;
}

/** A Continue break: the story offers only "Continue" (see inkgen.ts). */
const isPause = (s: Story) => s.currentChoices.length === 1 && s.currentChoices[0].text === CONTINUE_TEXT;

/** Story state at the start of the current stretch of text, so a state change can replay it. */
interface Segment {
  state: string;
  prefix: Line[];
  overrides: Record<string, boolean | number | string>;
}

interface Snapshot {
  state: string;
  lines: Line[];
  segment: Segment | null;
}

/** Reads on until the next choice (or the end), appending the new lines to `prefix`. */
function readOn(s: Story, prefix: Line[]): Line[] {
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
  return out;
}

/**
 * Brings a save from another version of the story forward: plays the new version from the start
 * making the same choices (by their text), so its text and variables apply. Stops at the first
 * choice the new version no longer offers. The playable story export does the same for readers.
 */
function replayChoices(s: Story, chosen: string[]): { lines: Line[]; history: Snapshot[]; segment: Segment; followed: number } {
  let segment: Segment = { state: s.state.toJson(), prefix: [], overrides: {} };
  let lines = readOn(s, []);
  const history: Snapshot[] = [];
  let followed = 0;
  const take = (c: { index: number; text: string }) => {
    history.push({ state: s.state.toJson(), lines, segment });
    const pause = isPause(s);
    s.ChooseChoiceIndex(c.index);
    const prefix: Line[] = [...lines, { text: c.text, tags: [], kind: 'choice', pause }];
    segment = { state: s.state.toJson(), prefix, overrides: {} };
    lines = readOn(s, prefix);
  };
  // Continue breaks added or removed since the save don't stop it: take or skip them.
  for (let i = 0, steps = 0; i < chosen.length && steps < 10000; steps++) {
    const c = s.currentChoices.find((x) => x.text === chosen[i]);
    if (c) {
      take(c);
      i++;
      followed++;
    } else if (isPause(s)) take(s.currentChoices[0]);
    else if (chosen[i] === CONTINUE_TEXT) {
      i++;
      followed++;
    } else break;
  }
  return { lines, history, segment, followed };
}

export function PlaytestView({
  processed,
  onOpen,
  dialogueOnly,
  onDialogueOnly,
}: {
  processed: ProcessedStory;
  onOpen: (id: string) => void;
  dialogueOnly: boolean;
  onDialogueOnly: (on: boolean) => void;
}) {
  const json = processed.compile.json;
  const version = fnv1a(processed.generated.ink);
  const story = useRef<Story | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [choices, setChoices] = useState<{ text: string; index: number }[]>([]);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [history, setHistory] = useState<Snapshot[]>([]);
  // The save slot is kept per story, so it survives going to Review to edit and coming back.
  const slotKey = `narrative-bridge.playtest-save.${processed.project.project.id}`;
  const [slot, setSlotState] = useState<{ version: string; state: string; lines: Line[] } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(slotKey) ?? 'null');
    } catch {
      return null;
    }
  });
  const setSlot = (v: { version: string; state: string; lines: Line[] }) => {
    setSlotState(v);
    try {
      localStorage.setItem(slotKey, JSON.stringify(v));
    } catch {
      /* kept for this visit only */
    }
  };
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [where, setWhere] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const voiceQueue = useRef(new VoiceQueue());
  const [voicesOn, setVoicesOn] = useState(() => {
    try {
      return localStorage.getItem(VOICES_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const voicesRef = useRef(voicesOn);
  voicesRef.current = voicesOn;
  // Clips by the file name used in #audio tags, and voices by speaker id.
  const clipsByFile = new Map(referencedAudio(processed.project).map((r) => [audioFileName(r), r]));
  const voicesBySpeaker = new Map(processed.project.characters.map((c) => [c.id, c.voice]));
  const speakRef = useRef<(l: Line[]) => void>(() => {});
  speakRef.current = (newLines: Line[]) => {
    if (!voicesRef.current) return;
    const items: VoiceItem[] = newLines
      .filter((l) => l.speaker)
      .map((l) => {
        const file = l.tags.find((t) => t.startsWith('audio:'))?.slice(6);
        const who = l.tags.find((t) => t.startsWith('speaker:'))?.slice(8);
        return { text: l.text, audio: file ? clipsByFile.get(file) : undefined, voice: who ? voicesBySpeaker.get(who) : undefined };
      });
    voiceQueue.current.enqueue(items);
  };
  useEffect(() => () => voiceQueue.current.stop(), []);
  const segment = useRef<Segment | null>(null);

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
    (prefix: Line[], overrides: Segment['overrides'] = {}) => {
      const s = story.current!;
      segment.current = { state: s.state.toJson(), prefix, overrides };
      for (const [n, v] of Object.entries(overrides)) s.variablesState.$(n, v);
      const out = readOn(s, prefix);
      setLines(out);
      speakRef.current(out.slice(prefix.length));
      setChoices(s.currentChoices.map((c) => ({ text: c.text, index: c.index })));
      setWhere((s.currentChoices[0]?.sourcePath ?? '').split('.')[0]);
      readVars();
    },
    [readVars],
  );

  /** A fresh story whose runtime errors are listed in the side panel. */
  const freshStory = useCallback(() => {
    const s = new Story(json!);
    const errs: string[] = [];
    s.onError = (m: string) => {
      errs.push(m);
      setErrors([...errs]);
    };
    story.current = s;
    setErrors([]);
    return s;
  }, [json]);

  const restart = useCallback(() => {
    voiceQueue.current.stop();
    if (!json) return;
    freshStory();
    setHistory([]);
    setNotice('');
    advance([]);
  }, [json, freshStory, advance]);

  useEffect(() => {
    restart();
  }, [restart]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length]);
  // A small bell when the story reaches an ending.
  const isEnd = choices.length === 0 && lines.length > 0;
  useEffect(() => {
    if (isEnd) sfx.chime();
  }, [isEnd]);

  // Playtest keys: 1–9 choose, Backspace undoes, R restarts, V toggles voices.
  const actions = useRef<{ choose: (n: number) => void; undo: () => void; restart: () => void; voices: () => void } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actions.current;
      if (!a || !plainKey(e)) return;
      if (/^[1-9]$/.test(e.key)) a.choose(+e.key - 1);
      else if (e.key === 'Backspace') a.undo();
      else if (e.key.toLowerCase() === 'r') a.restart();
      else if (e.key.toLowerCase() === 'v') a.voices();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!json)
    return (
      <div className="view">
        <Empty title="Nothing to play yet">
          <p className="muted">The story does not compile. Fix the errors in the Diagnostics panel first.</p>
        </Empty>
      </div>
    );

  const choose = (i: number, text: string) => {
    voiceQueue.current.stop();
    const s = story.current!;
    setHistory((h) => [...h, { state: s.state.toJson(), lines, segment: segment.current }]);
    sfx.choice();
    const pause = isPause(s);
    s.ChooseChoiceIndex(i);
    advance([...lines, { text, tags: [], kind: 'choice', pause }]);
  };

  const undo = () => {
    voiceQueue.current.stop();
    const last = history[history.length - 1];
    if (!last || !story.current) return;
    story.current.state.LoadJson(last.state);
    segment.current = last.segment;
    setHistory(history.slice(0, -1));
    setLines(last.lines);
    setChoices(story.current.currentChoices.map((c) => ({ text: c.text, index: c.index })));
    readVars();
  };

  // Like a host game changing its inventory: replay the current stretch of text from its start with
  // the new value so choice conditions are re-evaluated straight away.
  const setVar = (name: string, value: boolean | number | string) => {
    const s = story.current!;
    const seg = segment.current;
    if (seg) {
      s.state.LoadJson(seg.state);
      advance(seg.prefix, { ...seg.overrides, [name]: value });
    } else {
      s.variablesState.$(name, value);
      readVars();
    }
    setNotice(`Set ${name} to ${String(value)}. The choices below were re-checked.`);
  };

  const toggleVoices = () => {
    const on = !voicesOn;
    setVoicesOn(on);
    if (!on) voiceQueue.current.stop();
    try {
      localStorage.setItem(VOICES_KEY, on ? 'on' : 'off');
    } catch {
      /* preference not saved */
    }
  };
  actions.current = {
    choose: (n) => choices[n] && choose(choices[n].index, choices[n].text),
    undo,
    restart,
    voices: toggleVoices,
  };
  const ended = choices.length === 0;
  // The drop cap opens the first real paragraph of prose, not a short line like "FADE IN:".
  const dropCapAt = lines.findIndex((l) => l.kind === 'text' && !l.speaker && !l.tags.includes('transition') && l.text.length >= 40);
  const smoke = processed.smoke;

  return (
    <div className="view playtest-view">
      <main className="stage">
        <div className="stage-head">
          <h2>{processed.project.project.title}</h2>
          <div className="row">
            <button
              className={`btn tiny ${voicesOn ? 'ok' : ''}`}
              aria-pressed={voicesOn}
              title="Read dialogue aloud: recorded clips, or each character's voice from Story settings"
              onClick={toggleVoices}
            >
              {voicesOn ? '🔊 Voices on' : '🔈 Voices off'}
            </button>
            <button className={`btn tiny ${dialogueOnly ? 'ok' : ''}`} aria-pressed={dialogueOnly} title="Show only dialogue (D)" onClick={() => onDialogueOnly(!dialogueOnly)}>
              {dialogueOnly ? 'dialogue only' : 'all text'}
            </button>
            <button className="btn tiny" onClick={undo} disabled={!history.length}>
              ↶ Undo choice
            </button>
            <button className="btn tiny" onClick={restart}>
              Restart
            </button>
          </div>
        </div>
        <div className="transcript" tabIndex={0} aria-label="Story text">
          {lines.map((l, i) =>
            dialogueOnly && l.kind === 'text' && !l.speaker ? null :
            l.pause ? null :
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
              <Fragment key={i}>
                {l.tags.find((t) => t.startsWith('scene:')) && <span className="t-scene">{l.tags.find((t) => t.startsWith('scene:'))!.slice(6)}</span>}
                <p className={l.tags.includes('transition') ? 't-transition' : `t-action${i === dropCapAt ? ' drop' : ''}`}>{l.text}</p>
              </Fragment>
            ),
          )}
          {ended && <p className="t-end">— The End —</p>}
          <div ref={bottom} />
        </div>
        <div className="choices">
          {choices.map((c) => (
            <button key={c.index} className={`choice-btn${choices.length === 1 && c.text === CONTINUE_TEXT ? ' continue' : ''}`} onClick={() => choose(c.index, c.text)}>
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
                voiceQueue.current.stop();
                if (slot.version !== version) {
                  const chosen = slot.lines.filter((l) => l.kind === 'choice').map((l) => l.text);
                  const s = freshStory();
                  const r = replayChoices(s, chosen);
                  segment.current = r.segment;
                  setHistory(r.history);
                  setLines(r.lines);
                  setChoices(s.currentChoices.map((c) => ({ text: c.text, index: c.index })));
                  setWhere((s.currentChoices[0]?.sourcePath ?? '').split('.')[0]);
                  readVars();
                  const n = (k: number) => `${k} choice${k === 1 ? '' : 's'}`;
                  setNotice(
                    `The story changed since this save (version ${slot.version} → ${version}). ` +
                      (r.followed === chosen.length
                        ? `Replayed ${chosen.length === 1 ? 'its choice' : `all ${n(chosen.length)}`} in the new version.`
                        : r.followed
                          ? `${r.followed} of ${n(chosen.length)} still exist, so it resumes after the last one that does.`
                          : `None of its ${n(chosen.length)} exist any more, so it starts from the beginning.`) +
                      ' Readers’ saves of the playable story carry over the same way.',
                  );
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
          <p className="muted small">Edit the story and try loading: a save from another version replays its choices in the new version, as readers' saves do.</p>
        </section>
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
      </aside>
    </div>
  );
}
