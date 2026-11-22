import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../src/core/export';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

// Pen to Ink was called Narrative Bridge. Two kinds of names came from that:
//  - compatibility names, which games, saves and projects depend on, stay: the NarrativeBridge C# namespace and C++
//    module, the com.narrativebridge.* package ids, the narrative-bridge.* storage keys, the .nbproj.json format;
//  - display names, which people read (menus, docs, plugin descriptions, comments), say Pen to Ink.
// None of the exported files should still say "Narrative Bridge" with a space, which is always display text.

describe('names', () => {
  it.each(['unity', 'unreal'] as const)('the %s export shows people Pen to Ink, never the old name', async (engine) => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const adapter = ADAPTERS[engine];
    const res = await adapter.export(processProject(project), { engine, projectName: 'Names', engineVersion: adapter.defaultEngineVersion, integrationRef: '2.0.0', includeDemo: true });
    const offenders = res.files.filter((f) => typeof f.content === 'string' && f.content.includes('Narrative Bridge')).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('the names that code depends on are still the old ones', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const res = await ADAPTERS.unity.export(processProject(project), { engine: 'unity', projectName: 'Names', engineVersion: ADAPTERS.unity.defaultEngineVersion, integrationRef: '2.0.0', includeDemo: false });
    const pkg = JSON.parse(res.files.find((f) => f.path.endsWith('/package.json'))!.content as string);
    expect(pkg.name).toMatch(/^com\.narrativebridge\./);
    expect(res.files.some((f) => typeof f.content === 'string' && f.content.includes('namespace NarrativeBridge'))).toBe(true);
  });
});
