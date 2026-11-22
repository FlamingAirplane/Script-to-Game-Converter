import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build } from './helpers';

describe('admin design editor', () => {
  it('turns a design into CSS that wins over the app, per theme, and keeps files safe', async () => {
    const { designCss, normaliseDesign, designChanges, ruleKey, splitRuleKey } = await import('../src/ui/design/design');
    const d = normaliseDesign({
      format: 'narrative-bridge-design',
      tokens: { '--radius': '9px', 'not a var': '1px', '--bad': 'x } body { display: none' },
      light: { '--paper': '#ffffff' },
      dark: { '--paper': '#000000' },
      rules: { '.btn': { 'letter-spacing': '0.2em', 'bad prop': 'x' }, [ruleKey('.ribbon', '(max-width: 760px)')]: { display: 'block' }, 'a { b': { color: 'red' } },
      words: { brand: 'Story Forge', unknown: 'x' },
      settings: { sound: false, theme: 'sepia', showLocked: 'yes' },
    });
    expect(d.tokens).toEqual({ '--radius': '9px', '--bad': 'x  body  display: none' });
    expect(Object.keys(d.rules)).toEqual(['.btn', '@media (max-width: 760px)|.ribbon']);
    expect(d.words).toEqual({ brand: 'Story Forge' });
    expect(d.settings).toEqual({ sound: false });
    expect(designChanges(d)).toBe(8);
    expect(splitRuleKey('@media (max-width: 760px)|.ribbon')).toEqual({ media: '(max-width: 760px)', selector: '.ribbon' });
    const css = designCss(d);
    expect(css).toContain(":root:root:root { --radius: 9px;");
    expect(css).toContain(":root:root:root[data-theme='light'] { --paper: #ffffff; }");
    expect(css).toContain("@media (prefers-color-scheme: dark) { :root:root:root:not([data-theme='light']) { --paper: #000000; } }");
    expect(css).toContain('.btn { letter-spacing: 0.2em; }');
    expect(css).toContain('@media (max-width: 760px) { .ribbon { display: block; } }');
    expect(css).not.toMatch(/\}\s*body\s*\{/);
  });

  it('checks the password the way the build hashed it, and reads colours and rules', async () => {
    const { pbkdf2Sync } = await import('node:crypto');
    const { checkPassword, stretch } = await import('../src/ui/admin/lock');
    const salt = Buffer.from('0123456789abcdef');
    const lock = { salt: salt.toString('base64'), hash: pbkdf2Sync('open sesame', salt, 1000, 32, 'sha256').toString('base64'), iterations: 1000 };
    expect(await stretch('open sesame', lock.salt, 1000)).toBe(lock.hash);
    expect(await checkPassword('open sesame', lock)).toBe(true);
    expect(await checkPassword('open sesame ', lock)).toBe(false);
    expect(await checkPassword('', lock)).toBe(false);
    expect(await checkPassword('open sesame', null)).toBe(false);
    const { parseColour, formatColour } = await import('../src/ui/admin/AdminRoot');
    expect(parseColour('#abc')).toEqual({ hex: '#aabbcc', alpha: 1 });
    expect(parseColour('rgba(96, 108, 56, 0.1)')).toEqual({ hex: '#606c38', alpha: 0.1 });
    expect(parseColour('color-mix(in srgb, red 10%, transparent)')).toBeNull();
    expect(formatColour('#606c38', 0.25)).toBe('rgba(96, 108, 56, 0.25)');
    expect(formatColour('#606c38', 1)).toBe('#606c38');
    const { parseDeclarations, splitTopLevel } = await import('../src/ui/admin/rules');
    expect(parseDeclarations('color: red; background: url("a;b.png") no-repeat; padding: 2px !important; --x: 1')).toEqual([
      { prop: 'color', value: 'red', important: false },
      { prop: 'background', value: 'url("a;b.png") no-repeat', important: false },
      { prop: 'padding', value: '2px', important: true },
      { prop: '--x', value: '1', important: false },
    ]);
    expect(splitTopLevel('.a:is(.b, .c), .d', ',')).toEqual(['.a:is(.b, .c)', '.d']);
  });

  it('lists every design variable the stylesheet defines', async () => {
    const { TOKENS } = await import('../src/ui/design/tokens');
    const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    for (const t of TOKENS) expect(root, t.name).toContain(`${t.name}:`);
  });
});

describe('live design', () => {
  it('reads the published design from its Gist, keeps it for the next visit, and ignores anything else', async () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    Object.assign(globalThis, { localStorage: store, sessionStorage: store });
    const { loadLiveDesign, setLocalGist, gistId } = await import('../src/ui/design/live');
    const { designState } = await import('../src/ui/design/design');
    expect(await loadLiveDesign(async () => new Response('{}'))).toBe('none'); // no Gist yet
    setLocalGist('0123456789abcdef0123');
    expect(gistId()).toBe('0123456789abcdef0123');
    const design = { format: 'narrative-bridge-design', version: 1, name: 'Live', tokens: { '--radius': '8px' }, words: { brand: 'Story Forge' } };
    const asked: string[] = [];
    const gist = async (url: string | URL | Request) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ files: { 'design.json': { content: JSON.stringify(design) } } }));
    };
    expect(await loadLiveDesign(gist as typeof fetch)).toBe('updated');
    expect(asked).toEqual(['https://api.github.com/gists/0123456789abcdef0123']);
    expect(designState().design.tokens['--radius']).toBe('8px');
    expect(designState().published.words.brand).toBe('Story Forge');
    expect(mem.get('narrative-bridge.design-live')).toContain('Story Forge');
    expect(await loadLiveDesign(gist as typeof fetch)).toBe('same');
    // Not a design, or GitHub unreachable: the last copy stays.
    expect(await loadLiveDesign((async () => new Response(JSON.stringify({ files: { 'design.json': { content: '{"format":"other"}' } } }))) as typeof fetch)).toBe('failed');
    expect(await loadLiveDesign((async () => { throw new Error('offline'); }) as typeof fetch)).toBe('failed');
    expect(designState().published.words.brand).toBe('Story Forge');
  });
});

describe('projects on other browsers', () => {
  it('packs every kind of media a project uses', async () => {
    const { projectMediaRefs } = await import('../src/ui/projectFile');
    const { project } = await build('@passage hall Hall\nMIRA: Who is there?\n\nMIRA: Hello?\n@end\n', 'm.md', 'structured');
    const [a, b] = project.passages[0].content.filter((x) => x.type === 'dialogue') as { audio?: unknown }[];
    a.audio = { id: 'vo_own', name: 'take.wav', mime: 'audio/wav' };
    b.audio = { id: 'vo_region', name: 'r.wav', mime: 'audio/wav', from: { session: 'ses_1', start: 0, end: 1 }, region: true };
    project.passages[0].image = { id: 'img_hall', name: 'hall.png', mime: 'image/png' };
    project.characters[0].portrait = { id: 'img_mira', name: 'mira.png', mime: 'image/png' };
    project.sessions = [{ id: 'ses_1', name: 'Session.wav', mime: 'audio/wav' }];
    (project.sources[0] as { original?: unknown }).original = { id: 'orig_1', name: 'm.docx', mime: 'application/x', byteLength: 3 };
    // A region has no file of its own: the session it plays from goes instead.
    expect(projectMediaRefs(project).map((r) => r.id).sort()).toEqual(['img_hall', 'img_mira', 'orig_1', 'ses_1', 'vo_own']);
  });

  it('saves to a private Gist, lists your projects, and opens big ones from the raw file', async () => {
    const mem = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } });
    const { saveToCloud, listCloudProjects, loadFromCloud, cloudIdOf, parseDescription } = await import('../src/ui/cloud');
    const calls: { method: string; url: string; body?: { public?: boolean; description?: string; files?: Record<string, unknown> } }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'POST') return new Response(JSON.stringify({ id: 'abc123' }));
      if (method === 'PATCH') return new Response('{}');
      if (String(url).includes('?per_page')) return new Response(JSON.stringify([{ id: 'abc123', description: 'Narrative Bridge project: The Archive (archive)', updated_at: '2026-11-06T10:00:00Z', html_url: 'https://gist.github.com/abc123' }, { id: 'zzz', description: 'my notes', updated_at: '2026-11-06T11:00:00Z', html_url: '' }]));
      if (String(url).endsWith('/abc123')) return new Response(JSON.stringify({ description: 'Narrative Bridge project: The Archive (archive)', files: { 'archive.nbproj.json': { filename: 'archive.nbproj.json', truncated: true, content: '{', raw_url: 'https://gist.githubusercontent.com/raw/x' } } }));
      if (String(url).includes('raw')) return new Response('{"project":"full"}');
      return new Response('', { status: 500 });
    }) as typeof fetch;
    try {
      expect(await saveToCloud('t', '{"x":1}', 'The Archive', 'archive')).toEqual({ gistId: 'abc123', created: true });
      expect(calls[0].body).toMatchObject({ public: false, description: 'Pen to Ink project: The Archive (archive)' });
      // Gists made under the old name are still read.
      expect(parseDescription('Narrative Bridge project: The Archive (archive)')).toEqual({ title: 'The Archive', projectId: 'archive' });
      expect(parseDescription('Pen to Ink project: The Archive (archive)')).toEqual({ title: 'The Archive', projectId: 'archive' });
      expect(Object.keys(calls[0].body!.files!)).toEqual(['archive.nbproj.json']);
      expect(cloudIdOf('archive')).toBe('abc123');
      expect(await saveToCloud('t', '{"x":2}', 'The Archive', 'archive')).toEqual({ gistId: 'abc123', created: false });
      expect(calls[1].method).toBe('PATCH');
      expect((await listCloudProjects('t')).map((p) => [p.title, p.projectId])).toEqual([['The Archive', 'archive']]);
      expect(await loadFromCloud('t', 'abc123')).toBe('{"project":"full"}');
      expect(parseDescription('something else')).toBeNull();
      await expect(saveToCloud('t', 'x'.repeat(51 * 1024 * 1024), 'Big', 'big')).rejects.toThrow(/too big/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('live design safety', () => {
  it('drops anything in a live design that would load from another site', async () => {
    const { withoutRemoteLoads } = await import('../src/ui/design/live');
    const { normaliseDesign } = await import('../src/ui/design/design');
    const doc = normaliseDesign({
      format: 'narrative-bridge-design',
      tokens: { '--paper': 'url(https://tracker.example/p.png) repeat', '--grain': 'url("data:image/png;base64,AAAA")', '--radius': '8px' },
      rules: { '.app': { background: 'url(//cdn.example/x.jpg)' } },
      css: '@import url("https://fonts.example/a.css");\n.x { background: url( https://e.example/y ) }',
    });
    const safe = withoutRemoteLoads(doc);
    expect(safe.tokens).toEqual({ '--paper': 'none repeat', '--grain': 'url("data:image/png;base64,AAAA")', '--radius': '8px' });
    expect(safe.rules['.app'].background).toBe('none');
    expect(safe.css).not.toMatch(/example/);
  });
});
