import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyzer';
import { buildStory } from '../src/core/builder';
import { ADAPTERS } from '../src/core/export';
import { generateInk } from '../src/core/inkgen';
import { type StoryProject } from '../src/core/isr';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

describe('review tools', () => {
  it('finds and replaces across titles, text, parentheticals and choices', async () => {
    const { findText, replaceText } = await import('../src/ui/projectOps');
    const s = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await build(s.text, s.fileName, 'structured');
    const hits = findText(project, 'archive');
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.some((h) => h.where === 'choice')).toBe(true);
    expect(findText(project, 'ARCHIVE', true)).toHaveLength(0);
    const n = replaceText(project, 'archive', 'library');
    expect(n).toBe(hits.length);
    expect(findText(project, 'archive')).toHaveLength(0);
    expect(project.passages.find((p) => p.id === 'archive_entry')!.choices[0]).toMatchObject({ text: 'Open the library', origin: 'user_authored' });
    expect(processProject(project).compile.ok).toBe(true); // ids are untouched
  });

  it('merges a duplicate character into another', async () => {
    const { mergeCharacter } = await import('../src/ui/projectOps');
    const { project } = await build('INT. A - DAY\n\nMIRA\nHi.\n\nMIRA (V.O.)\nStill me.\n\nMIRA K.\nAnd me.\n', 'x.fountain');
    const k = project.characters.find((c) => c.displayName === 'MIRA K.')!;
    const mira = project.characters.find((c) => c.displayName === 'MIRA')!;
    expect(mergeCharacter(project, k.id, mira.id)).toBe(1);
    expect(project.characters.map((c) => c.displayName)).toEqual(['MIRA']);
    expect(mira.aliases).toContain('MIRA K.');
    expect(project.passages[0].content.filter((b) => b.type === 'dialogue').every((b) => b.type === 'dialogue' && b.speakerId === mira.id)).toBe(true);
  });

  it('reorders passages without changing the story flow', async () => {
    const { movePassage } = await import('../src/ui/projectOps');
    const s = SAMPLES.find((x) => x.id === 'motel')!;
    const { project } = await build(s.text, s.fileName);
    const before = processProject(project).smoke!.endingsReached;
    expect(movePassage(project, 'parking_lot', -1)).toBe(true);
    expect(project.passages.map((p) => p.id)).toEqual(['roadside_motel', 'parking_lot', 'motel_office']);
    expect(movePassage(project, 'roadside_motel', -1)).toBe(false);
    expect(processProject(project).smoke!.endingsReached).toEqual(before);
  });
});

describe('Continue breaks', () => {
  const src = `@item key "Key"\n@passage hall Hall\nThe hall is dark.\n@pause\nA light flickers.\n@give key\n@pause\nMIRA: Who's there?\n* {has key} [Unlock] -> room\n+ [Wait] -> hall\n@passage room Room\nInside.\n@pause\nThe end comes quietly.\n@end\n`;
  const kinds = (p: StoryProject) => p.passages.map((x) => x.content.map((b) => b.type).join(','));

  it('@pause becomes a break that every Ink player shows as Continue, and plays through', async () => {
    const { project } = await build(src, 's.md', 'structured');
    expect(kinds(project)).toEqual(['action,pause,action,effect,pause,dialogue', 'action,pause,action']);
    const story = processProject(project);
    expect(story.generated.ink).toContain('The hall is dark.\n+ [Continue]\n-\nA light flickers.');
    expect(story.compile.ok).toBe(true);
    expect(story.smoke?.endingsReached).toMatchObject({ room: expect.any(Number) });
    // A linear story with breaks is still one playthrough.
    const linear = processProject((await build('@passage a A\nOne.\n@pause\nTwo.\n@end\n', 'l.md', 'structured')).project);
    expect([linear.smoke?.stopReason, linear.smoke?.runs]).toEqual(['deterministic', 1]);
  });

  it('round-trips through Ink exactly, and only the exact form counts as a break', async () => {
    const { inkUnsupported } = await import('../src/core/parsing/ink');
    const { project } = await build(src, 's.md', 'structured');
    const ink = generateInk(project).ink;
    expect(inkUnsupported(ink)).toEqual([]);
    const back = (await build(ink, 's.ink', 'structured')).project;
    expect(back.inkPassthrough).toBeUndefined();
    back.project.mode = project.project.mode;
    const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
    expect(strip(generateInk(back).ink)).toBe(strip(ink));
    // Hand-written Ink: a Continue inside an open set of choices is a choice, followed by a real gather.
    expect(inkUnsupported('=== a ===\nHi\n* [A] -> a\n+ [Continue]\n-\nAfter\n-> END\n').map((f) => f.feature)).toEqual(['gathers (-)']);
    expect(kinds((await build('=== a ===\nHi\n+ [Continue]\n-\nAfter\n-> END\n', 'h.ink', 'structured')).project)).toEqual(['action,pause,action']);
  });

  it('round-trips through both Twine kinds as "Name (continued)" parts', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { project } = await build(src, 's.md', 'structured');
    const shape = (p: StoryProject) => p.passages.map((x) => [x.title, x.isEnding, x.content.filter((b) => b.type !== 'effect').map((b) => (b.type === 'pause' ? '⏸' : 'text' in b ? b.text : '')), x.choices.map((c) => c.text)]);
    for (const kind of ['sugarcube', 'plain'] as const) {
      const twee = buildTwee(processProject(project), kind);
      expect(twee).toContain(':: Hall (continued 2)');
      expect(twee).toContain('[[Continue->Hall (continued)]]');
      const back = await build(twee, 's.twee', 'structured');
      expect(shape(back.project), kind).toEqual(shape(project));
      expect(back.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    }
  });

  it('notes a break with nothing to show on one side', async () => {
    const { project } = await build('@passage a A\n@pause\nOne.\n@pause\n@pause\nTwo.\n@pause\n@end\n', 'm.md', 'structured');
    const notes = analyze(project).diagnostics.filter((d) => d.code === 'PAUSE_WITHOUT_TEXT');
    expect(notes).toHaveLength(3); // first, the second of a pair, and last
    const ok = await build('@passage a A\nOne.\n@pause\nTwo.\n@end\n', 'ok.md', 'structured');
    expect(analyze(ok.project).diagnostics.filter((d) => d.code === 'PAUSE_WITHOUT_TEXT')).toEqual([]);
  });

  it('adds and removes breaks from the Graph panel without disturbing the lines', async () => {
    const { addBreak, countBreaks, removeBreak } = await import('../src/ui/projectOps');
    const { project } = await build('@passage a A\nOne.\n\nTwo.\n\nThree.\n@end\n', 'g.md', 'structured');
    addBreak(project, 'a', 1);
    addBreak(project, 'a', 3);
    expect(kinds(project)).toEqual(['action,pause,action,pause,action']);
    expect(project.passages[0].content[1]).toMatchObject({ type: 'pause', origin: 'user_authored' });
    expect(countBreaks(project.passages[0])).toBe(2);
    removeBreak(project, 'a', 1);
    expect(kinds(project)).toEqual(['action,action,pause,action']);
    expect(processProject(project).generated.ink).toContain('Two.\n+ [Continue]\n-\nThree.');
  });
});

describe('gated choices', () => {
  it('lists the choices a reader cannot take yet, with what they need in plain words', async () => {
    const { conditionHolds, describeCondition, lockedChoices } = await import('../src/core/gating');
    const { project } = await build(
      '@item key "Brass Key"\n@item lamp "Lamp"\n@var trust = 0\n@passage a A\nHall.\n+ {has key} [Unlock] -> a\n+ {trust >= 2 and not has lamp} [Trust her] -> a\n+ [Wait] -> a\n',
      'g.md',
      'structured',
    );
    const vars: Record<string, unknown> = { has_key: false, has_lamp: false, trust: 0 };
    const read = (n: string) => vars[n];
    const locked = lockedChoices(project, 'a', read, ['Wait']);
    expect(locked.map((l) => [l.choice.text, l.needs])).toEqual([
      ['Unlock', ['Brass Key']],
      ['Trust her', ['trust at least 2 and no Lamp']],
    ]);
    vars.has_key = true;
    vars.trust = 3;
    expect(lockedChoices(project, 'a', read, ['Wait', 'Unlock']).map((l) => l.choice.text)).toEqual([]);
    // A choice already on offer is never listed twice, even if the condition reads as false.
    vars.has_key = false;
    expect(lockedChoices(project, 'a', read, ['Unlock']).map((l) => l.choice.text)).toEqual([]);
    expect(conditionHolds({ type: 'or', conditions: [{ type: 'has_item', itemId: 'lamp' }, { type: 'compare', variableId: 'trust', op: '!=', value: 3 }] }, read)).toBe(false);
    expect(describeCondition({ type: 'not', condition: { type: 'compare', variableId: 'trust', op: '<', value: 1 } }, project)).toBe('not trust below 1');
  });
});

describe('exits to the game', () => {
  const src = '@passage camp Camp\nWolves circle the fire.\n@exit wolf_fight The player fights the wolves\nThe last wolf runs.\n+ [Rest] -> dawn\n@passage dawn Dawn\nMorning.\n@end\n';
  it('stops the dialogue at an exit, in Ink and back again', async () => {
    const { exitOf, EXIT_PREFIX } = await import('../src/core/isr');
    const { project } = await build(src, 'x.md', 'structured');
    expect(project.passages[0].content.find((b) => b.type === 'exit')).toMatchObject({ type: 'exit', name: 'wolf_fight', note: 'The player fights the wolves' });
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toContain('+ [Back to the game: wolf_fight] // The player fights the wolves\n-');
    expect(exitOf(`${EXIT_PREFIX}wolf_fight`)).toBe('wolf_fight');
    expect(exitOf('Rest')).toBeNull();
    // The game sees the exit as the only choice, and taking it goes on with the scene.
    const { Story } = await import('inkjs');
    const s = new Story(story.compile.json!);
    expect(s.ContinueMaximally()).toContain('Wolves circle the fire.');
    expect(s.currentChoices.map((c) => c.text)).toEqual(['Back to the game: wolf_fight']);
    s.ChooseChoiceIndex(0);
    expect(s.ContinueMaximally()).toContain('The last wolf runs.');
    // Ink that Pen to Ink wrote comes back with its exit.
    const again = await build(story.generated.ink, 'x.ink', 'faithful');
    expect(again.project.passages.find((p) => p.id === 'camp')!.content.find((b) => b.type === 'exit')).toMatchObject({ name: 'wolf_fight', note: 'The player fights the wolves' });
  });

  it('lists the exits for the game, and plays through them elsewhere', async () => {
    const { project } = await build(src, 'x.md', 'structured');
    const story = processProject(project);
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Wolves', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true });
    const text = (end: string) => String(r.files.find((f) => f.path.endsWith(end))!.content);
    expect(text('StoryInfo.cs')).toContain('public static readonly string[] Exits = { "wolf_fight" };');
    expect(text('NarrativeController.cs')).toContain('public void ResumeAt(string passage)');
    expect(text('Samples~/Hooking into your game/StoryExits.cs')).toContain('story.ExitReached += Reached;');
    // Generated C# without "using System;" must name System's types in full.
    for (const f of r.files.filter((x) => x.path.endsWith('.cs'))) {
      const c = String(f.content);
      if (!c.includes('using System;')) expect(c, f.path).not.toMatch(/[^.\w](Array|StringComparison|Exception)\./);
      expect(c, f.path).not.toContain('""storyVersion');
    }
    const { buildPlayableHtml, buildTwee } = await import('../src/core/export');
    expect(buildPlayableHtml(story, '/* runtime */')).toContain("Resume the story");
    // Twine has no game: the exit is a Continue link, with a note.
    const twee = buildTwee(story, 'sugarcube');
    expect(twee).toContain('Back to the game: wolf_fight');
    expect(twee).toMatch(/:: Camp \(continued\)/);
  });
});

describe('new scenes from the Graph', () => {
  const script = 'INT. HALL - NIGHT\n\nThe hall is dark.\n\nINT. ROOM - NIGHT\n\nA lamp burns.\n\nINT. ATTIC - NIGHT\n\nDust everywhere.\n';
  const load = async () => (await build(script)).project;

  it('puts a scene straight after a passage, between it and where it went', async () => {
    const { addScene } = await import('../src/ui/projectOps');
    const p = await load();
    expect(p.passages.map((x) => [x.id, x.divert])).toEqual([['hall', 'room'], ['room', 'attic'], ['attic', undefined]]);
    const s = addScene(p, { title: 'The Stairs', heading: 'INT. STAIRS - NIGHT', firstLine: 'The steps creak.', from: 'hall', link: 'continue' });
    if (typeof s === 'string') throw new Error(s);
    expect(s).toMatchObject({ id: 'the_stairs', sceneHeading: 'INT. STAIRS - NIGHT', divert: 'room', isEnding: false, origin: 'user_authored' });
    expect(s.content).toEqual([{ type: 'action', text: 'The steps creak.', origin: 'user_authored' }]);
    expect(p.passages.map((x) => x.id)).toEqual(['hall', 'the_stairs', 'room', 'attic']);
    expect(p.passages[0].divert).toBe('the_stairs');
    const story = processProject(p);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toMatch(/=== the_stairs ===[\s\S]*The steps creak\. #scene:INT\. STAIRS - NIGHT\n-> room/);
    // After the last passage, the new scene becomes the ending.
    const end = addScene(p, { title: 'Roof', from: 'attic', link: 'continue' });
    expect(end).toMatchObject({ isEnding: true });
    expect(p.passages.find((x) => x.id === 'attic')).toMatchObject({ divert: 'roof', isEnding: false });
  });

  it('adds a scene as a new choice, keeping the way the passage already went', async () => {
    const { addScene } = await import('../src/ui/projectOps');
    const p = await load();
    const s = addScene(p, { title: 'Cellar', from: 'hall', link: 'choice', choiceText: 'Go down to the cellar', keepPathText: 'Go into the room', then: 'attic' });
    if (typeof s === 'string') throw new Error(s);
    const hall = p.passages[0];
    expect(hall.divert).toBeUndefined();
    expect(hall.choices.map((c) => [c.text, c.target])).toEqual([['Go into the room', 'room'], ['Go down to the cellar', 'cellar']]);
    expect(s.divert).toBe('attic');
    const story = processProject(p);
    expect(story.compile.ok).toBe(true);
    expect(story.analysis.graph.nodes.find((n) => n.id === 'cellar')?.reachable).toBe(true);
    // A passage that already has choices just gets one more.
    addScene(p, { title: 'Garden', from: 'hall', link: 'choice' });
    expect(hall.choices.map((c) => c.text)).toEqual(['Go into the room', 'Go down to the cellar', 'Garden']);
  });

  it('adds a scene on its own at a place on the map, and explains what it can’t do', async () => {
    const { addScene } = await import('../src/ui/projectOps');
    const p = await load();
    const s = addScene(p, { title: 'Dream', link: 'none', at: { x: 400.4, y: 90.6 } });
    expect(s).toMatchObject({ id: 'dream', isEnding: true });
    expect(p.layout?.dream).toEqual({ x: 400, y: 91 });
    expect(processProject(p).analysis.graph.nodes.find((n) => n.id === 'dream')?.reachable).toBe(false);
    expect(addScene(p, { title: ' ', link: 'none' })).toBe('Give the scene a title.');
    expect(addScene(p, { title: 'X', link: 'continue' })).toBe('Choose the passage it comes after.');
    addScene(p, { title: 'Y', from: 'room', link: 'choice' });
    expect(addScene(p, { title: 'Z', from: 'room', link: 'continue' })).toMatch(/ends with choices/);
    // Titles that are already used get their own id.
    expect(addScene(p, { title: 'Dream', link: 'none' })).toMatchObject({ id: 'dream_2' });
  });
});

describe('new scenes elsewhere in the app', () => {
  const script = 'INT. HALL - NIGHT\n\nThe hall is dark.\n\nINT. ROOM - NIGHT\n\nA lamp burns.\n';

  it('creates a passage a choice already leads to, under that name', async () => {
    const { addScene, addChoice } = await import('../src/ui/projectOps');
    const { sceneFix } = await import('../src/ui/NewScene');
    const { project: p } = await build(script);
    const c = addChoice(p, 'hall')!;
    c.target = 'boat_house';
    const before = processProject(p);
    const missing = before.diagnostics.find((d) => d.code === 'INK_TARGET_MISSING')!;
    const fix = sceneFix(missing.code, missing.details, missing.entityId, p)!;
    expect(fix.label).toBe('Create “Boat House”');
    expect(fix.request).toMatchObject({ id: 'boat_house', title: 'Boat House' });
    const s = addScene(p, { ...fix.request, title: fix.request.title!, link: 'none' });
    expect(s).toMatchObject({ id: 'boat_house', isEnding: true });
    const after = processProject(p);
    expect(after.diagnostics.some((d) => d.code === 'INK_TARGET_MISSING')).toBe(false);
    expect(after.compile.ok).toBe(true);
    // A name that's taken or not a passage name is explained.
    expect(addScene(p, { title: 'X', id: 'room', link: 'none' })).toMatch(/already a passage called “room”/);
    expect(addScene(p, { title: 'X', id: 'END', link: 'none' })).toMatch(/can’t be a passage name/);
  });

  it('points an existing choice, or a passage’s "then", at a new scene', async () => {
    const { addScene, addChoice } = await import('../src/ui/projectOps');
    const { project: p } = await build(script);
    const c = addChoice(p, 'hall')!;
    const s = addScene(p, { title: 'Cellar', link: 'none', retarget: { passageId: 'hall', choiceId: c.id } });
    if (typeof s === 'string') throw new Error(s);
    expect(p.passages[0].choices[0].target).toBe('cellar');
    expect(p.passages.map((x) => x.id)).toEqual(['hall', 'cellar', 'room']);
    const t = addScene(p, { title: 'Porch', link: 'none', retarget: { passageId: 'room' }, then: 'END' });
    expect(t).toMatchObject({ isEnding: true });
    expect(p.passages.find((x) => x.id === 'room')).toMatchObject({ divert: 'porch', isEnding: false });
    expect(processProject(p).compile.ok).toBe(true);
    expect(addScene(p, { title: 'Gone', link: 'none', retarget: { passageId: 'hall', choiceId: 'nope' } })).toBe('The choice it was for no longer exists.');
  });

  it('offers a scene after a passage where the reader gets stuck', async () => {
    const { sceneFix } = await import('../src/ui/NewScene');
    const { project: p } = await build(script);
    p.passages[1].isEnding = false;
    const stuck = processProject(p).diagnostics.find((d) => d.code === 'NO_AVAILABLE_CHOICES')!;
    expect(sceneFix(stuck.code, stuck.details, stuck.entityId, p)).toEqual({ label: 'Add a scene after it', request: { from: 'room', link: 'continue' } });
    expect(sceneFix('EMPTY_PASSAGE', undefined, 'room', p)).toBeNull();
  });
});

describe('forced choices', () => {
  const story = `@item brass_key "Brass Key"
@start cottage

@passage cottage Cottage

A key glints on the mantel.

* [Take the key] -> hall @give brass_key
* [Leave it] -> hall

@passage hall Hall

A locked door, and a staircase.

+ {has brass_key} [Open the door with the key] -> vault @forced
+ [Climb the stairs] -> attic
+ [Wait] -> attic

@passage vault Vault

Inside.

@end

@passage attic Attic

Dust.

@end
`;

  it('makes the forced choice the only one once its condition holds', async () => {
    const { Story } = await import('inkjs');
    const { project } = await build(story, 'story.md', 'structured');
    expect(project.passages.find((p) => p.id === 'hall')!.choices.map((c) => !!c.forced)).toEqual([true, false, false]);
    const s = processProject(project);
    expect(s.compile.ok).toBe(true);
    expect(s.generated.ink).toContain('+ {has_brass_key} [Open the door with the key] // forced');
    expect(s.generated.ink).toContain('+ {not has_brass_key} [Climb the stairs]');
    const play = (pick: number) => {
      const st = new Story(s.compile.json!);
      st.ContinueMaximally();
      st.ChooseChoiceIndex(pick);
      st.ContinueMaximally();
      return st.currentChoices.map((c) => c.text);
    };
    expect(play(0)).toEqual(['Open the door with the key']); // took the key: forced
    expect(play(1)).toEqual(['Climb the stairs', 'Wait']); // left it
  });

  it('comes back from Ink unchanged, keeps other choices’ own conditions, and the first forced choice wins', async () => {
    const { generateInk } = await import('../src/core/inkgen');
    const { choiceGuards } = await import('../src/core/forced');
    const { project } = await build(story, 'story.md', 'structured');
    const hall = project.passages.find((p) => p.id === 'hall')!;
    // A second forced choice, and an ordinary choice with a condition of its own.
    hall.choices.push({ ...hall.choices[1], id: 'hall_rest', text: 'Rest', forced: true, conditions: [{ type: 'compare', variableId: 'tired', op: '==', value: true }] });
    project.variables.push({ id: 'tired', initial: false, origin: 'source' } as never);
    hall.choices[2].conditions = [{ type: 'not', condition: { type: 'has_item', itemId: 'lamp' } }];
    project.items.push({ id: 'lamp', displayName: 'Lamp', consumable: false, origin: 'source' });
    const guards = choiceGuards(hall);
    expect(guards.get(hall.choices[0].id)).toEqual([]); // first forced: nothing over it
    expect(guards.get('hall_rest')!.length).toBe(1); // the second gives way to the first
    expect(guards.get(hall.choices[1].id)!.length).toBe(2);
    const ink = generateInk(project).ink;
    expect(processProject(project).compile.ok).toBe(true);
    const back = (await build(ink, 'story.ink', 'structured')).project;
    const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
    expect(strip(generateInk(back).ink)).toBe(strip(ink));
    expect(back.passages.find((p) => p.id === 'hall')!.choices.map((c) => [c.text, !!c.forced, c.conditions.length])).toEqual([
      ['Open the door with the key', true, 1],
      ['Climb the stairs', false, 0],
      ['Wait', false, 1],
      ['Rest', true, 1],
    ]);
  });

  it('shows nothing as locked while a forced choice is on offer, and warns when one has no condition', async () => {
    const { lockedChoices } = await import('../src/core/gating');
    const { project } = await build(story, 'story.md', 'structured');
    const hall = project.passages.find((p) => p.id === 'hall')!;
    hall.choices[2].conditions = [{ type: 'has_item', itemId: 'brass_key' }, { type: 'compare', variableId: 'x', op: '>', value: 1 }];
    const read = (n: string) => (n === 'has_brass_key' ? true : 0);
    expect(lockedChoices(project, 'hall', read, ['Open the door with the key'])).toEqual([]);
    expect(lockedChoices(project, 'hall', read, ['Climb the stairs']).map((l) => l.choice.text)).toEqual(['Wait']);
    hall.choices[0].conditions = [];
    expect(processProject(project).diagnostics.some((d) => d.code === 'FORCED_WITHOUT_CONDITION')).toBe(true);
    expect(processProject(project).analysis.graph.edges.find((e) => e.id === hall.choices[0].id)?.forced).toBeUndefined();
  });

  it('carries forced choices into the playable page, Twine, Unity and Unreal', async () => {
    const { buildTwee, buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build(story, 'story.md', 'structured');
    const s = processProject(project);
    expect(buildTwee(s, 'sugarcube')).toMatch(/<<if not \$has_brass_key>>\[\[Climb the stairs/);
    expect(buildPlayableHtml(s, '/* runtime */')).toContain('"f":1');
    const opts = { engineVersion: '6000.3', integrationRef: 'v1.21.0', includeDemo: true };
    const unity = await ADAPTERS.unity.export(s, { engine: 'unity', projectName: 'P', ...opts });
    expect(unity.files.find((f) => f.path.endsWith('StoryInfo.cs'))!.content).toContain('ForcedChoices = { "hall\\nOpen the door with the key" }');
    const unreal = await ADAPTERS.unreal.export(s, { engine: 'unreal', projectName: 'P', ...opts, engineVersion: '5.7' });
    const gated = JSON.parse(String(unreal.files.find((f) => f.path.endsWith('StorySource/StoryInfo.json'))!.content)).gatedChoices;
    expect(gated).toEqual([expect.objectContaining({ passage: 'hall', text: 'Open the door with the key', needs: 'Brass Key', forced: true })]);
  });
});

describe('players see only the dialogue', () => {
  const script = `INT. LIGHTHOUSE - NIGHT

Rain lashes the glass.

MARA
(whispering)
Did you hear that?

TOM
Only the wind.

CUT TO:
`;
  const lines = async (project: StoryProject) => {
    const { Story } = await import('inkjs');
    const s = processProject(project);
    expect(s.compile.ok).toBe(true);
    const st = new Story(s.compile.json!);
    return { text: st.ContinueMaximally(), tags: st.currentTags ?? [], ink: s.generated.ink, s };
  };

  it('leaves narration, transitions, scene headings and parentheticals out of what players get', async () => {
    const { project } = await build(script);
    const before = await lines(project);
    expect(before.text).toContain('Rain lashes the glass.');
    expect(before.ink).toContain('#scene:INT. LIGHTHOUSE - NIGHT');
    expect(before.ink).toContain('#paren:whispering');

    project.presentation = { dialogueOnly: true };
    const after = await lines(project);
    expect(after.text.trim().split('\n')).toEqual(['MARA: Did you hear that?', 'TOM: Only the wind.']);
    expect(after.ink).not.toMatch(/#scene:|#paren:|#transition/);
    // The developer can still read what was left out.
    expect(after.ink).toContain('// Players don’t see this: Rain lashes the glass.');
    expect(after.ink).toContain('// Players don’t see this: INT. LIGHTHOUSE - NIGHT');
    // The story itself is unchanged: turning it off brings everything back.
    expect(project.passages[0].content.some((b) => b.type === 'action')).toBe(true);
  });

  it('applies to Twine and the translation sheet, and drops a Continue with nothing before it', async () => {
    const { buildTwee } = await import('../src/core/export');
    const { translationEntries } = await import('../src/core/export/translations');
    const { forPlayers } = await import('../src/core/players');
    const { project } = await build(script);
    project.presentation = { dialogueOnly: true };
    const twee = buildTwee(processProject(project), 'sugarcube');
    const story = twee.slice(twee.indexOf(':: Lighthouse'));
    const shown = story.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^::.*$/m, '');
    expect(shown).toContain('Did you hear that?');
    expect(shown).not.toMatch(/Rain lashes|LIGHTHOUSE|CUT TO|whispering/);
    expect(story).toContain('Players don’t see this: Rain lashes the glass.');
    expect(translationEntries(project).map((e) => e.source)).not.toContain('Rain lashes the glass.');
    const p = project.passages[0];
    p.content = [{ type: 'action', text: 'Silence.', origin: 'source' }, { type: 'pause', origin: 'source' }, ...p.content, { type: 'pause', origin: 'source' }];
    const kinds = forPlayers(project).passages[0].content.map((b) => b.type).filter((t) => t !== 'note');
    expect(kinds[0]).toBe('dialogue'); // the first Continue had nothing before it
    expect(kinds.at(-1)).toBe('pause'); // the last follows dialogue, so it stays
  });
});

describe('starting at a line of dialogue', () => {
  const src = `@item flowers "Flowers"\n@passage garden Garden\nMARA: Do you like flowers?\n@pause\nMARA: Could you bring me some?\n@exit get_flowers The player goes to pick flowers\nMARA: You found them!\n@take flowers\nMARA: You found them!\n+ [Goodbye] -> END\n`;

  it('labels every dialogue line in Ink and adds an entry knot a game can start at', async () => {
    const { lineEntries } = await import('../src/core/lines');
    const { project } = await build(src, 'g.md', 'structured');
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    const lines = lineEntries(project);
    // The label comes from the speaker and the words; the same line twice gets a number.
    expect(lines.map((l) => l.path)).toEqual(['garden.line_mara_do_you_like_flowers', 'garden.line_mara_could_you_bring_me_some', 'garden.line_mara_you_found_them', 'garden.line_mara_you_found_them_2']);
    expect(lines[2].display).toBe('MARA: You found them!');
    expect(story.generated.ink).toContain('- (line_mara_could_you_bring_me_some) MARA: Could you bring me some? #speaker:mara');
    expect(story.generated.ink).toContain('=== garden__line_mara_you_found_them ===\n-> garden.line_mara_you_found_them');
    // Choosing the entry knot starts at that line: after the Continue break and the exit, with the story's variables.
    const { Story } = await import('inkjs');
    const s = new Story(story.compile.json!);
    s.variablesState['has_flowers'] = true;
    s.ChoosePathString(lines[2].entryKnot);
    expect(s.Continue()).toBe('MARA: You found them!\n');
    expect(s.ContinueMaximally()).toContain('MARA: You found them!');
    expect(s.variablesState['has_flowers']).toBe(false);
    expect(s.currentChoices.map((c) => c.text)).toEqual(['Goodbye']);
    // From the start, the labels change nothing.
    const t = new Story(story.compile.json!);
    expect(t.ContinueMaximally()).toBe('MARA: Do you like flowers?\n');
  });

  it('brings the labelled Ink back unchanged, and has no lines for Ink kept as written', async () => {
    const { lineEntries } = await import('../src/core/lines');
    const { project } = await build(src, 'g.md', 'structured');
    const ink = generateInk(project).ink;
    const back = (await build(ink, 'g.ink', 'structured')).project;
    expect(back.passages.map((p) => p.id)).toEqual(['garden']);
    expect(back.passages[0].content.filter((b) => b.type === 'dialogue')).toHaveLength(4);
    const strip = (x: string) => x.replace(/ \(source line \d+\)/g, '');
    expect(strip(generateInk(back).ink)).toBe(strip(ink));
    const kept = await buildStory([{ fileName: 's.ink', text: '-> a\n=== a ===\nMIRA: Hi {name}.\n-> END\n', inkMode: 'keep' }], { mode: 'structured' });
    expect(lineEntries(kept.project)).toEqual([]);
  });

  it('gives Unity and Unreal the lines and an Enter Dialogue Trigger', async () => {
    const { project } = await build(src, 'g.md', 'structured');
    const story = processProject(project);
    const unity = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Garden', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: false });
    const u = (end: string) => String(unity.files.find((f) => f.path.endsWith(end))!.content);
    expect(u('StoryInfo.cs')).toContain('public static readonly string[] Passages = { "garden" };');
    expect(u('StoryInfo.cs')).toContain('"garden.line_mara_you_found_them_2"');
    expect(u('StoryInfo.cs')).toContain('"MARA: You found them!"');
    expect(u('NarrativeController.cs')).toContain('public void EnterAt(string name)');
    expect(u('NarrativeEnterDialogueTrigger.cs')).toContain('[StoryLine("passage")');
    expect(u('StoryPointDrawers.cs')).toContain('[CustomPropertyDrawer(typeof(StoryLineAttribute))]');
    const unreal = await ADAPTERS.unreal.export(story, { engine: 'unreal', projectName: 'Garden', engineVersion: '5.7', integrationRef: 'v1.2.3', includeDemo: false });
    const r = (end: string) => String(unreal.files.find((f) => f.path.endsWith(end))!.content);
    const data = JSON.parse(r('StorySource/StoryInfo.json'));
    expect(data.passages.map((p: { id: string }) => p.id)).toEqual(['garden']);
    expect(data.lines).toHaveLength(4);
    expect(r('NarrativeEnterDialogueTrigger.h')).toContain('meta = (GetOptions = "GetLineOptions")');
    expect(r('NarrativeBridgeComponent.cpp')).toContain('Ink->GoTo(InkPathOf(StoryInfo(), Name));');
  });
});

describe('cutscenes', () => {
  const script = `INT. LIGHTHOUSE - NIGHT

@cutscene

Rain lashes the glass.

MARA
(whispering)
Did you hear that?

@pause

TOM
Only the wind.

EXT. CLIFF - DAY

Waves break below.

MARA
Look.
`;

  it('plays only a cutscene’s dialogue, tagged #cutscene, with nothing to click in between', async () => {
    const { Story } = await import('inkjs');
    const { project } = await build(script);
    const [cut, after] = project.passages;
    expect(cut.cutscene).toBe(true);
    expect(after.cutscene).toBeUndefined();
    const s = processProject(project);
    expect(s.compile.ok).toBe(true);
    expect(s.generated.ink).toContain('MARA: Did you hear that? #speaker:mara #cutscene');
    expect(s.generated.ink).toContain('// Players don’t see this: Rain lashes the glass.');
    const st = new Story(s.compile.json!);
    const text = st.ContinueMaximally();
    // No Continue break inside the cutscene, the scene after it as written.
    expect(text).not.toContain('Rain lashes');
    expect(text).not.toContain('whispering');
    expect(text).toContain('MARA: Did you hear that?\nTOM: Only the wind.\nWaves break below.');
    expect(st.currentTags).not.toContain('cutscene'); // "Look." is after the cutscene
  });

  it('comes back from Ink, and carries into Twine, the playable page and Unity', async () => {
    const { buildTwee, buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build(script);
    const s = processProject(project);
    const back = (await build(s.generated.ink, 'story.ink', 'structured')).project;
    expect(back.passages.map((p) => !!p.cutscene)).toEqual([true, false]);
    const twee = buildTwee(s, 'sugarcube');
    expect(twee).toMatch(/Did you hear that\?\n<<timed \d\.\ds t8n>>\n@@\.speaker;TOM@@\nOnly the wind\.\n<<next \d\.\ds>>\n\[\[Continue->/);
    expect(twee.match(/<<timed/g)).toHaveLength(1);
    expect(buildPlayableHtml(s, '/* runtime */')).toContain("cut: tags.indexOf('cutscene') >= 0");
    const unity = await ADAPTERS.unity.export(s, { engine: 'unity', projectName: 'P', engineVersion: '6000.3', integrationRef: 'v1.21.0', includeDemo: true });
    const all = unity.files.map((f) => f.content).join('\n');
    expect(all).toContain('else if (t == "cutscene") cutscene = true;');
    expect(all).toContain('CutsceneSeconds(visible)');
    const unreal = await ADAPTERS.unreal.export(s, { engine: 'unreal', projectName: 'P', engineVersion: '5.7', integrationRef: 'v1.21.0', includeDemo: true });
    const cpp = unreal.files.map((f) => f.content).join('\n');
    expect(cpp).toContain('else if (Name == TEXT("cutscene")) Line.bIsCutscene = true;');
    expect(cpp).toContain('if (Next.bIsCutscene)');
    expect(JSON.parse(String(unreal.files.find((f) => f.path.endsWith('StorySource/StoryInfo.json'))!.content)).reservedTags).toContain('cutscene');
  });
});

describe('choices taken before', () => {
  it('are known by their passage and text, and every reader greys them out', async () => {
    const { Story } = await import('inkjs');
    const { chosenKey, knotOfPath } = await import('../src/core/chosen');
    const { buildPlayableHtml } = await import('../src/core/export');
    expect(knotOfPath('harbour.0.c-1')).toBe('harbour');
    expect(chosenKey('harbour.0.c-1', ' Take the boat ')).toBe('harbour|Take the boat');
    const sample = SAMPLES.find((x) => x.id === 'archive')!;
    const { project } = await buildStory([{ fileName: sample.fileName, text: sample.text }], { mode: sample.mode });
    const s = processProject(project);
    const st = new Story(s.compile.json!);
    while (st.canContinue || (st.currentChoices.length === 1 && st.currentChoices[0].text === 'Continue')) {
      if (st.canContinue) st.ContinueMaximally();
      else st.ChooseChoiceIndex(0);
    }
    const c = st.currentChoices[0];
    const knot = chosenKey(c.sourcePath, c.text).split('|')[0];
    expect(project.passages.map((p) => p.id)).toContain(knot);
    const html = buildPlayableHtml(s, '/* runtime */');
    expect(html).toContain(`"chosenKey":"narrative-bridge.chosen.${project.project.id}"`);
    expect(html).toContain("'choice chosen'");
    const unity = await ADAPTERS.unity.export(s, { engine: 'unity', projectName: 'P', engineVersion: '6000.3', integrationRef: 'v1.21.0', includeDemo: true });
    const cs = unity.files.map((f) => f.content).join('\n');
    expect(cs).toContain('public bool WasChosen(Choice choice)');
    expect(cs).toContain('controller.WasChosen(choices[i])');
    expect(cs).toContain(".Split('\\n')");
    const unreal = await ADAPTERS.unreal.export(s, { engine: 'unreal', projectName: 'P', engineVersion: '5.7', integrationRef: 'v1.21.0', includeDemo: true });
    const cpp = unreal.files.map((f) => f.content).join('\n');
    expect(cpp).toContain('bool WasChosen(int32 Index) const;');
    expect(cpp).toContain('Story->WasChosen(i)');
  });
});
