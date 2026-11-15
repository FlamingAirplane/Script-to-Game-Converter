import { describe, expect, it } from 'vitest';
import { reviewAll } from '../src/core/adapt';
import { buildStory } from '../src/core/builder';
import { buildRenpy, conditionToPython, effectToPython, renpyText, renpyVar } from '../src/core/export/renpy';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';

const story = async (id: string) => {
  const s = SAMPLES.find((x) => x.id === id)!;
  const { project } = await buildStory([{ fileName: s.fileName, text: s.text }], { mode: s.mode });
  reviewAll(project, 'approved');
  return processProject(project);
};

/** Every label a script jumps to or calls, and every label it defines. */
function labels(rpy: string) {
  const defined = new Set([...rpy.matchAll(/^label (\w+)/gm)].map((m) => m[1]));
  const used = new Set([...rpy.matchAll(/\b(?:jump|call) (\w+)/g)].map((m) => m[1]));
  return { defined, used };
}

describe('Ren’Py export', () => {
  it('writes every sample as labels, characters, menus and jumps that all resolve', async () => {
    for (const s of SAMPLES) {
      const st = await story(s.id);
      const rpy = buildRenpy(st);
      const { defined, used } = labels(rpy);
      expect([...used].filter((l) => !defined.has(l)), s.id).toEqual([]);
      expect(defined.has('start')).toBe(true);
      for (const p of st.project.passages) expect(defined.has(`p_${p.id}`), `${s.id}: ${p.id}`).toBe(true);
      // Ren'Py is indentation-sensitive: only 4-space steps, never tabs.
      for (const line of rpy.split('\n')) expect(line.match(/^ */)![0].length % 4, line).toBe(0);
      expect(rpy).not.toMatch(/\t/);
      // Each passage's label block ends by going somewhere.
      for (const block of rpy.split(/\n(?=label p_)/).slice(1)) {
        const last = block.trim().split('\n').filter((l) => !l.trim().startsWith('#')).pop()!;
        expect(last, block.split('\n')[0]).toMatch(/^\s+(jump \w+|return)/);
      }
    }
  });

  it('carries items, conditions and effects for the Locked Archive', async () => {
    const st = await story('archive');
    const rpy = buildRenpy(st);
    const item = st.project.items[0];
    expect(rpy).toContain(`default has_${item.id} = False`);
    expect(rpy).toMatch(new RegExp(`" if has_${item.id}:`));
    expect(rpy).toMatch(new RegExp(`\\$ has_${item.id} = True`));
    for (const c of st.project.characters) expect(rpy).toContain(`define c_${c.id} = Character("`);
    expect(rpy).toMatch(/label start:\n {4}jump p_\w+/);
  });

  it('turns conditions and effects into Python', () => {
    expect(conditionToPython({ type: 'has_item', itemId: 'key' })).toBe('has_key');
    expect(conditionToPython({ type: 'not', condition: { type: 'has_item', itemId: 'key' } })).toBe('not has_key');
    expect(
      conditionToPython({
        type: 'or',
        conditions: [
          { type: 'and', conditions: [{ type: 'has_item', itemId: 'a' }, { type: 'compare', variableId: 'trust', op: '>=', value: 2 }] },
          { type: 'compare', variableId: 'mood', op: '==', value: 'calm' },
        ],
      }),
    ).toBe('(has_a and (trust >= 2)) or (mood == "calm")');
    expect(conditionToPython({ type: 'compare', variableId: 'flag', op: '==', value: true })).toBe('flag == True');
    expect(effectToPython({ type: 'add_var', variableId: 'trust', amount: -2 })).toBe('$ trust -= 2');
    expect(effectToPython({ type: 'set_var', variableId: 'config', value: 1 })).toBe('$ story_config = 1');
    expect(renpyVar('trust')).toBe('trust');
    expect(renpyVar('_secret')).toBe('story_secret');
  });

  it('escapes text so Ren’Py shows it as written', () => {
    expect(renpyText('She said "go" [now] {quietly} \\ ok')).toBe('She said \\"go\\" [[now] {{quietly} \\\\ ok');
    expect(renpyText('one\ntwo')).toBe('one\\ntwo');
  });

  it('plays cutscenes by themselves and hands exits and cues to the game', async () => {
    const { project } = await buildStory(
      [
        {
          fileName: 'x.fountain',
          text: '@passage a Arrival\n@cutscene\n\nMIRA\nWe made it.\n\n@passage b Gate\nThe gate.\n@exit wolf_fight The wolves attack\n@cue music calm\n-> END\n',
        },
      ],
      { mode: 'structured' },
    );
    project.passages[0].divert = 'b';
    project.passages[0].isEnding = false;
    const rpy = buildRenpy(processProject(project));
    expect(rpy).toMatch(/c_mira "We made it\.\{w=\d+\.\d\}\{nw\}"/);
    expect(rpy).toContain('call nb_exit("wolf_fight", "The wolves attack")');
    expect(rpy).toContain('$ nb_cue("music", "calm")');
  });
});
