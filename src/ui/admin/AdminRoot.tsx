import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { THEME_KEY, applyTheme } from '../ThemeToggle';
import { DESIGN_FORMAT, designChanges, emptyDesign, normaliseDesign, sameDesign, setDraft, setPreviewPublished, useDesign, type DesignDoc } from '../design/design';
import { FONT_CHOICES, SETTINGS, TOKENS, TOKEN_GROUPS, WORDS, type Token } from '../design/tokens';
import { ADMIN_LOCK, MAX_TRIES, WAIT_SECONDS, checkPassword, devWithoutPassword, isUnlocked, lockAdmin, recordFailure, rememberUnlock, waitLeft } from './lock';
import { describeElement, readAppRules, ruleMatches, type AppRule } from './rules';
import { BUILT_IN_GIST, gistId, keepToken, publishLive, savedToken, setLocalGist } from '../design/live';
import css from './admin.css?inline';

// The admin design editor: a window over the live app (opened at #admin, behind the password lock).
// It lives in a shadow root, so nothing it changes in the app's design can break the editor itself.

export function mountAdmin(onClose: () => void): () => void {
  const host = document.createElement('div');
  host.id = 'nb-admin-host';
  // The app's keyboard shortcuts stay out of the editor's text fields.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) host.addEventListener(type, (e) => e.stopPropagation());
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const container = document.createElement('div');
  shadow.append(style, container);
  const root = createRoot(container);
  root.render(<AdminRoot onClose={onClose} host={host} />);
  return () => {
    root.unmount();
    host.remove();
  };
}

function AdminRoot({ onClose, host }: { onClose: () => void; host: HTMLElement }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} onClose={onClose} />;
  return (
    <Editor
      onClose={onClose}
      host={host}
      onLock={() => {
        lockAdmin();
        setUnlocked(false);
      }}
    />
  );
}

// ---- Lock screen -----------------------------------------------------------------------------

function LockScreen({ onUnlock, onClose }: { onUnlock: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(waitLeft);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!wait) return;
    const t = setInterval(() => setWait(waitLeft()), 500);
    return () => clearInterval(t);
  }, [wait]);

  const submit = async () => {
    if (busy || wait) return;
    setBusy(true);
    setError('');
    try {
      if (await checkPassword(password)) {
        rememberUnlock();
        onUnlock();
        return;
      }
      recordFailure();
      setWait(waitLeft());
      setError(waitLeft() ? `Too many tries. Wait ${WAIT_SECONDS} seconds.` : 'That isn’t the password.');
      setPassword('');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="lock" role="dialog" aria-modal="true" aria-labelledby="nb-admin-lock-title">
        <h1 id="nb-admin-lock-title">Unlock the design editor</h1>
        {ADMIN_LOCK ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="field">
              <span>Password</span>
              <input ref={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!!wait} />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {wait > 0 && <p className="muted">Try again in {wait} s.</p>}
            <div className="row">
              <button type="button" className="ghost" onClick={onClose}>
                Close
              </button>
              <span className="spacer" />
              <button type="submit" className="primary" disabled={busy || !password || !!wait}>
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </div>
            <p className="muted small">After {MAX_TRIES} wrong tries there’s a short wait.</p>
          </form>
        ) : devWithoutPassword() ? (
          <>
            <p>No admin password is set. While you run the app with <code>npm run dev</code>, the editor opens without one.</p>
            <p className="muted small">
              Set one for builds with <code>NB_ADMIN_PASSWORD</code> in <code>.env.local</code>, or the website’s GitHub secret.
            </p>
            <div className="row">
              <button className="ghost" onClick={onClose}>
                Close
              </button>
              <span className="spacer" />
              <button
                className="primary"
                onClick={() => {
                  rememberUnlock(null);
                  onUnlock();
                }}
              >
                Open the editor
              </button>
            </div>
          </>
        ) : (
          <>
            <p>This copy of Narrative Bridge was built without an admin password, so the design editor can’t be opened here.</p>
            <p className="muted small">
              Set <code>NB_ADMIN_PASSWORD</code> when building (for the website, the repository’s Actions secret) and deploy again.
            </p>
            <div className="row">
              <span className="spacer" />
              <button className="primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- The editor window -------------------------------------------------------------------------

type Tab = 'variables' | 'rules' | 'css' | 'words' | 'settings' | 'publish';
const TABS: [Tab, string][] = [
  ['variables', 'Variables'],
  ['rules', 'Every rule'],
  ['css', 'CSS'],
  ['words', 'Words'],
  ['settings', 'Defaults'],
  ['publish', 'Save & publish'],
];
type Mode = 'light' | 'dark';
const WINDOW_KEY = 'narrative-bridge.admin-window';

function currentMode(): Mode {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The page's own value of every design variable, without the design applied. */
function readBase(): Record<string, string> {
  const el = document.getElementById('nb-design') as HTMLStyleElement | null;
  if (el) el.disabled = true;
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const t of TOKENS) out[t.name] = cs.getPropertyValue(t.name).trim();
  if (el) el.disabled = false;
  return out;
}

function Editor({ onClose, onLock, host }: { onClose: () => void; onLock: () => void; host: HTMLElement }) {
  const { draft, previewPublished, published: live } = useDesign();
  const doc = draft ?? live;
  const [tab, setTab] = useState<Tab>('variables');
  const [mode, setMode] = useState<Mode>(currentMode);
  const [base, setBase] = useState<Record<string, string>>(readBase);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Element | null>(null);
  const history = useRef<{ past: DesignDoc[]; future: DesignDoc[]; lastKey: string; lastAt: number }>({ past: [], future: [], lastKey: '', lastAt: 0 });
  const [, bump] = useState(0);

  // Follow the theme, wherever it's changed (here, the cover band's toggle, or the system).
  useEffect(() => {
    const sync = () => {
      setMode(currentMode());
      setBase(readBase());
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', sync);
    };
  }, []);

  /** Changes the draft (live). Quick repeats of the same edit (dragging a slider) are one undo step. */
  const update = useCallback(
    (fn: (d: DesignDoc) => void, key = '') => {
      const h = history.current;
      const now = Date.now();
      const next = structuredClone(doc);
      fn(next);
      if (!(key && key === h.lastKey && now - h.lastAt < 700)) h.past.push(doc);
      if (h.past.length > 200) h.past.shift();
      h.future = [];
      h.lastKey = key;
      h.lastAt = now;
      setPreviewPublished(false);
      setDraft(next);
    },
    [doc],
  );
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(doc);
    h.lastKey = '';
    setDraft(prev);
    bump((n) => n + 1);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(doc);
    h.lastKey = '';
    setDraft(next);
    bump((n) => n + 1);
  };

  // Window position and size, remembered.
  const [box, setBox] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WINDOW_KEY) ?? 'null');
      if (saved && typeof saved.left === 'number') return saved as { left: number; top: number; width: number; height: number; min: boolean };
    } catch {
      /* first time */
    }
    const width = Math.min(460, innerWidth - 24);
    return { left: innerWidth - width - 16, top: 16, width, height: Math.min(innerHeight - 32, 900), min: false };
  });
  useEffect(() => {
    try {
      localStorage.setItem(WINDOW_KEY, JSON.stringify(box));
    } catch {
      /* not remembered */
    }
  }, [box]);
  const win = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = win.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (box.min) return;
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - box.width) > 2 || Math.abs(r.height - box.height) > 2) setBox((b) => ({ ...b, width: Math.round(r.width), height: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [box.min, box.width, box.height]);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const start = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    const move = (m: PointerEvent) =>
      setBox((b) => ({ ...b, left: Math.max(-b.width + 80, Math.min(innerWidth - 80, start.left + m.clientX - start.x)), top: Math.max(0, Math.min(innerHeight - 40, start.top + m.clientY - start.y)) }));
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  // Pick an element on the page to see the rules that style it.
  const [hover, setHover] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!picking) return;
    const inEditor = (e: Event) => e.composedPath().includes(host);
    const move = (e: MouseEvent) => {
      if (inEditor(e)) return setHover(null);
      setHover((e.target as Element).getBoundingClientRect());
    };
    const click = (e: MouseEvent) => {
      if (inEditor(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPicked(e.target as Element);
      setPicking(false);
      setHover(null);
      setTab('rules');
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (setPicking(false), setHover(null));
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [picking, host]);

  const changes = designChanges(doc);
  const published = sameDesign(doc, live);
  const h = history.current;

  const switchMode = (m: Mode) => {
    applyTheme(m);
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      /* this visit only */
    }
  };

  return (
    <>
      {hover && <div className="pick-box" style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }} />}
      <div
        ref={win}
        className={`window ${box.min ? 'min' : ''}`}
        style={{ left: box.left, top: box.top, width: box.width, height: box.min ? undefined : box.height }}
        role="dialog"
        aria-label="Design editor"
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          const field = (e.target as HTMLElement).matches('input, textarea, select');
          if (mod && e.key.toLowerCase() === 'z' && !field) {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
          }
        }}
      >
        <header onPointerDown={drag} onDoubleClick={() => setBox((b) => ({ ...b, min: !b.min }))}>
          <strong>Design editor</strong>
          <span className={`status ${published ? '' : 'draft'}`}>{previewPublished ? 'showing published' : published ? 'as published' : `draft · ${changes} change${changes === 1 ? '' : 's'}`}</span>
          <span className="spacer" />
          <div className="seg" role="group" aria-label="Theme being edited">
            <button aria-pressed={mode === 'light'} onClick={() => switchMode('light')} title="Light pages">
              ☀
            </button>
            <button aria-pressed={mode === 'dark'} onClick={() => switchMode('dark')} title="Night edition">
              ☾
            </button>
          </div>
          <button onClick={undo} disabled={!h.past.length} title="Undo (⌘Z)" aria-label="Undo">
            ↶
          </button>
          <button onClick={redo} disabled={!h.future.length} title="Redo (⇧⌘Z)" aria-label="Redo">
            ↷
          </button>
          <button aria-pressed={picking} onClick={() => setPicking(!picking)} title="Pick something on the page to see the rules that style it (Esc cancels)" aria-label="Pick an element">
            ⌖
          </button>
          <button onClick={() => setBox((b) => ({ ...b, min: !b.min }))} aria-label={box.min ? 'Expand' : 'Minimise'} title={box.min ? 'Expand' : 'Minimise'}>
            {box.min ? '▢' : '–'}
          </button>
          <button onClick={onClose} aria-label="Close the editor" title="Close (your draft stays)">
            ✕
          </button>
        </header>
        {!box.min && (
          <>
            <nav role="tablist">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="body">
              {tab === 'variables' && <VariablesTab doc={doc} base={base} mode={mode} update={update} />}
              {tab === 'rules' && <RulesTab doc={doc} update={update} picked={picked} setPicked={setPicked} onPick={() => setPicking(true)} />}
              {tab === 'css' && <CssTab doc={doc} update={update} />}
              {tab === 'words' && <WordsTab doc={doc} update={update} />}
              {tab === 'settings' && <SettingsTab doc={doc} update={update} />}
              {tab === 'publish' && <PublishTab doc={doc} update={update} onLock={onLock} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}

type Update = (fn: (d: DesignDoc) => void, key?: string) => void;

// ---- Variables -------------------------------------------------------------------------------

function VariablesTab({ doc, base, mode, update }: { doc: DesignDoc; base: Record<string, string>; mode: Mode; update: Update }) {
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const mapFor = (t: Token) => (t.perTheme ? doc[mode] : doc.tokens);
  const shown = TOKENS.filter((t) => {
    if (onlyChanged && mapFor(t)[t.name] == null) return false;
    const s = q.trim().toLowerCase();
    return !s || t.name.includes(s) || t.label.toLowerCase().includes(s) || t.group.toLowerCase().includes(s) || (mapFor(t)[t.name] ?? base[t.name] ?? '').toLowerCase().includes(s);
  });
  return (
    <>
      <div className="tools">
        <input type="search" placeholder="Find a variable, e.g. paper, radius, #dda15e" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a variable" />
        <label className="check">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> changed
        </label>
      </div>
      <p className="muted small">
        Colours marked {mode === 'light' ? '☀' : '☾'} are for the {mode === 'light' ? 'light pages' : 'night edition'}; switch themes at the top to edit the other. Everything
        else applies to both.
      </p>
      {TOKEN_GROUPS.map((g) => {
        const list = shown.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g}>
            <h2>{g}</h2>
            {list.map((t) => {
              const map = mapFor(t);
              const over = map[t.name];
              const value = over ?? base[t.name] ?? '';
              const set = (v: string | null) =>
                update((d) => {
                  const m = t.perTheme ? d[mode] : d.tokens;
                  if (v == null || v === base[t.name]) delete m[t.name];
                  else m[t.name] = v;
                }, `${mode}:${t.name}`);
              return <TokenRow key={t.name} token={t} value={value} changed={over != null} theme={t.perTheme ? mode : null} onChange={set} />;
            })}
          </section>
        );
      })}
      {!shown.length && <p className="muted">Nothing matches.</p>}
    </>
  );
}

function TokenRow({ token: t, value, changed, theme, onChange }: { token: Token; value: string; changed: boolean; theme: Mode | null; onChange: (v: string | null) => void }) {
  return (
    <div className={`token ${changed ? 'changed' : ''}`}>
      <div className="token-head">
        <span className="label">
          {t.label} {theme && <span className="muted">{theme === 'light' ? '☀' : '☾'}</span>}
        </span>
        <code>{t.name}</code>
        {changed && (
          <button className="reset" onClick={() => onChange(null)} title="Back to the built-in value" aria-label={`Reset ${t.label}`}>
            ↺
          </button>
        )}
      </div>
      <TokenControl token={t} value={value} onChange={onChange} />
      {t.hint && <span className="muted small">{t.hint}</span>}
    </div>
  );
}

export function parseColour(v: string): { hex: string; alpha: number } | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { hex: `#${[...m[1]].map((c) => c + c).join('')}`, alpha: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return { hex: `#${m[1]}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const hex = `#${[m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('')}`;
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex, alpha: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

export function formatColour(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+alpha.toFixed(2)})`;
}

function TokenControl({ token: t, value, onChange }: { token: Token; value: string; onChange: (v: string) => void }) {
  const text = <TextInput value={value} onCommit={onChange} label={t.label} long={t.kind === 'image' || t.kind === 'shadow' || t.kind === 'font'} />;
  if (t.kind === 'color') {
    const c = parseColour(value);
    if (!c) return <div className="control">{text}</div>;
    return (
      <div className="control">
        <input type="color" value={c.hex} onChange={(e) => onChange(formatColour(e.target.value, c.alpha))} aria-label={`${t.label} colour`} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={c.alpha}
          onChange={(e) => onChange(formatColour(c.hex, +e.target.value))}
          aria-label={`${t.label} opacity`}
          title={`Opacity ${Math.round(c.alpha * 100)}%`}
          className="alpha"
        />
        {text}
      </div>
    );
  }
  if (t.kind === 'length' || t.kind === 'number' || t.kind === 'time') {
    const unit = t.kind === 'length' ? 'px' : t.kind === 'time' ? 's' : '';
    const m = /^(-?[\d.]+)(px|s|ms)?$/.exec(value.trim());
    const num = m ? (m[2] === 'ms' ? +m[1] / 1000 : +m[1]) : null;
    if (num == null || (unit && m![2] && m![2] !== unit && !(unit === 's' && m![2] === 'ms'))) return <div className="control">{text}</div>;
    return (
      <div className="control">
        <input type="range" min={t.min} max={t.max} step={t.step} value={num} onChange={(e) => onChange(`${e.target.value}${unit}`)} aria-label={t.label} />
        <input type="number" className="num" min={t.min} max={t.max} step={t.step} value={num} onChange={(e) => e.target.value !== '' && onChange(`${e.target.value}${unit}`)} aria-label={`${t.label} value`} />
        <span className="muted">{unit}</span>
      </div>
    );
  }
  if (t.kind === 'font')
    return (
      <div className="control column">
        <select value={FONT_CHOICES.find((f) => f.value === value)?.value ?? ''} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={`${t.label} choice`}>
          <option value="">Custom…</option>
          {FONT_CHOICES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {text}
      </div>
    );
  if (t.name === '--grain')
    return (
      <div className="control column">
        <label className="check">
          <input type="checkbox" checked={value !== 'none'} onChange={(e) => onChange(e.target.checked ? '' : 'none')} /> paper grain on
        </label>
        {text}
      </div>
    );
  return <div className="control">{text}</div>;
}

/** A text field that applies on Enter or when you leave it (so typing half a value doesn't break the page). */
function TextInput({ value, onCommit, label, long, placeholder }: { value: string; onCommit: (v: string) => void; label: string; long?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v.trim());
  if (long)
    return (
      <textarea
        className="text"
        rows={2}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), commit())}
        aria-label={label}
        spellCheck={false}
      />
    );
  return <input className="text" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-label={label} spellCheck={false} />;
}

// ---- Every rule ------------------------------------------------------------------------------

const PAGE = 40;

function RulesTab({ doc, update, picked, setPicked, onPick }: { doc: DesignDoc; update: Update; picked: Element | null; setPicked: (e: Element | null) => void; onPick: () => void }) {
  const [rules, setRules] = useState<AppRule[]>(() => readAppRules());
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [q, onlyChanged, picked]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rules.filter((r) => {
      if (onlyChanged && !doc.rules[r.key]) return false;
      if (picked && !ruleMatches(r, picked)) return false;
      return !s || r.key.toLowerCase().includes(s) || r.decls.some((d) => `${d.prop}: ${d.value}`.toLowerCase().includes(s));
    });
    if (!picked) return list;
    // The rules written for this element (its classes, its id) first; catch-alls like * last.
    const names = [...picked.classList].map((c) => `.${c}`).concat(picked.id ? [`#${picked.id}`] : []);
    const score = (r: AppRule) => names.filter((n) => new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r.selector)).length * 10 + (/^[*:]|^[a-z]+(,|$)/.test(r.selector) ? 0 : 1);
    return list.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s || b.i - a.i).map((x) => x.r);
  }, [rules, q, onlyChanged, picked, doc.rules]);
  const total = rules.reduce((n, r) => n + r.decls.length, 0);
  return (
    <>
      <div className="tools">
        <input type="search" placeholder="Find a selector, property or value, e.g. .btn, padding, #283618" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a rule" />
        <label className="check">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> changed
        </label>
      </div>
      <div className="tools">
        <button onClick={onPick}>⌖ Pick on the page</button>
        {picked && (
          <span className="picked">
            <code>{describeElement(picked)}</code>
            {picked.parentElement && picked.parentElement !== document.body && (
              <button onClick={() => setPicked(picked.parentElement)} title="The element around it">
                ↑ parent
              </button>
            )}
            <button onClick={() => setPicked(null)} aria-label="Show all rules">
              ✕
            </button>
          </span>
        )}
        <span className="spacer" />
        <button onClick={() => setRules(readAppRules())} title="Read the page's rules again">
          Refresh
        </button>
      </div>
      <p className="muted small">
        {rules.length} rules, {total} properties. Showing {Math.min(limit, shown.length)} of {shown.length}. Changes apply to the same selector, after the app’s own.
      </p>
      {shown.slice(0, limit).map((r) => (
        <RuleCard key={r.key} rule={r} over={doc.rules[r.key] ?? {}} update={update} />
      ))}
      {shown.length > limit && (
        <button className="more" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
    </>
  );
}

function RuleCard({ rule, over, update }: { rule: AppRule; over: Record<string, string>; update: Update }) {
  const [prop, setProp] = useState('');
  const [val, setVal] = useState('');
  const set = (p: string, v: string | null, important = false) =>
    update((d) => {
      const m = (d.rules[rule.key] ??= {});
      const base = rule.decls.find((x) => x.prop === p);
      if (v == null || (base && v === base.value && !important)) delete m[p];
      else m[p] = important && !/!important$/.test(v) ? `${v} !important` : v;
      if (!Object.keys(m).length) delete d.rules[rule.key];
    }, `rule:${rule.key}:${p}`);
  const extra = Object.keys(over).filter((p) => !rule.decls.some((d) => d.prop === p));
  const name = `${rule.media ? `@media ${rule.media} ` : ''}${rule.selector}`;
  return (
    <section className={`rule ${Object.keys(over).length ? 'changed' : ''}`}>
      <h3>
        {rule.media && <span className="media">@media {rule.media}</span>}
        <code>{rule.selector}</code>
      </h3>
      {rule.decls.map((d) => {
        const o = over[d.prop];
        return (
          <div key={d.prop} className={`decl ${o != null ? 'changed' : ''}`}>
            <span className="prop">{d.prop}</span>
            <TextInput value={o != null ? o.replace(/\s*!important$/, '') : d.value} onCommit={(v) => set(d.prop, v || null, d.important)} label={`${name} ${d.prop}`} />
            {o != null && (
              <button className="reset" onClick={() => set(d.prop, null)} aria-label={`Reset ${d.prop}`} title={`Back to ${d.value}`}>
                ↺
              </button>
            )}
          </div>
        );
      })}
      {extra.map((p) => (
        <div key={p} className="decl changed added">
          <span className="prop">{p}</span>
          <TextInput value={over[p]} onCommit={(v) => set(p, v || null)} label={`${name} ${p}`} />
          <button className="reset" onClick={() => set(p, null)} aria-label={`Remove ${p}`}>
            ✕
          </button>
        </div>
      ))}
      <form
        className="decl add"
        onSubmit={(e) => {
          e.preventDefault();
          const p = prop.trim().toLowerCase();
          if (/^-?[a-z][a-z0-9-]*$|^--[\w-]+$/.test(p) && val.trim()) {
            set(p, val.trim());
            setProp('');
            setVal('');
          }
        }}
      >
        <input className="prop" placeholder="+ property" value={prop} onChange={(e) => setProp(e.target.value)} aria-label={`New property for ${name}`} spellCheck={false} />
        <input className="text" placeholder="value" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Its value" spellCheck={false} />
        <button type="submit" disabled={!prop.trim() || !val.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

// ---- CSS, words, defaults ------------------------------------------------------------------

function CssTab({ doc, update }: { doc: DesignDoc; update: Update }) {
  const [v, setV] = useState(doc.css);
  useEffect(() => setV(doc.css), [doc.css]);
  useEffect(() => {
    if (v === doc.css) return;
    const t = setTimeout(() => update((d) => void (d.css = v), 'css'), 300);
    return () => clearTimeout(t);
  }, [v, doc.css, update]);
  return (
    <>
      <p className="muted small">Any CSS, added after everything else. Use it for what the other tabs don’t reach: new rules, animations, fonts from a URL.</p>
      <textarea className="code" value={v} onChange={(e) => setV(e.target.value)} spellCheck={false} aria-label="Extra CSS" placeholder={'.btn.primary {\n  letter-spacing: 0.1em;\n}'} />
    </>
  );
}

function WordsTab({ doc, update }: { doc: DesignDoc; update: Update }) {
  return (
    <>
      <p className="muted small">Words in the app. Leave a field empty for the built-in text.</p>
      {Object.entries(WORDS).map(([key, [label, builtIn]]) => (
        <div key={key} className={`token ${doc.words[key] != null ? 'changed' : ''}`}>
          <div className="token-head">
            <span className="label">{label}</span>
            {doc.words[key] != null && (
              <button className="reset" onClick={() => update((d) => void delete d.words[key])} aria-label={`Reset ${label}`}>
                ↺
              </button>
            )}
          </div>
          <TextInput
            value={doc.words[key] ?? ''}
            placeholder={builtIn}
            long={builtIn.length > 60}
            label={label}
            onCommit={(v) =>
              update((d) => {
                if (v) d.words[key] = v;
                else delete d.words[key];
              })
            }
          />
        </div>
      ))}
    </>
  );
}

function SettingsTab({ doc, update }: { doc: DesignDoc; update: Update }) {
  return (
    <>
      <p className="muted small">What people get before they choose for themselves. Their own choice always wins (and is remembered in their browser).</p>
      {SETTINGS.map((s) => {
        const v = doc.settings[s.key] ?? s.default;
        const set = (x: boolean | string) =>
          update((d) => {
            if (x === s.default) delete d.settings[s.key];
            else d.settings[s.key] = x;
          });
        return (
          <div key={s.key} className={`token ${doc.settings[s.key] != null ? 'changed' : ''}`}>
            {s.type === 'boolean' ? (
              <label className="check">
                <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} /> {s.label}
              </label>
            ) : (
              <label className="field">
                <span>{s.label}</span>
                <select value={String(v)} onChange={(e) => set(e.target.value)}>
                  {s.choices!.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
            <span className="muted small">{s.hint}</span>
          </div>
        );
      })}
    </>
  );
}

// ---- Save and publish ------------------------------------------------------------------------

function PublishTab({ doc, update, onLock }: { doc: DesignDoc; update: Update; onLock: () => void }) {
  const { previewPublished, published: base } = useDesign();
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const text = JSON.stringify(doc, null, 2) + '\n';
  const isPublished = sameDesign(doc, base);
  const say = (s: string) => {
    setNote(s);
    setTimeout(() => setNote((n) => (n === s ? '' : n)), 4000);
  };
  const downloadFile = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'published.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const load = async (f: File) => {
    try {
      const raw = JSON.parse(await f.text());
      if (raw?.format !== DESIGN_FORMAT) throw new Error('not a Narrative Bridge design file');
      update((d) => Object.assign(d, normaliseDesign(raw)));
      say(`Loaded ${f.name}.`);
    } catch (e) {
      say(`Couldn’t load ${f.name}: ${(e as Error).message}`);
    }
  };
  return (
    <>
      <label className="field">
        <span>Design name</span>
        <TextInput value={doc.name} label="Design name" onCommit={(v) => update((d) => void (d.name = v || 'Narrative Bridge'))} />
      </label>
      <Box title="This draft">
        <p>
          {isPublished ? 'The same as the published design.' : `${designChanges(doc)} change${designChanges(doc) === 1 ? '' : 's'} from the built-in design; it differs from what’s published.`} It’s saved in
          this browser as you go and shown only here.
        </p>
        <label className="check">
          <input type="checkbox" checked={previewPublished} onChange={(e) => setPreviewPublished(e.target.checked)} /> Show the published design instead (to compare)
        </label>
      </Box>
      <LiveBox doc={doc} say={say} />
      <Box title="Or publish it with a commit (built into the site)">
        <ol>
          <li>
            <button className="primary" onClick={downloadFile}>
              Download published.json
            </button>{' '}
            <button
              onClick={() =>
                navigator.clipboard.writeText(text).then(
                  () => say('Copied.'),
                  () => say('Couldn’t copy; use Download.'),
                )
              }
            >
              Copy
            </button>
          </li>
          <li>
            Replace <code>src/ui/design/published.json</code> in the repository with it (or run <code>npm run design:publish -- ~/Downloads/published.json</code>).
          </li>
          <li>Commit and push to main. GitHub Pages rebuilds the site, and every visitor gets the new design.</li>
        </ol>
      </Box>
      <Box title="Files">
        <div className="row wrap">
          <button onClick={() => file.current?.click()}>Load a design file…</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = '';
            }}
          />
          <button disabled={isPublished} onClick={() => update((d) => Object.assign(d, structuredClone(base)))}>
            Back to the published design
          </button>
          <button disabled={designChanges(doc) === 0} onClick={() => update((d) => Object.assign(d, emptyDesign(d.name)))}>
            Start from the built-in design
          </button>
        </div>
        <p className="muted small">Both can be undone (↶).</p>
      </Box>
      {note && (
        <p className="note" role="status">
          {note}
        </p>
      )}
      <Box title="Access">
        <p className="muted small">The editor stays unlocked in this tab until you close it or lock it. Closing the editor keeps your draft.</p>
        <button onClick={onLock}>Lock the editor</button>
      </Box>
    </>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="box">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Publishing without a commit: the design goes to a public GitHub Gist that every visitor's app reads
 * when it opens. A GitHub token (classic, with only the "gist" scope) is what allows it; it stays in
 * this browser and is sent only to GitHub.
 */
function LiveBox({ doc, say }: { doc: DesignDoc; say: (s: string) => void }) {
  const [token, setToken] = useState(savedToken);
  const [remember, setRemember] = useState(() => !!savedToken() && (() => { try { return !!localStorage.getItem('narrative-bridge.github-token'); } catch { return false; } })());
  const [id, setId] = useState(gistId() ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; url: string; created: boolean } | null>(null);
  const publish = async () => {
    setBusy(true);
    try {
      keepToken(token.trim(), remember);
      if (id.trim() && id.trim() !== BUILT_IN_GIST) setLocalGist(id.trim());
      const r = await publishLive(doc, token.trim(), id.trim() || null);
      setId(r.id);
      setResult(r);
      say(r.created ? 'Created the live design.' : 'Published. Visitors get it the next time they open the site.');
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const needsSetup = !BUILT_IN_GIST || (id && id !== BUILT_IN_GIST);
  return (
    <Box title="Publish it for everyone, now (no commit)">
      <p className="small">
        The design goes to a public GitHub Gist that the site reads when it opens: no commit, no rebuild. Visitors get it the next time they open the
        site.
      </p>
      <label className="field">
        <span>GitHub token</span>
        <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" aria-label="GitHub token" />
      </label>
      <p className="muted small">
        Make one at github.com → Settings → Developer settings → Personal access tokens → <em>Tokens (classic)</em>, with only the <code>gist</code> scope. It stays
        in this browser and is sent only to GitHub.
      </p>
      <label className="check small">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it in this browser (otherwise until this tab closes)
      </label>
      <label className="field">
        <span>Gist {BUILT_IN_GIST ? '(set up for the site)' : '(leave empty to create it)'}</span>
        <input className="mono" spellCheck={false} value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="created the first time you publish" aria-label="Gist id" />
      </label>
      <div className="row wrap">
        <button className="primary" disabled={busy || !token.trim()} onClick={() => void publish()}>
          {busy ? 'Publishing…' : id ? 'Publish now' : 'Create the live design'}
        </button>
        {token && (
          <button
            onClick={() => {
              keepToken('', false);
              setToken('');
              say('Token forgotten.');
            }}
          >
            Forget the token
          </button>
        )}
      </div>
      {result && (
        <p className="small">
          Live at <a href={result.url} target="_blank" rel="noreferrer">its Gist</a>.
        </p>
      )}
      {needsSetup && id && (
        <p className="muted small">
          One-time setup so every visitor reads it: run <code>gh variable set NB_DESIGN_GIST --body {id}</code> in the project, then <code>gh workflow run pages.yml</code>.
          Until then, only this browser uses it.
        </p>
      )}
    </Box>
  );
}
