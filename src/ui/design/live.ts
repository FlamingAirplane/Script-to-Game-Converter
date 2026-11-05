import { DESIGN_FORMAT, normaliseDesign, setLiveDesign, type DesignDoc } from './design';

// The live design: a public GitHub Gist holding design.json. Every visitor's app reads it when it
// opens (and keeps the last copy, so the next visit shows it at once), so the admin publishes a design
// without a commit or a rebuild. Only someone with a GitHub token for the Gist's owner can change it:
// the admin pastes one into the design editor, and it stays in their browser.
//
// The Gist's id is built in (NB_DESIGN_GIST, a repository variable); until it's set, the admin's own
// browser can use one it's told (LOCAL_GIST_KEY), to try it before everyone gets it.

declare const __NB_DESIGN_GIST__: string | null;

export const LOCAL_GIST_KEY = 'narrative-bridge.design-gist';
export const TOKEN_KEY = 'narrative-bridge.github-token';
const FILE = 'design.json';
const API = 'https://api.github.com/gists';

export const BUILT_IN_GIST: string | null = typeof __NB_DESIGN_GIST__ !== 'undefined' ? __NB_DESIGN_GIST__ : null;

function stored(key: string, store: () => Storage = () => localStorage): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

/** The Gist this browser reads the live design from: its own (the admin trying one), else the built-in one. */
export function gistId(): string | null {
  return stored(LOCAL_GIST_KEY) || BUILT_IN_GIST;
}

export function setLocalGist(id: string | null) {
  try {
    if (id) localStorage.setItem(LOCAL_GIST_KEY, id);
    else localStorage.removeItem(LOCAL_GIST_KEY);
  } catch {
    /* this visit only */
  }
}

const GIST_ID = /^[0-9a-f]{20,40}$/i;

/** Reads the live design (when there is a Gist) and applies it. Never throws: a failure keeps the last copy. */
export async function loadLiveDesign(fetcher: typeof fetch = fetch): Promise<'updated' | 'same' | 'none' | 'failed'> {
  const id = gistId();
  if (!id || !GIST_ID.test(id)) return 'none';
  try {
    const res = await fetcher(`${API}/${id}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-cache' });
    if (!res.ok) return 'failed';
    const gist = (await res.json()) as { files?: Record<string, { content?: string }> };
    const content = gist.files?.[FILE]?.content;
    if (!content) return 'failed';
    const raw = JSON.parse(content);
    if (raw?.format !== DESIGN_FORMAT) return 'failed';
    const doc = normaliseDesign(raw);
    const before = stored('narrative-bridge.design-live');
    setLiveDesign(doc);
    return before === JSON.stringify(doc) ? 'same' : 'updated';
  } catch {
    return 'failed';
  }
}

/** The admin's GitHub token, if they chose to keep it in this browser (otherwise for this tab only). */
export function savedToken(): string {
  return stored(TOKEN_KEY) || stored(TOKEN_KEY, () => sessionStorage) || '';
}

export function keepToken(token: string, remember: boolean) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    /* not kept */
  }
}

async function gitHub(method: string, url: string, token: string, body: unknown): Promise<{ id: string; html_url: string }> {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('GitHub didn’t accept the token. Check it, and that it can create gists (the “gist” scope).');
  if (res.status === 403 || res.status === 404) throw new Error('GitHub refused: the token needs the “gist” scope, and must belong to the Gist’s owner.');
  if (!res.ok) throw new Error(`GitHub said ${res.status} ${res.statusText}.`);
  return res.json();
}

const fileOf = (doc: DesignDoc) => ({ [FILE]: { content: JSON.stringify(doc, null, 2) + '\n' } });

/** Publishes the design to the live Gist, creating it (public) the first time. Returns the Gist's id and page. */
export async function publishLive(doc: DesignDoc, token: string, id = gistId()): Promise<{ id: string; url: string; created: boolean }> {
  if (id && GIST_ID.test(id)) {
    const g = await gitHub('PATCH', `${API}/${id}`, token, { files: fileOf(doc) });
    setLiveDesign(doc);
    return { id: g.id, url: g.html_url, created: false };
  }
  const g = await gitHub('POST', API, token, { description: 'Narrative Bridge live design (read by the website when it opens)', public: true, files: fileOf(doc) });
  setLocalGist(g.id);
  setLiveDesign(doc);
  return { id: g.id, url: g.html_url, created: true };
}
