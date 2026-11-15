import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStory, type SourceInput } from '../src/core/builder';
import { BINARY_EXTENSIONS, prepareInput } from '../src/core/parsing/convert';
import { PROPOSAL_KINDS } from '../src/core/proposals';
import { SAMPLES } from '../src/samples';

// The evaluation set (tests/adaptation-eval) is only a yardstick while its marks point at real lines. This fails
// when a script, the converter or a parser moves a scene and an annotation is left behind.

const dir = join(__dirname, 'adaptation-eval');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

async function load(script: string): Promise<SourceInput> {
  if (script.startsWith('src/samples.ts#')) {
    const s = SAMPLES.find((x) => x.id === script.split('#')[1])!;
    return { fileName: s.fileName, text: s.text };
  }
  const path = join(__dirname, '..', script);
  const binary = BINARY_EXTENSIONS.some((e) => path.toLowerCase().endsWith(e));
  return prepareInput(basename(path), binary ? new Uint8Array(readFileSync(path)) : readFileSync(path, 'utf8'));
}

describe('the adaptation evaluation set', () => {
  it('has the scripts the README says it has, five of them held out', () => {
    const all = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
    expect(all.length).toBe(22);
    expect(all.filter((a) => a.heldOut).length).toBe(5);
    const sources = JSON.parse(readFileSync(join(dir, 'plays/sources.json'), 'utf8')) as { id: string }[];
    expect(sources.map((s) => `tests/adaptation-eval/plays/${s.id}.fountain`).sort()).toEqual(all.map((a) => a.script).filter((s: string) => s.includes('/plays/')).sort());
  });

  it.each(files)('%s marks real lines in passages that can take a choice', async (file) => {
    const a = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const { project } = await buildStory([await load(a.script)], { mode: 'adaptation', heuristics: false });
    for (const m of a.moments) {
      const where = `${file} ${m.passage}:${m.line}`;
      expect(PROPOSAL_KINDS, where).toContain(m.kind);
      const p = project.passages.find((x) => x.id === m.passage || x.sourceId === m.passage);
      expect(p, where).toBeDefined();
      const lines = p!.content.filter((b) => b.type === 'action' || b.type === 'dialogue');
      expect(m.line, where).toBeGreaterThanOrEqual(1);
      expect(m.line, where).toBeLessThanOrEqual(lines.length);
      // A gate's evidence may sit in any passage; every other kind needs a passage with somewhere to go on to.
      if (m.kind !== 'gate') expect(!!p!.divert && !p!.isEnding, where).toBe(true);
    }
  });
});
