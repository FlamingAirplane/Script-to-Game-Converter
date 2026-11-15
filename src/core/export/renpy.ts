import { choiceGuards } from '../forced';
import { log } from '../log';
import { cutsceneSeconds, forPlayers } from '../players';
import { fileBase, isActive, itemVar, type Choice, type Condition, type Effect, type Passage, type StoryProject } from '../isr';
import type { ProcessedStory } from '../pipeline';
import { GENERATOR_VERSION } from '../version';
import { assertExportable, ExportBlockedError } from './common';

// Ren'Py export: one script.rpy, built from the ISR (like the Twine export, not from the Ink), for the visual-novel
// engine Ren'Py (https://www.renpy.org). Make a new project in the Ren'Py launcher, put this file in its game/ folder
// in place of the script.rpy it made, and launch.
//
// - Each passage is a label (p_<id>); `label start` jumps to the start passage. Narration is said by the narrator,
//   dialogue by a Character defined for each speaker, scene headings and transitions in bold and italics.
// - Items are True/False variables has_<item>, story variables keep their names; both are `default`ed, so saves and
//   rollback carry them. Conditions become Python expressions on menu choices (`"Open it" if has_key:`), effects
//   become `$` lines; a once-only choice also sets once_<choice>.
// - Ren'Py skips a menu when none of its choices can be taken, and goes on to the line after it: that's where the
//   passage's fallback (its "then") goes, as in Ink.
// - A Continue break needs nothing (Ren'Py waits for a click after every line). A cutscene's lines go on by
//   themselves ({w=…}{nw}). An exit to the game calls the label nb_exit, which says so and returns; replace it with
//   the gameplay. A cue calls nb_cue, which does nothing until the developer fills it in. Notes become # comments.

export function renpyFileName(story: ProcessedStory): string {
  return `${fileBase(story.project)}-renpy-script.rpy`;
}

/** Names Ren'Py or Python already use, which a story variable mustn't shadow. */
const RESERVED = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'True', 'False', 'None', 'config', 'renpy', 'store', 'persistent', 'gui', 'style', 'build', 'preferences', 'layout', 'menu', 'narrator',
  'centered', 'extend', 'adv', 'nvl', 'ui', 'im', 'theme', 'director', 'achievement', 'iap', 'updater', 'define', 'default', 'label', 'screen',
  'image', 'jump', 'call', 'scene', 'show', 'hide', 'with', 'play', 'stop', 'queue', 'voice', 'pause', 'window', 'list', 'dict', 'set', 'str',
  'int', 'len', 'print', 'type', 'object', 'id', 'input', 'open', 'range', 'map', 'filter', 'next', 'iter', 'sum', 'min', 'max', 'abs',
]);

/** A story variable's name in Python: as it is, unless Ren'Py or Python already uses it. */
export function renpyVar(name: string): string {
  return RESERVED.has(name) || name.startsWith('_') ? `story_${name.replace(/^_+/, '')}` : name;
}

/** Text for a Ren'Py string: quotes and backslashes escaped, and [ and { doubled so they aren't read as markup. */
export function renpyText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\[/g, '[[').replace(/\{/g, '{{').replace(/\s*\n\s*/g, '\\n');
}

function literal(v: boolean | number | string): string {
  return v === true ? 'True' : v === false ? 'False' : typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/** A condition as a Python expression, with parentheses only where they are needed. */
export function conditionToPython(c: Condition): string {
  const inner = (x: Condition, parent: 'and' | 'or' | 'not') => {
    const s = conditionToPython(x);
    const needs = parent === 'not' ? x.type !== 'has_item' && x.type !== 'not' : (x.type === 'and' || x.type === 'or' || x.type === 'compare') && x.type !== parent;
    return needs ? `(${s})` : s;
  };
  switch (c.type) {
    case 'has_item':
      return itemVar(c.itemId);
    case 'not':
      return `not ${inner(c.condition, 'not')}`;
    case 'and':
      return c.conditions.map((x) => inner(x, 'and')).join(' and ');
    case 'or':
      return c.conditions.map((x) => inner(x, 'or')).join(' or ');
    case 'compare':
      return `${renpyVar(c.variableId)} ${c.op} ${literal(c.value)}`;
  }
}

/** An effect as a Ren'Py `$` line. */
export function effectToPython(e: Effect): string {
  switch (e.type) {
    case 'give_item':
      return `$ ${itemVar(e.itemId)} = True`;
    case 'take_item':
      return `$ ${itemVar(e.itemId)} = False`;
    case 'set_var':
      return `$ ${renpyVar(e.variableId)} = ${literal(e.value)}`;
    case 'add_var':
      return `$ ${renpyVar(e.variableId)} ${e.amount >= 0 ? '+=' : '-='} ${Math.abs(e.amount)}`;
  }
}

const label = (id: string) => (id === 'END' || !id ? 'nb_the_end' : `p_${id}`);
const comment = (text: string) => `# ${text.replace(/\s*\n\s*/g, ' ')}`;

export function buildRenpy(story: ProcessedStory): string {
  assertExportable(story);
  const project: StoryProject = forPlayers(story.project);
  if (project.inkPassthrough !== undefined)
    throw new ExportBlockedError('Ren’Py export works from converted scripts. This story was imported as Ink, so export it as Ink or to an engine instead.');

  // One Character per speaker, named c_<id>.
  const speakers = new Map(project.characters.map((c) => [c.id, `c_${c.id}`]));
  const out: string[] = [
    `# ${project.project.title}`,
    `# Made with Narrative Bridge ${GENERATOR_VERSION}. Put this file in your Ren'Py project's game/ folder and delete`,
    `# the script.rpy the launcher made there (this file has its own "label start"), then launch the project.`,
    `# Regenerate it from Narrative Bridge rather than editing it, or your changes will be lost next time.`,
    '',
  ];
  if (project.characters.length) {
    out.push('# The characters.');
    for (const c of project.characters) out.push(`define ${speakers.get(c.id)} = Character("${renpyText(c.displayName)}")`);
    out.push('');
  }
  const onceIds = project.passages.flatMap((p) => p.choices.filter((c) => isActive(c.review) && c.once).map((c) => c.id));
  if (project.items.length || project.variables.length || onceIds.length) {
    out.push('# What the player has, and the story\'s variables. "default" keeps them in saves and rollback.');
    for (const i of project.items) out.push(`default ${itemVar(i.id)} = False  # ${i.displayName.replace(/\n/g, ' ')}`);
    for (const v of project.variables) out.push(`default ${renpyVar(v.id)} = ${literal(v.initial)}`);
    for (const id of onceIds) out.push(`default once_${id} = False`);
    out.push('');
  }
  out.push(
    '# Where the game takes over from the story (a fight, exploring, a puzzle). Replace this with the gameplay;',
    '# "name" says which exit it is. When it returns, the story goes on.',
    'label nb_exit(name, note=""):',
    '    "{i}(The game takes over here: [name]. [note]){/i}"',
    '    return',
    '',
    '# A cue for the game (music, a sound, a shake). Fill this in to play them, for example:',
    '#     if name == "music": renpy.music.play(value + ".ogg")',
    'init python:',
    '    def nb_cue(name, value=""):',
    '        pass',
    '',
    'label start:',
    `    jump ${label(project.project.startPassage)}`,
    '',
  );

  for (const p of project.passages) out.push(...passageLines(p, speakers), '');

  out.push('label nb_the_end:', '    "{i}The End{/i}"', '    return', '');
  log('export').info('Built Ren’Py script', { passages: project.passages.length, items: project.items.length, variables: project.variables.length });
  return out.join('\n');
}

function passageLines(p: Passage, speakers: Map<string, string>): string[] {
  const lines: string[] = [`label ${label(p.id)}:`, `    ${comment(p.title)}`];
  // A cutscene goes on by itself: each line waits long enough to be read, then the next comes without a click.
  const wait = (text: string) => (p.cutscene ? `{w=${cutsceneSeconds(text).toFixed(1)}}{nw}` : '');
  const say = (who: string | null, text: string) => lines.push(`    ${who ? `${who} ` : ''}"${renpyText(text)}${wait(text)}"`);
  if (p.sceneHeading) say(null, `\u0000b\u0001${p.sceneHeading}\u0000/b\u0001`);
  for (const b of p.content) {
    switch (b.type) {
      case 'action':
        for (const para of b.text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) say(null, para);
        break;
      case 'dialogue': {
        const who = speakers.get(b.speakerId) ?? 'narrator';
        const paren = b.parenthetical ? `\u0000i\u0001(${b.parenthetical.replace(/^\(|\)$/g, '')})\u0000/i\u0001 ` : '';
        say(who, `${paren}${b.text}`);
        break;
      }
      case 'transition':
        say(null, `\u0000i\u0001${b.text}\u0000/i\u0001`);
        break;
      case 'note':
        lines.push(`    ${comment(`Note: ${b.text}`)}`);
        break;
      case 'unsupported':
        lines.push(`    ${comment(`Not converted (${b.reason}): ${b.text}`)}`);
        break;
      case 'effect':
        if (isActive(b.review ?? 'approved')) lines.push(`    ${effectToPython(b.effect)}`);
        break;
      case 'pause':
        lines.push('    # A Continue break: Ren\'Py already waits for a click after each line.');
        break;
      case 'exit':
        lines.push(`    call nb_exit("${renpyText(b.name)}", "${renpyText(b.note ?? '')}")`);
        break;
      case 'cue':
        lines.push(`    $ nb_cue("${renpyText(b.name)}", "${renpyText(b.value ?? '')}")`);
        break;
    }
  }

  // A forced choice keeps the others out while it applies, as in Ink: they get its condition, negated.
  const guards = choiceGuards(p);
  const choices = p.choices.filter((c) => isActive(c.review)).map((c) => ({ ...c, conditions: [...c.conditions, ...(guards.get(c.id) ?? [])] }));
  if (choices.length) {
    lines.push('    menu:');
    for (const c of choices) lines.push(...choiceLines(c));
  }
  // Ren'Py goes on past a menu none of whose choices can be taken: the passage's "then", as Ink's fallback does.
  const then = p.divert ?? (p.isEnding || !choices.length ? 'END' : undefined);
  if (then) lines.push(`    jump ${label(then)}`);
  else lines.push('    return  # nowhere to go: the story stops here');
  // Markup was kept apart from the writer's text (which has its braces doubled); put it back.
  return lines.map((l) => l.replace(/\u0000/g, '{').replace(/\u0001/g, '}'));
}

function choiceLines(c: Choice): string[] {
  const parts = c.conditions.map((x) => (x.type === 'or' ? `(${conditionToPython(x)})` : conditionToPython(x)));
  if (c.once) parts.push(`not once_${c.id}`);
  const out = [`        "${renpyText(c.text) || 'Continue'}"${parts.length ? ` if ${parts.join(' and ')}` : ''}:`];
  for (const e of c.effects) out.push(`            ${effectToPython(e)}`);
  if (c.once) out.push(`            $ once_${c.id} = True`);
  out.push(`            jump ${label(c.target)}`);
  return out;
}
