import { describe, expect, it } from 'vitest';
import { buildStory } from '../src/core/builder';
import { validateSchema } from '../src/core/schema';
import { SAMPLES } from '../src/samples';
import { LINK_PREFIX, MAX_LINK_CHARS, readStoryLink, storyLink } from '../src/ui/storyLink';

const base = 'https://example.org/app/index.html';

describe('story links', () => {
  it('carry a sample story whole, in the part after # only', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode });
    const r = await storyLink(project, `${base}#old`);
    if ('error' in r) throw new Error(r.error);
    expect(r.url.startsWith(`${base}${LINK_PREFIX}`)).toBe(true);
    expect(r.url).toMatch(/^[^#]+#story=[A-Za-z0-9_-]+$/);
    expect(r.url.length).toBeLessThan(MAX_LINK_CHARS);
    const text = await readStoryLink(r.url.slice(r.url.indexOf('#')));
    const back = JSON.parse(text!).project;
    expect(back).toEqual(JSON.parse(JSON.stringify(project)));
    expect(validateSchema(back).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('refuse a story too long for a link, and ignore other # parts', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode });
    // Text that doesn't compress: a long run of pseudo-random words.
    let seed = 7;
    const noise = Array.from({ length: 40_000 }, () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed.toString(36))).join(' ');
    project.passages[0].content.push({ type: 'action', text: noise, origin: 'user_authored' });
    expect(await storyLink(project, base)).toMatchObject({ error: expect.stringMatching(/too long for a link/) });
    expect(await readStoryLink('#admin')).toBeNull();
    await expect(readStoryLink('#story=not-really')).rejects.toThrow();
  });
});
