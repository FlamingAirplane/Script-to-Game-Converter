import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { StoryProject } from '../core/isr';
import { assignInOrder, detectSegments, formatTime, parseTime, sessionLines, type Segment, type SessionLine } from '../core/session';
import { clipUrl, decodeSession, getClip, putClip, storeCut, storeSession } from './audioStore';
import type { Update } from './projectOps';

// "Link a recording session": load one long recording of a voice session, mark where each line of
// dialogue is in it (type the times, drag on the waveform, or set them from the playhead while it plays;
// or let it find the takes and give them to the lines in order), then cut each marked stretch out as
// that line's clip. Clips remember where they came from, so the links can be opened and changed again.

type Decoded = { samples: Float32Array; rate: number };
type Drafts = Record<string, Segment | null>;

const same = (a?: Segment | null, b?: Segment | null) => (!a && !b) || (!!a && !!b && Math.abs(a.start - b.start) < 0.0005 && Math.abs(a.end - b.end) < 0.0005);

export function SessionLinker({ project, update, onClose }: { project: StoryProject; update: Update; onClose: () => void }) {
  const sessions = project.sessions ?? [];
  const [sessionId, setSessionId] = useState<string | null>(sessions[sessions.length - 1]?.id ?? null);
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const lines = useMemo(() => sessionLines(project), [project]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [active, setActive] = useState<string | null>(null);
  const [speaker, setSpeaker] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [takes, setTakes] = useState<Segment[]>([]);
  const [sensitivity, setSensitivity] = useState(0.3);
  const [minGap, setMinGap] = useState(0.5);
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopAt = useRef<number | null>(null);
  const [span, setSpan] = useState(20);
  const [viewStart, setViewStart] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const relink = useRef<HTMLInputElement>(null);
  const duration = decoded ? decoded.samples.length / decoded.rate : (session?.durationMs ?? 0) / 1000;

  // The links as they are in the project, for this session.
  const saved = useMemo(() => {
    const m: Drafts = {};
    for (const l of lines) if (l.from && l.from.session === sessionId) m[l.slot] = { start: l.from.start, end: l.from.end };
    return m;
  }, [lines, sessionId]);
  useEffect(() => {
    setDrafts(saved);
    setTakes([]);
  }, [sessionId]);
  const linkOf = (slot: string): Segment | null => (slot in drafts ? drafts[slot] : (saved[slot] ?? null));
  const changed = lines.filter((l) => !same(linkOf(l.slot), saved[l.slot] ?? null));

  // Load (and decode) the selected session's recording.
  useEffect(() => {
    setDecoded(null);
    setMissing(false);
    setError('');
    if (!session) return;
    let live = true;
    let made: string | null = null;
    setBusy('Reading the recording…');
    void (async () => {
      try {
        const clip = await getClip(session.id);
        if (!clip) {
          if (live) setMissing(true);
          return;
        }
        made = clipUrl(clip);
        const d = await decodeSession(clip.bytes);
        if (!live) return;
        setUrl(made);
        setDecoded(d);
        setViewStart(0);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setBusy('');
      }
    })();
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [session]);

  // The playhead, and stopping at the end of a line being played.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a) {
        if (stopAt.current != null && a.currentTime >= stopAt.current) {
          a.pause();
          stopAt.current = null;
        }
        setTime(a.currentTime);
        setPlaying(!a.paused);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Keep the playhead in view while playing.
  useEffect(() => {
    if (playing && (time < viewStart || time > viewStart + span)) setViewStart(Math.max(0, Math.min(time - span * 0.1, duration - span)));
  }, [time, playing, viewStart, span, duration]);

  const seek = useCallback((t: number) => {
    const a = audio.current;
    if (!a) return;
    stopAt.current = null;
    a.currentTime = Math.max(0, t);
    setTime(a.currentTime);
  }, []);
  const playFrom = (seg: Segment) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = seg.start;
    stopAt.current = seg.end;
    void a.play();
    setViewStart(Math.max(0, Math.min(seg.start - span * 0.15, duration - span)));
  };
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    stopAt.current = null;
    if (a.paused) void a.play();
    else a.pause();
  };

  const setLink = (slot: string, seg: Segment | null) => setDrafts((d) => ({ ...d, [slot]: seg && seg.end > seg.start ? { start: round(seg.start), end: round(seg.end) } : null }));
  const setEdge = (slot: string, edge: 'start' | 'end', t: number) => {
    const cur = linkOf(slot) ?? { start: t, end: t };
    const next = { ...cur, [edge]: t };
    if (next.end <= next.start) next[edge === 'start' ? 'end' : 'start'] = edge === 'start' ? t + 1 : Math.max(0, t - 1);
    setLink(slot, next);
  };

  const shown = lines.filter((l) => (!speaker || l.speakerId === speaker) && (!onlyOpen || !linkOf(l.slot)));
  const activeLine = lines.find((l) => l.slot === active) ?? null;
  const move = (dir: 1 | -1) => {
    const i = shown.findIndex((l) => l.slot === active);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + dir))];
    if (next) {
      setActive(next.slot);
      const seg = linkOf(next.slot);
      if (seg) setViewStart(Math.max(0, Math.min(seg.start - span * 0.15, duration - span)));
    }
  };

  const loadSession = async (f: File) => {
    setBusy('Reading the recording…');
    setError('');
    try {
      const ref = await storeSession(f, f.name);
      update((d) => void (d.sessions = [...(d.sessions ?? []), ref]));
      setSessionId(ref.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };
  // A project opened elsewhere has the session's reference but not its recording: find it again.
  const relinkSession = async (f: File) => {
    if (!session) return;
    await putClip(session.id, session.mime, new Uint8Array(await f.arrayBuffer()));
    setSessionId(null);
    setTimeout(() => setSessionId(session.id));
  };

  const detect = () => {
    if (!decoded) return;
    const found = detectSegments(decoded.samples, decoded.rate, { sensitivity, minGap });
    setTakes(found);
    setNote(found.length ? `Found ${found.length} take${found.length === 1 ? '' : 's'}. Pick the first line they belong to, then give them out in order.` : 'No takes found: try a higher sensitivity or a shorter pause.');
  };
  const giveOut = () => {
    const from = Math.max(0, shown.findIndex((l) => l.slot === active));
    const slots = shown.slice(from).map((l) => l.slot);
    const given = assignInOrder(slots, takes);
    setDrafts((d) => ({ ...d, ...given }));
    const n = Object.keys(given).length;
    setNote(`Gave ${n} take${n === 1 ? '' : 's'} to ${n} line${n === 1 ? '' : 's'}${takes.length > slots.length ? `; ${takes.length - slots.length} take(s) were left over` : ''}. Check them, then cut.`);
  };

  const apply = async () => {
    if (!session || !decoded) return;
    setBusy('Cutting clips…');
    try {
      const cuts: { line: SessionLine; seg: Segment | null; ref?: Awaited<ReturnType<typeof storeCut>> }[] = [];
      for (const l of changed) {
        const seg = linkOf(l.slot);
        cuts.push({ line: l, seg, ref: seg ? await storeCut(session, decoded, seg, l.speakerId) : undefined });
      }
      // One edit, so a single Undo takes them all back.
      update((d) => {
        for (const c of cuts) {
          const b = d.passages.find((p) => p.id === c.line.passageId)?.content[c.line.index];
          if (b?.type !== 'dialogue') continue;
          if (c.ref) b.audio = c.ref;
          else if (b.audio?.from?.session === session.id) delete b.audio;
        }
      });
      setDrafts({});
      const made = cuts.filter((c) => c.ref).length;
      const removed = cuts.length - made;
      setNote(`Cut ${made} clip${made === 1 ? '' : 's'}${removed ? ` and unlinked ${removed} line${removed === 1 ? '' : 's'}` : ''}. Undo takes them back.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const close = () => {
    if (changed.length && !confirm(`${changed.length} line${changed.length === 1 ? ' has' : 's have'} links that haven’t been cut yet. Close anyway?`)) return;
    audio.current?.pause();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the app's own shortcuts stay out of this window
    const field = (e.target as HTMLElement).matches('input, select, textarea');
    if (e.key === 'Escape') return close();
    if (field || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') (e.preventDefault(), toggle());
    else if ((e.key === 'i' || e.key === '[') && active) setEdge(active, 'start', time);
    else if ((e.key === 'o' || e.key === ']') && active) setEdge(active, 'end', time);
    else if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
    else if (e.key === 'Enter' && active && linkOf(active)) playFrom(linkOf(active)!);
  };

  const characters = project.characters.filter((c) => lines.some((l) => l.speakerId === c.id));
  const regions = lines.flatMap((l) => {
    const seg = linkOf(l.slot);
    return seg ? [{ seg, label: String(l.number), slot: l.slot }] : [];
  });

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet card session-linker" role="dialog" aria-modal="true" aria-labelledby="session-title" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="row wrap">
          <h2 id="session-title">Recording session</h2>
          {sessions.length > 0 && (
            <select className="input" value={sessionId ?? ''} onChange={(e) => setSessionId(e.target.value || null)} aria-label="Session">
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.durationMs ? `(${formatTime(s.durationMs / 1000)})` : ''}
                </option>
              ))}
            </select>
          )}
          <button className="btn small" onClick={() => file.current?.click()} disabled={!!busy}>
            {sessions.length ? 'Load another…' : 'Load a session recording…'}
          </button>
          <span className="spacer" />
          <button className="btn small ghost" onClick={close}>
            Close
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.m4a,.aac,.flac,.webm"
          hidden
          aria-label="Session recording file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadSession(f);
            e.target.value = '';
          }}
        />
        {!session && (
          <div className="dropzone session-drop" onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), e.dataTransfer.files[0] && void loadSession(e.dataTransfer.files[0]))}>
            <strong>Load one long recording of a voice session</strong>
            <span className="muted small">Then mark where each line is in it, or let it find the takes and give them to the lines in order. Each marked stretch becomes that line’s clip.</span>
          </div>
        )}
        {busy && <p className="muted small">{busy}</p>}
        {error && <p className="error-text small">{error}</p>}
        {missing && session && (
          <p className="small">
            The recording for <strong>{session.name}</strong> isn’t in this browser.{' '}
            <button className="btn tiny" onClick={() => relink.current?.click()}>
              Find it…
            </button>
            <input ref={relink} type="file" accept="audio/*" hidden aria-label="Find the session recording" onChange={(e) => e.target.files?.[0] && void relinkSession(e.target.files[0])} />
          </p>
        )}
        {session && decoded && url && (
          <>
            <audio ref={audio} src={url} preload="auto" />
            <div className="session-transport row wrap">
              <button className="btn small" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? '❚❚ Pause' : '▶ Play'}
              </button>
              <span className="mono small" aria-live="off">
                {formatTime(time)} / {formatTime(duration)}
              </span>
              <label className="row small">
                <span className="muted">Zoom</span>
                <input type="range" min={3} max={Math.max(10, Math.min(600, duration))} step={1} value={Math.min(span, Math.max(10, duration))} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Seconds shown" />
                <span className="muted mono">{Math.round(span)} s</span>
              </label>
              <span className="spacer" />
              <span className="muted small">Space play · I / O set the line’s start and end · ↑ ↓ lines · Enter plays the line</span>
            </div>
            <Wave decoded={decoded} from={0} to={duration} height={44} time={time} regions={regions} takes={takes} active={active} onSeek={(t) => (seek(t), setViewStart(Math.max(0, Math.min(t - span / 2, duration - span))))} label="Whole session" />
            <Wave
              decoded={decoded}
              from={viewStart}
              to={Math.min(duration, viewStart + span)}
              height={120}
              time={time}
              regions={regions}
              takes={takes}
              active={active}
              onSeek={seek}
              onSelect={active ? (seg) => setLink(active, seg) : undefined}
              onPick={(slot) => setActive(slot)}
              label={activeLine ? `Drag to mark line ${activeLine.number}` : 'Pick a line below, then drag here to mark it'}
            />
            <div className="session-tools row wrap">
              <label className="row small" title="Higher finds fewer, louder takes">
                <span className="muted">Sensitivity</span>
                <input type="range" min={0.05} max={0.8} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Take sensitivity" />
              </label>
              <label className="row small">
                <span className="muted">Pause between takes</span>
                <input type="range" min={0.2} max={3} step={0.1} value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} aria-label="Pause between takes" />
                <span className="muted mono">{minGap.toFixed(1)} s</span>
              </label>
              <button className="btn small" onClick={detect}>
                Find takes
              </button>
              <button className="btn small" disabled={!takes.length || !shown.length} onClick={giveOut} title="The first take to the selected line (or the first shown), the next to the next line, and so on">
                Give {takes.length || ''} takes to lines in order{activeLine ? ` from line ${activeLine.number}` : ''}
              </button>
            </div>
            {note && (
              <p className="small note-text" role="status">
                {note}
              </p>
            )}
            <div className="session-filter row wrap">
              <label className="row small">
                <span className="muted">Lines of</span>
                <select className="input" value={speaker} onChange={(e) => setSpeaker(e.target.value)} aria-label="Show lines of">
                  <option value="">everyone</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check small">
                <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> only lines not linked yet
              </label>
              <span className="spacer" />
              <span className="muted small">
                {lines.filter((l) => linkOf(l.slot)).length} of {lines.length} lines linked to this session
              </span>
            </div>
            <div className="session-lines" role="list">
              {shown.map((l) => (
                <LineRow
                  key={l.slot}
                  line={l}
                  seg={linkOf(l.slot)}
                  changed={!same(linkOf(l.slot), saved[l.slot] ?? null)}
                  active={l.slot === active}
                  otherClip={l.hasClip && !saved[l.slot]}
                  onActivate={() => setActive(l.slot)}
                  onSet={(seg) => setLink(l.slot, seg)}
                  onEdge={(edge) => setEdge(l.slot, edge, time)}
                  onPlay={(seg) => playFrom(seg)}
                />
              ))}
              {!shown.length && <p className="muted small">No lines to show.</p>}
            </div>
          </>
        )}
        {session && (
          <div className="session-footer row wrap">
            <span className="muted small">The session recording stays in this browser; the clips cut from it are saved with your project.</span>
            <span className="spacer" />
            {changed.length > 0 && (
              <button className="btn small ghost" onClick={() => setDrafts({})}>
                Discard changes
              </button>
            )}
            <button className="btn primary" disabled={!changed.length || !!busy || !decoded} onClick={() => void apply()}>
              {changed.length ? `Cut and attach ${changed.length} clip${changed.length === 1 ? '' : 's'}` : 'Nothing to cut'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const round = (s: number) => Math.round(s * 1000) / 1000;

function LineRow({ line: l, seg, changed, active, otherClip, onActivate, onSet, onEdge, onPlay }: { line: SessionLine; seg: Segment | null; changed: boolean; active: boolean; otherClip: boolean; onActivate: () => void; onSet: (s: Segment | null) => void; onEdge: (e: 'start' | 'end') => void; onPlay: (s: Segment) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div ref={ref} role="listitem" className={`session-line${active ? ' active' : ''}${changed ? ' changed' : ''}`} onClick={onActivate}>
      <span className="mono small num">{l.number}</span>
      <span className="who small">{l.speaker}</span>
      <span className="what small" title={l.text}>
        {l.parenthetical ? <em className="muted">({l.parenthetical}) </em> : null}
        {l.text}
        {otherClip && <span className="muted"> · has its own recording</span>}
      </span>
      <TimeField value={seg?.start} label={`Line ${l.number} start`} onChange={(t) => onSet(t == null ? null : { start: t, end: seg && seg.end > t ? seg.end : t + 1 })} />
      <TimeField value={seg?.end} label={`Line ${l.number} end`} onChange={(t) => t != null && onSet({ start: seg ? Math.min(seg.start, t - 0.05) : Math.max(0, t - 1), end: t })} />
      <span className="buttons">
        <button className="icon" title="Start here (I)" aria-label={`Set line ${l.number}'s start to the playhead`} onClick={(e) => (e.stopPropagation(), onEdge('start'))}>
          ⇤
        </button>
        <button className="icon" title="End here (O)" aria-label={`Set line ${l.number}'s end to the playhead`} onClick={(e) => (e.stopPropagation(), onEdge('end'))}>
          ⇥
        </button>
        <button className="icon" disabled={!seg} title="Play it (Enter)" aria-label={`Play line ${l.number}`} onClick={(e) => (e.stopPropagation(), seg && onPlay(seg))}>
          ▶
        </button>
        <button className="icon" disabled={!seg} title="Unlink" aria-label={`Unlink line ${l.number}`} onClick={(e) => (e.stopPropagation(), onSet(null))}>
          ✕
        </button>
      </span>
    </div>
  );
}

function TimeField({ value, label, onChange }: { value?: number; label: string; onChange: (t: number | null) => void }) {
  const [text, setText] = useState(value != null ? formatTime(value) : '');
  useEffect(() => setText(value != null ? formatTime(value) : ''), [value]);
  const commit = () => {
    if (!text.trim()) return value != null && onChange(null);
    const t = parseTime(text);
    if (t == null) setText(value != null ? formatTime(value) : '');
    else if (t !== value) onChange(t);
  };
  return (
    <input
      className="input small mono time"
      value={text}
      placeholder="m:ss.00"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** A waveform of part of the session, with the linked lines, found takes and the playhead over it. */
function Wave({
  decoded,
  from,
  to,
  height,
  time,
  regions,
  takes,
  active,
  onSeek,
  onSelect,
  onPick,
  label,
}: {
  decoded: Decoded;
  from: number;
  to: number;
  height: number;
  time: number;
  regions: { seg: Segment; label: string; slot: string }[];
  takes: Segment[];
  active: string | null;
  onSeek: (t: number) => void;
  onSelect?: (s: Segment) => void;
  onPick?: (slot: string) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [drag, setDrag] = useState<Segment | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(100, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Draw the min and max of the samples under each pixel.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);
    g.fillStyle = getComputedStyle(c).color;
    const { samples, rate } = decoded;
    const a = Math.floor(from * rate);
    const per = Math.max(1, ((to - from) * rate) / width);
    // Long views sample every few values: plenty for a picture, and fast.
    const stride = Math.max(1, Math.floor(per / 400));
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const s = Math.floor(a + x * per);
      const e = Math.min(samples.length, Math.floor(a + (x + 1) * per));
      let lo = 0;
      let hi = 0;
      for (let i = s; i < e; i += stride) {
        const v = samples[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
    }
  }, [decoded, from, to, width, height]);
  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return from + ((clientX - r.left) / r.width) * (to - from);
  };
  const x = (t: number) => `${((t - from) / (to - from)) * 100}%`;
  const w = (s: Segment) => `${((Math.min(s.end, to) - Math.max(s.start, from)) / (to - from)) * 100}%`;
  const inView = (s: Segment) => s.end > from && s.start < to;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.wave-region')) return;
    const t0 = at(e.clientX);
    const x0 = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (m: PointerEvent) => onSelect && Math.abs(m.clientX - x0) > 3 && setDrag({ start: Math.min(t0, at(m.clientX)), end: Math.max(t0, at(m.clientX)) });
    const up = (u: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      setDrag(null);
      if (onSelect && Math.abs(u.clientX - x0) > 3) onSelect({ start: Math.max(0, Math.min(t0, at(u.clientX))), end: Math.max(t0, at(u.clientX)) });
      else onSeek(t0);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return (
    <div className="wave" ref={box} style={{ height }} onPointerDown={down} role="img" aria-label={`${label}: ${formatTime(from)} to ${formatTime(to)}`}>
      <canvas ref={canvas} style={{ width: '100%', height }} />
      {takes.filter(inView).map((s, i) => (
        <span key={`t${i}`} className="wave-take" style={{ left: x(Math.max(s.start, from)), width: w(s) }} />
      ))}
      {regions
        .filter((r) => inView(r.seg))
        .map((r) => (
          <span
            key={r.slot}
            className={`wave-region${r.slot === active ? ' active' : ''}`}
            style={{ left: x(Math.max(r.seg.start, from)), width: w(r.seg) }}
            onPointerDown={(e) => (e.stopPropagation(), onPick?.(r.slot))}
            title={`Line ${r.label}: ${formatTime(r.seg.start)}–${formatTime(r.seg.end)}`}
          >
            {r.label}
          </span>
        ))}
      {drag && <span className="wave-region drag" style={{ left: x(drag.start), width: w(drag) }} />}
      {time >= from && time <= to && <span className="wave-head" style={{ left: x(time) }} />}
      <span className="wave-label muted small">{label}</span>
    </div>
  );
}
