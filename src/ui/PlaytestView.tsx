// Engine-only runtime: the compiler isn't needed to play an already compiled story.
import type { SceneRequest } from './NewScene';
import { pendingSuggestions } from '../core/adapt';
import { Story } from 'inkjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fnv1a } from '../core/hash';
import { lockedChoices } from '../core/gating';
import { portraitFiles, referencedImages } from '../core/images';
import { usePictures } from './pictures';
import { CONTINUE_TEXT, exitOf, itemVar } from '../core/isr';
import { isPause, knotOf, readOn, type Line } from '../core/reader';
import type { ProcessedStory } from '../core/pipeline';
import { audioFileName, referencedAudio } from '../core/audio';
import { Empty } from './common';
import { cutsceneSeconds } from '../core/players';
import { sfx } from './sfx';
import { plainKey } from './Shortcuts';
import { VoiceQueue, type VoiceItem } from './voice';
import { cueSounds } from '../core/cues';
import { CuePlayer } from './cueAudio';
import { translate } from '../core/export/translations';

import { Toolbar } from './playtest/Toolbar';
import { Transcript } from './playtest/Transcript';
import { Choices } from './playtest/Choices';
import { Inspector } from './playtest/Inspector';
import {
  cuesOf,
  isCutscene,
  nextShown,
  offered,
  reducedMotion,
  replayChoices,
  replayNote,
  type OfferedChoice,
  type Segment,
  type Snapshot,
} from './playtest/state';

const VOICES_KEY = 'narrative-bridge.voices';
const CUE_SOUNDS_KEY = 'narrative-bridge.cue-sounds';
const LANGUAGE_KEY = 'narrative-bridge.playtest-language';

export function PlaytestView({
  processed,
  onOpen,
  dialogueOnly,
  onDialogueOnly,
  showGated,
  onShowGated,
  onReview,
  onApproveAll,
  onNewScene,
}: {
  processed: ProcessedStory;
  onOpen: (id: string) => void;
  dialogueOnly: boolean;
  onDialogueOnly: (on: boolean) => void;
  showGated: boolean;
  onShowGated: (on: boolean) => void;
  onReview?: () => void;
  onApproveAll?: () => void;
  /** Opens the New scene form, after the passage being played. */
  onNewScene?: (r: SceneRequest) => void;
}) {
  const json = processed.compile.json;
  const version = fnv1a(processed.generated.ink);
  const story = useRef<Story | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [choices, setChoices] = useState<OfferedChoice[]>([]);
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
  // Choices taken before, in this read or an earlier one: greyed out (still clickable). Kept per story, through Restart.
  const chosenStoreKey = `narrative-bridge.playtest-chosen.${processed.project.project.id}`;
  const [chosenBefore, setChosenBefore] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(chosenStoreKey) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const keepChosen = (next: Set<string>) => {
    setChosenBefore(next);
    try {
      if (next.size) localStorage.setItem(chosenStoreKey, JSON.stringify([...next]));
      else localStorage.removeItem(chosenStoreKey);
    } catch {
      /* kept for this visit only */
    }
  };
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [where, setWhere] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  /**
   * Where the text a choice led to begins (an index into the lines). Set by a choice, so the next render scrolls
   * there, to the start of the new text, rather than to its end; and the lines from there on fade in.
   */
  const newFrom = useRef<number | null>(null);
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
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
  // Scene pictures by the file name used in #image tags.
  const pictures = usePictures(referencedImages(processed.project));
  // Character portraits by speaker id (the #speaker tag).
  const portraitBySpeaker = portraitFiles(processed.project);
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

  // The sounds writers attached to cues: music and ambience follow the story (after an undo too), sounds play once.
  const sounds = useMemo(() => cueSounds(processed.project), [processed.project]);
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const cuePlayer = useRef(new CuePlayer(() => soundsRef.current));
  const [cueSoundsOn, setCueSoundsOn] = useState(() => {
    try {
      return localStorage.getItem(CUE_SOUNDS_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const cueSoundsRef = useRef(cueSoundsOn);
  cueSoundsRef.current = cueSoundsOn;
  const toggleCueSounds = () => {
    const on = !cueSoundsOn;
    setCueSoundsOn(on);
    try {
      localStorage.setItem(CUE_SOUNDS_KEY, on ? 'on' : 'off');
    } catch {
      /* preference not saved */
    }
  };
  useEffect(() => () => cuePlayer.current.stop(), []);

  // Translations brought in on the Export page: Playtest can show the story in one of them.
  const languages = processed.project.translations?.languages ?? [];
  const [language, setLanguageState] = useState(() => {
    try {
      return localStorage.getItem(LANGUAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const lang = languages.includes(language) ? language : '';
  const setLanguage = (code: string) => {
    setLanguageState(code);
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch {
      /* preference not saved */
    }
  };
  const T = (text: string) => translate(processed.project, lang, text);
  const segment = useRef<Segment | null>(null);
  // A cutscene plays its lines one at a time: how many of `lines` are shown so far (all, unless one is playing).
  const [shown, setShown] = useState<{ lines: Line[]; n: number } | null>(null);
  // (Still playing while its last line is read, so the choices wait for it.)
  const playing = !!shown && shown.lines === lines;
  const visible = playing ? Math.min(shown.n, lines.length) : lines.length;

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
      const cut = out.findIndex((l, i) => i >= prefix.length && isCutscene(l));
      setShown(cut >= 0 ? { lines: out, n: cut + 1 } : null);
      setLines(out);
      speakRef.current(out.slice(prefix.length));
      if (cueSoundsRef.current) cuePlayer.current.play(cuesOf(out.slice(prefix.length)));
      setChoices(offered(s));
      setWhere(knotOf(s));
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
    setFreshFrom(null);
    newFrom.current = 0; // the top
    advance([]);
  }, [json, freshStory, advance]);

  useEffect(() => {
    restart();
  }, [restart]);

  useEffect(() => {
    const box = transcript.current;
    const at = newFrom.current;
    newFrom.current = null;
    const behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth';
    // After a choice: the start of what it led to, at the top, so the reader reads on from its first line.
    const first = box && at !== null ? [...box.querySelectorAll<HTMLElement>('[data-at]')].find((e) => +e.dataset.at! >= at) : undefined;
    if (box && first)
      box.scrollTo({ top: box.scrollTop + first.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: at ? behavior : 'auto' });
    // Otherwise (a cutscene's next line, a loaded save, a changed value) the end, where the story is now.
    else if (at === null) bottom.current?.scrollIntoView({ behavior, block: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, visible]);
  // A cutscene goes on by itself once there's been time to read the line.
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(
      () => setShown((s) => (s && s.lines === lines ? (nextShown(lines, s.n) ? { lines, n: nextShown(lines, s.n) } : null) : s)),
      cutsceneSeconds(lines[visible - 1]?.text ?? '') * 1000,
    );
    return () => clearTimeout(t);
  }, [playing, visible, lines]);
  const skipCutscene = () => setShown(null);
  useEffect(() => {
    if (cueSoundsOn && sounds.size) cuePlayer.current.sync(cuesOf(lines));
    else cuePlayer.current.stop();
  }, [lines, cueSoundsOn, sounds]);
  // A small bell when the story reaches an ending.
  const isEnd = choices.length === 0 && lines.length > 0 && !playing;
  useEffect(() => {
    if (isEnd) sfx.chime();
  }, [isEnd]);

  // Playtest keys: 1–9 choose, Backspace undoes, R restarts, V toggles voices.
  const actions = useRef<{ choose: (n: number) => void; goOn: () => boolean; undo: () => void; restart: () => void; voices: () => void } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actions.current;
      if (!a || !plainKey(e)) return;
      if (/^[1-9]$/.test(e.key)) a.choose(+e.key - 1);
      // Enter or Space goes on at a Continue break (or a cutscene, or a lone choice), unless a button has focus.
      else if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement)) {
        if (!a.goOn()) return;
      } else if (e.key === 'Backspace') a.undo();
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

  const exitNote = (name: string): string | undefined => {
    for (const p of processed.project.passages) for (const b of p.content) if (b.type === 'exit' && b.name === name && b.note) return b.note;
  };
  const choose = (i: number, text: string) => {
    voiceQueue.current.stop();
    const s = story.current!;
    // Taken now, before the choice: an updater function may run later, once the story has moved on.
    const before: Snapshot = { state: s.state.toJson(), lines, segment: segment.current };
    setHistory((h) => [...h, before]);
    sfx.choice();
    const pause = isPause(s);
    const taken = choices.find((c) => c.index === i);
    if (taken && !pause && !exitOf(taken.text) && !chosenBefore.has(taken.key) && !chosenBefore.has(taken.legacy))
      keepChosen(new Set([...chosenBefore, taken.key]));
    s.ChooseChoiceIndex(i);
    newFrom.current = lines.length;
    setFreshFrom(lines.length);
    advance([...lines, { text, tags: [], kind: 'choice', pause, ...(taken?.id ? { choiceId: taken.id } : {}) }]);
  };

  const undo = () => {
    voiceQueue.current.stop();
    const last = history[history.length - 1];
    if (!last || !story.current) return;
    story.current.state.LoadJson(last.state);
    segment.current = last.segment;
    setHistory(history.slice(0, -1));
    setLines(last.lines);
    setChoices(offered(story.current));
    setFreshFrom(null);
    readVars();
    // Back at the choice: show the end of the text before it, where the choices are.
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end' }));
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
    choose: (n) => (playing ? n === 0 && skipCutscene() : choices[n] && choose(choices[n].index, choices[n].text)),
    goOn: () => {
      if (playing) skipCutscene();
      else if (choices.length === 1) choose(choices[0].index, choices[0].text);
      else return false;
      return true;
    },
    undo,
    restart,
    voices: toggleVoices,
  };
  const portraitOf = (l: Line) => {
    const who = l.tags.find((t) => t.startsWith('speaker:'))?.slice(8);
    const file = who && portraitBySpeaker[who];
    return file ? pictures.get(file) : undefined;
  };
  const pictureFor = (l: Line) => {
    const file = l.tags.find((t) => t.startsWith('image:'))?.slice(6);
    return file ? pictures.get(file) : undefined;
  };
  const ended = choices.length === 0 && !playing;
  // The last passage read, still known once the story has ended (to add a scene after it).
  const lastWhere = where || ([...lines].reverse().find((l) => l.passage)?.passage ?? '');
  // Choices the reader can't take yet. Not at a Continue break: a passage's choices come after its last break.
  const locked =
    showGated && story.current && !(choices.length === 1 && choices[0].text === CONTINUE_TEXT)
      ? lockedChoices(processed.generated.info.gated, where, (n) => story.current!.variablesState.$(n), choices)
      : [];
  // The drop cap opens the first real paragraph of prose, not a short line like "FADE IN:".
  const dropCapAt = lines.findIndex((l) => l.kind === 'text' && !l.speaker && !l.tags.includes('transition') && l.text.length >= 40);
  /** The lines a choice just led to fade in. */
  const fresh = (i: number) => (freshFrom !== null && i >= freshFrom ? ' t-fresh' : '');
  const pending = pendingSuggestions(processed.project);

  const saveSlot = () => {
    setSlot({ version, state: story.current!.state.toJson(), lines });
    setNotice(`Saved at story version ${version}.`);
  };
  const loadSlot = () => {
    if (!slot) return;
    voiceQueue.current.stop();
    if (slot.version !== version) {
      const chosen = slot.lines.filter((l) => l.kind === 'choice').map((l) => ({ text: l.text, id: l.choiceId }));
      const s = freshStory();
      const r = replayChoices(s, chosen);
      segment.current = r.segment;
      setHistory(r.history);
      setLines(r.lines);
      setChoices(offered(s));
      setWhere(knotOf(s));
      readVars();
      setNotice(replayNote(slot.version, version, r.followed, chosen.length));
      return;
    }
    story.current!.state.LoadJson(slot.state);
    setLines(slot.lines);
    setChoices(offered(story.current!));
    readVars();
    setNotice('Loaded.');
  };

  return (
    <div className="view playtest-view">
      <main className="stage">
        {pending > 0 && (
          <div className="pending-banner" role="status">
            <span>
              <strong>{pending}</strong> suggestion{pending > 1 ? 's are' : ' is'} waiting for your OK and {pending > 1 ? 'aren’t' : 'isn’t'} in this
              playthrough, so some choices may be missing.
            </span>
            <span className="row">
              {onReview && (
                <button className="btn tiny" onClick={onReview}>
                  Review them
                </button>
              )}
              {onApproveAll && (
                <button className="btn tiny ok" onClick={onApproveAll} title="Approves every suggestion (you can undo this)">
                  Approve all and play
                </button>
              )}
            </span>
          </div>
        )}
        <Toolbar
          processed={processed}
          voicesOn={voicesOn}
          toggleVoices={toggleVoices}
          hasCueSounds={sounds.size > 0}
          cueSoundsOn={cueSoundsOn}
          toggleCueSounds={toggleCueSounds}
          languages={languages}
          lang={lang}
          setLanguage={setLanguage}
          dialogueOnly={dialogueOnly}
          onDialogueOnly={onDialogueOnly}
          showGated={showGated}
          onShowGated={onShowGated}
          canUndo={history.length > 0}
          undo={undo}
          restart={restart}
          chosenCount={chosenBefore.size}
          forgetChosen={() => keepChosen(new Set())}
        />
        <Transcript
          lines={lines}
          visible={visible}
          dialogueOnly={dialogueOnly}
          fresh={fresh}
          dropCapAt={dropCapAt}
          playing={playing}
          ended={ended}
          hasSound={(tag) => sounds.has(tag)}
          T={T}
          portraitOf={portraitOf}
          pictureFor={pictureFor}
          transcript={transcript}
          bottom={bottom}
        />
        <Choices
          choices={choices}
          playing={playing}
          ended={ended}
          chosenBefore={chosenBefore}
          locked={locked}
          T={T}
          exitNote={exitNote}
          choose={choose}
          skipCutscene={skipCutscene}
          restart={restart}
          canAddScene={processed.project.passages.some((p) => p.id === lastWhere)}
          lastWhere={lastWhere}
          onNewScene={onNewScene}
        />
        {errors.length > 0 && (
          <div className="error-box">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
      </main>

      <Inspector
        processed={processed}
        where={where}
        ended={ended}
        onOpen={onOpen}
        onNewScene={onNewScene}
        varNames={varNames}
        vars={vars}
        setVar={setVar}
        notice={notice}
        hasSlot={!!slot}
        onSave={saveSlot}
        onLoad={loadSlot}
      />
    </div>
  );
}
