import { describe, expect, it } from 'vitest';
import { interfaceWords } from '../src/core/export/translations';
import { VIEW_CS, WIDGET_H } from '../src/core/export/templates.generated';
import { panelThemeOf } from '../src/core/export/unityTheme';
import { ADAPTERS } from '../src/core/export';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

// The story panel's own words are in the Unity panel, the Unreal panel and the translation sheet. One list is kept for
// the sheet; these tests keep the panels and the list from drifting apart.

const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

describe('panel words', () => {
  const panelWords = new Set([
    ...[...between(VIEW_CS, 'public class SettingsWords', '[Tooltip').matchAll(/= "([^"]+)"/g)].map((m) => m[1]),
    ...[...between(WIDGET_H, 'struct FNarrativePanelWords', '};').matchAll(/TEXT\("([^"]+)"\)/g)].map((m) => m[1]),
  ]);
  const listed = new Set(interfaceWords());

  it('every word either panel shows is in the translation sheet', () => {
    expect(panelWords.size).toBeGreaterThan(20);
    expect([...panelWords].filter((w) => !listed.has(w))).toEqual([]);
  });

  it('every word the sheet lists for the panel is shown by one of the panels', () => {
    expect([...listed].filter((w) => !panelWords.has(w))).toEqual([]);
  });
});

describe('the story panel look is saved as presentation.panel', () => {
  it('reads the old presentation.unity from projects saved before the rename, and prefers panel', () => {
    expect(panelThemeOf({})).toBeUndefined();
    expect(panelThemeOf({ presentation: { unity: { preset: 'night' } as never } })?.preset).toBe('night');
    expect(panelThemeOf({ presentation: { unity: { preset: 'night' } as never, panel: { preset: 'minimal' } as never } })?.preset).toBe('minimal');
  });

  it('both engines and the sheet use a saved look under either key', async () => {
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const night = { preset: 'night' } as never;
    const exportTheme = async (presentation: object) => {
      const { project } = await build(s.text, s.fileName, 'structured');
      project.presentation = presentation as never;
      const res = await ADAPTERS.unity.export(processProject(project), { engine: 'unity', projectName: 'Panel', engineVersion: ADAPTERS.unity.defaultEngineVersion, integrationRef: '2.0.0', includeDemo: false });
      return res.files.find((f) => f.path.endsWith('/Theme.json'))!.content as string;
    };
    expect(await exportTheme({ unity: night })).toBe(await exportTheme({ panel: night }));
    expect(await exportTheme({ panel: night })).not.toBe(await exportTheme({}));
  });
});
