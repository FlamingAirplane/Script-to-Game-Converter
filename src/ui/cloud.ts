// Projects in the cloud: each project is a private GitHub Gist in your account, holding its project file
// (the same complete file Save project writes, see projectFile.ts). Any browser with your GitHub token
// lists them and opens one. The token (classic, "gist" scope) is the same the design editor uses
// (design/live.ts); it stays in the browser and is sent only to GitHub.

const API = 'https://api.github.com/gists';
const PREFIX = 'Narrative Bridge project: ';
const LINKS_KEY = 'narrative-bridge.cloud-gists';
/** GitHub accepts large gists, but a very big project is better as a file. */
export const CLOUD_LIMIT = 50 * 1024 * 1024;

export interface CloudProject {
  gistId: string;
  title: string;
  projectId: string;
  updatedAt: string;
  url: string;
}

const headers = (token: string) => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' });

async function check(res: Response): Promise<Response> {
  if (res.status === 401) throw new Error('GitHub didn’t accept the token. Check it, and that it has the “gist” scope.');
  if (res.status === 403 || res.status === 404) throw new Error('GitHub refused: the token needs the “gist” scope, and the project must be yours.');
  if (!res.ok) throw new Error(`GitHub said ${res.status} ${res.statusText}.`);
  return res;
}

function links(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function link(projectId: string, gistId: string) {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify({ ...links(), [projectId]: gistId }));
  } catch {
    /* this visit only */
  }
}

/** The cloud copy this browser knows for a project, if any. */
export function cloudIdOf(projectId: string): string | undefined {
  return links()[projectId];
}

function describe(title: string, projectId: string): string {
  return `${PREFIX}${title.replace(/\s+/g, ' ').slice(0, 120)} (${projectId})`;
}

export function parseDescription(description: string | null): { title: string; projectId: string } | null {
  if (!description?.startsWith(PREFIX)) return null;
  const m = /^(.*) \(([^()]+)\)$/.exec(description.slice(PREFIX.length));
  return m ? { title: m[1], projectId: m[2] } : { title: description.slice(PREFIX.length), projectId: '' };
}

/** Your projects in the cloud, newest first. */
export async function listCloudProjects(token: string): Promise<CloudProject[]> {
  const out: CloudProject[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await check(await fetch(`${API}?per_page=100&page=${page}`, { headers: headers(token), cache: 'no-cache' }));
    const gists = (await res.json()) as { id: string; description: string | null; updated_at: string; html_url: string }[];
    for (const g of gists) {
      const d = parseDescription(g.description);
      if (d) out.push({ gistId: g.id, title: d.title, projectId: d.projectId, updatedAt: g.updated_at, url: g.html_url });
    }
    if (gists.length < 100) break;
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Saves a project file to its private Gist (made the first time). Returns the Gist's id. */
export async function saveToCloud(token: string, json: string, title: string, projectId: string): Promise<{ gistId: string; created: boolean }> {
  if (json.length > CLOUD_LIMIT) throw new Error(`This project is ${Math.round(json.length / 1024 / 1024)} MB, too big for the cloud. Save it as a file instead.`);
  const body = { description: describe(title, projectId), files: { [`${projectId}.nbproj.json`]: { content: json } } };
  const known = cloudIdOf(projectId);
  if (known) {
    const res = await fetch(`${API}/${known}`, { method: 'PATCH', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status !== 404) {
      await check(res);
      return { gistId: known, created: false };
    }
    // Deleted on GitHub since: make a new one.
  }
  const res = await check(await fetch(API, { method: 'POST', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, public: false }) }));
  const g = (await res.json()) as { id: string };
  link(projectId, g.id);
  return { gistId: g.id, created: true };
}

/** A cloud project's file text. Big files come from the Gist's raw address (the API shortens them). */
export async function loadFromCloud(token: string, gistId: string): Promise<string> {
  const res = await check(await fetch(`${API}/${gistId}`, { headers: headers(token), cache: 'no-cache' }));
  const g = (await res.json()) as { description: string | null; files: Record<string, { filename: string; content?: string; truncated?: boolean; raw_url: string }> };
  const file = Object.values(g.files).find((f) => f.filename.endsWith('.nbproj.json'));
  if (!file) throw new Error('That Gist has no Narrative Bridge project in it.');
  const text = file.truncated || file.content == null ? await (await check(await fetch(file.raw_url, { cache: 'no-cache' }))).text() : file.content;
  const d = parseDescription(g.description);
  if (d?.projectId) link(d.projectId, gistId);
  return text;
}
