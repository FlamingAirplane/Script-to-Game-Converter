import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStory } from '../src/core/builder';
import { buildPlayableHtml } from '../src/core/export/playable';
import { processProject } from '../src/core/pipeline';
import { addReaderNotes, parseReaderNotes, READER_NOTE_PREFIX } from '../src/core/readerNotes';
import { SAMPLES } from '../src/samples';
import { LINK_PREFIX, PLAY_PREFIX, readStoryLink, storyLink } from '../src/ui/storyLink';

const archive = async () => {
  const s = SAMPLES.find((x) => x.id === 'archive')!;
  return (await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode })).project;
};
const runtime = readFileSync(new URL('../node_modules/inkjs/dist/ink.js', import.meta.url), 'utf8');
const meta = (html: string) => JSON.parse(/<script id="story-meta" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);

describe('sharing for feedback', () => {
  it('the playable story has a Note button only in a copy for feedback', async () => {
    const story = processProject(await archive());
    const plain = buildPlayableHtml(story, runtime);
    const fb = buildPlayableHtml(story, runtime, {}, {}, { feedback: true });
    expect(meta(plain)).toMatchObject({ feedback: false });
    expect(meta(fb)).toMatchObject({ feedback: true, notesKey: `narrative-bridge.notes.${story.project.project.id}`, notesFile: expect.stringMatching(/-reader-notes\.json$/) });
    // The button is in both pages, hidden until the script sees meta.feedback.
    expect(fb).toContain('<button id="note" class="link" hidden>');
    expect(fb).toContain('narrative-bridge-reader-notes');
  });

  it('brings notes back in after the line they were written on', async () => {
    const project = await archive();
    const entry = project.passages.find((p) => p.id === 'archive_entry')!;
    const line = entry.content.find((b) => b.type === 'dialogue')!;
    const quote = 'text' in line ? line.text : '';
    const file = JSON.stringify({
      format: 'narrative-bridge-reader-notes',
      version: 1,
      story: 'The Locked Archive',
      notes: [
        { quote, speaker: 'MIRA', note: 'I wanted to know why it is locked.' },
        { quote: `“${quote.toUpperCase()}”`, note: 'Second note on the same line.' },
        { quote: 'A line that was cut from the script.', note: 'This bit dragged.' },
        { quote: '', note: 'Loved the ending.' },
        { quote, note: '   ' },
      ],
    });
    const parsed = parseReaderNotes(file);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.notes).toHaveLength(4); // the empty note is dropped
    expect(addReaderNotes(project, parsed.notes)).toEqual({ placed: 2, unplaced: 2, duplicates: 0 });
    const at = entry.content.indexOf(line);
    expect(entry.content.slice(at + 1, at + 3).map((b) => ('text' in b ? b.text : b.type))).toEqual([
      `${READER_NOTE_PREFIX}I wanted to know why it is locked.`,
      `${READER_NOTE_PREFIX}Second note on the same line.`,
    ]);
    const start = project.passages.find((p) => p.id === project.project.startPassage)!;
    expect(start.content.filter((b) => b.type === 'note').map((b) => ('text' in b ? b.text : ''))).toEqual(
      expect.arrayContaining([`${READER_NOTE_PREFIX}This bit dragged. (on “A line that was cut from the script.”, which the script no longer has)`, `${READER_NOTE_PREFIX}Loved the ending.`]),
    );
    // Bringing the same file in again adds nothing, and notes stay out of play.
    expect(addReaderNotes(project, parsed.notes)).toEqual({ placed: 0, unplaced: 0, duplicates: 4 });
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toContain('// Reader note: I wanted to know why it is locked.');
  });

  it('refuses files that are not reader notes', () => {
    expect(parseReaderNotes('not json')).toEqual({ error: expect.stringMatching(/isn’t JSON/) });
    expect(parseReaderNotes('{"format":"narrative-bridge-project"}')).toEqual({ error: 'That file isn’t a reader notes file.' });
  });

  it('a play link carries the story after #play=, and a story link is not a play link', async () => {
    const project = await archive();
    const r = await storyLink(project, 'https://example.org/app/', PLAY_PREFIX);
    if ('error' in r) throw new Error(r.error);
    const hash = r.url.slice(r.url.indexOf('#'));
    expect(hash.startsWith(PLAY_PREFIX)).toBe(true);
    expect(JSON.parse((await readStoryLink(hash, PLAY_PREFIX))!).project.project.title).toBe(project.project.title);
    expect(await readStoryLink(hash, LINK_PREFIX)).toBeNull();
  });
});

describe('the playable story as a small web game', () => {
  it('knows each ending by the last line read in it', async () => {
    const { endingKey, endingLines } = await import('../src/core/export/playable');
    const story = processProject(await archive());
    const e = endingLines(story);
    expect(e.total).toBe(2);
    expect(Object.values(e.byLine).sort()).toEqual(['archive_inside', 'outside']);
    expect(e.byLine[endingKey('You step back into the rain. Some doors are better left closed.')]).toBe('outside');
    expect(endingKey('“Every <i>story</i> we ever lost.”')).toBe('every story we ever lost');
    expect(endingKey('Où est-il ?')).toBe('où est il');
  });

  it('ships the tally, the text size control and a working ending key in the page', async () => {
    const story = processProject(await archive());
    const html = buildPlayableHtml(story, runtime);
    expect(meta(html).endings.total).toBe(2);
    expect(html).toContain('id="larger"');
    // The page runs the very code the export uses (readerCore.ts), not its own copy of endingKey.
    const { READER_CORE_JS } = await import('../src/core/readerCore.generated');
    expect(html).toContain(READER_CORE_JS);
    expect(html).not.toMatch(/function endingKey\(text\) \{ [^\n]*replace/);
  });
});
