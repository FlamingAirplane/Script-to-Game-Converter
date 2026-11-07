import { fnv1a } from '../hash';
import { storyLayout } from '../layout';
import { log } from '../log';
import { choiceGuards } from '../forced';
import { EXIT_PREFIX, fileBase, isActive, itemVar, type Choice, type Condition, type Effect, type Passage, type StoryProject } from '../isr';
import type { ProcessedStory } from '../pipeline';
import { GENERATOR_VERSION } from '../version';
import { assertExportable, ExportBlockedError } from './common';

// Twine export: a Twee 3 file, built from the ISR (not from the Ink). Import it in Twine 2 via
// Library → Import, or compile it with Tweego. Two kinds:
//
// - "sugarcube" (the default): the story with its logic, for the SugarCube 2 story format.
//   Items are Boolean variables $has_<item>, set up in StoryInit with the story's other variables.
//   Choices are links; conditions wrap them in <<if>>, effects become link setters, once-only
//   choices track a $once_<choice> flag. A passage's divert becomes a "Continue" link offered when
//   none of its conditional choices are (Ink's invisible fallback). A small stylesheet sets the
//   scene headings, speakers and transitions like the playable story.
// - "plain": only the story. Passages, their text and the links between them, with no code,
//   styling, variables or notes, so it opens in any story format (Harlowe, SugarCube, Chapbook…).
//   Every choice is always offered.
//
// Passage text is written as plain prose that reads well in Twine's editor: paragraphs separated by
// blank lines, dialogue as a speaker line followed by the speech. Passages are placed on Twine's
// story map the way they are on the Graph chapter's map. A Continue break splits a passage into
// "Name" and "Name (continued)" joined by a Continue link (works in every story format).

export const SUGARCUBE_VERSION = '2.37.3';

export type TwineKind = 'sugarcube' | 'plain';

export function twineFileName(story: ProcessedStory, kind: TwineKind = 'sugarcube'): string {
  return `${fileBase(story.project)}${kind === 'plain' ? '-story-only' : ''}.twee`;
}

/** Twine passage and link names can't contain these characters. */
function clean(s: string): string {
  return s.replace(/[[\]{}|<>]/g, ' ').replace(/->|<-/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

// Text that SugarCube would read as markup or code: links, macros, formatting, HTML, variables,
// comments, entities, and markup that only counts at the start of a line (headings, lists, rules).
const SUGARCUBE_MARKUP = /\[\[|<<|>>|\/\/|''|__|==|\^\^|~~|@@|\{\{\{|\}\}\}|\/\*|\*\/|<\/?[A-Za-z!]|\$[A-Za-z_]|(?:^|[^\w])_[A-Za-z]|&[A-Za-z#]\w*;|\\$|"""|^\s*(?:[!*#>]|----)/m;

/** Prose for SugarCube: as it is, unless it contains something SugarCube would read as markup. */
function sugarText(text: string): string {
  if (!SUGARCUBE_MARKUP.test(text)) return text;
  // """ starts/ends a verbatim run, so a literal """ in the text is broken up with a zero-width space.
  return `"""${text.replace(/"""/g, '"​""')}"""`;
}

function literal(v: boolean | number | string): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

const OPS: Record<string, string> = { '==': 'is', '!=': 'isnot', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };

/** A SugarCube expression, with parentheses only where they are needed. */
export function conditionToSugarCube(c: Condition): string {
  const inner = (x: Condition, parent: 'and' | 'or' | 'not') => {
    const s = conditionToSugarCube(x);
    const needs = parent === 'not' ? x.type !== 'has_item' && x.type !== 'not' : (x.type === 'and' || x.type === 'or') && x.type !== parent;
    return needs ? `(${s})` : s;
  };
  switch (c.type) {
    case 'has_item':
      return `$${itemVar(c.itemId)}`;
    case 'not':
      return `not ${inner(c.condition, 'not')}`;
    case 'and':
      return c.conditions.map((x) => inner(x, 'and')).join(' and ');
    case 'or':
      return c.conditions.map((x) => inner(x, 'or')).join(' or ');
    case 'compare':
      return `$${c.variableId} ${OPS[c.op]} ${literal(c.value)}`;
  }
}

export function effectToSugarCube(e: Effect): string {
  switch (e.type) {
    case 'give_item':
      return `$${itemVar(e.itemId)} to true`;
    case 'take_item':
      return `$${itemVar(e.itemId)} to false`;
    case 'set_var':
      return `$${e.variableId} to ${literal(e.value)}`;
    case 'add_var':
      return `$${e.variableId} ${e.amount >= 0 ? '+=' : '-='} ${Math.abs(e.amount)}`;
  }
}

/** Stable IFID (Twine's story id) derived from the project id, formatted as an uppercase UUID v4. */
export function ifidFor(projectId: string): string {
  const hex = [0, 1, 2, 3].map((i) => fnv1a(`${i}:${projectId}`)).join('');
  const v = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v.toUpperCase();
}

/** Passage positions on Twine's map, from the story map (the writer's arrangement, if they made one). */
function twinePositions(story: ProcessedStory): Map<string, string> {
  const auto = storyLayout(story.analysis.graph, story.project.project.startPassage);
  const pos = new Map([...auto].map(([id, p]) => [id, story.project.layout?.[id] ?? p]));
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const minX = Math.min(0, ...xs);
  const minY = Math.min(0, ...ys);
  // Twine's cards are 100 × 100; these scales keep cards that don't overlap on the story map apart.
  return new Map([...pos].map(([id, p]) => [id, `${Math.round(100 + (p.x - minX) * 0.75)},${Math.round(100 + (p.y - minY) * 1.85)}`]));
}

export function buildTwee(story: ProcessedStory, kind: TwineKind = 'sugarcube'): string {
  assertExportable(story);
  const project: StoryProject = story.project;
  if (project.inkPassthrough !== undefined)
    throw new ExportBlockedError('Twine export works from converted scripts. This story was imported as Ink, so export it as Ink or to an engine instead.');
  const plain = kind === 'plain';

  // Unique, readable passage names (Twine links by name).
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const p of project.passages) {
    let name = clean(p.title);
    if (used.has(name.toLowerCase())) name = `${name} (${p.id})`;
    used.add(name.toLowerCase());
    names.set(p.id, name);
  }
  // A passage with Continue breaks becomes several Twine passages, "Name", "Name (continued)",
  // "Name (continued 2)"…, each ending in a Continue link to the next.
  const parts = new Map(project.passages.map((p) => [p.id, splitAtPauses(p)]));
  for (const p of project.passages)
    parts.get(p.id)!.forEach((part, k) => {
      if (!k) return;
      let name = `${names.get(p.id)} (continued${k > 1 ? ` ${k}` : ''})`;
      while (used.has(name.toLowerCase())) name = `${name}′`;
      used.add(name.toLowerCase());
      names.set(part.id, name);
    });
  // Choices that end the story link to a dedicated ending passage.
  let endName = 'The End';
  if (used.has(endName.toLowerCase())) endName = 'The End (finis)';
  names.set('END', endName);
  const nameOf = (id: string) => names.get(id) ?? clean(id);
  const speakers = new Map(project.characters.map((c) => [c.id, c.displayName]));
  const positions = twinePositions(story);
  const out: string[] = [];

  out.push(':: StoryTitle', project.project.title, '');
  // Without a format, Twine uses its default story format (Harlowe) for the story-only file.
  // The story-only file has its own IFID, so Twine keeps both versions instead of offering to replace one.
  const data = plain
    ? { ifid: ifidFor(`${project.project.id}:story-only`), start: nameOf(project.project.startPassage), zoom: 1 }
    : { ifid: ifidFor(project.project.id), format: 'SugarCube', 'format-version': SUGARCUBE_VERSION, start: nameOf(project.project.startPassage), zoom: 1 };
  out.push(':: StoryData', JSON.stringify(data, null, 2), '');

  if (!plain) {
    const onceIds = project.passages.flatMap((p) => p.choices.filter((c) => isActive(c.review) && c.once).map((c) => c.id));
    const init = [
      `/* Made with Narrative Bridge ${GENERATOR_VERSION}. Each item is a true/false variable named $has_<item>. */`,
      ...project.items.map((i) => `<<set $${itemVar(i.id)} to false>> /* ${i.displayName.replace(/\*\//g, '')} */`),
      ...project.variables.map((v) => `<<set $${v.id} to ${literal(v.initial)}>>`),
      ...(onceIds.length ? ['/* Choices that can only be made once. */', ...onceIds.map((id) => `<<set $once_${id} to false>>`)] : []),
    ];
    if (init.length > 1) out.push(':: StoryInit', ...init, ''); // nothing to set up: no StoryInit
    out.push(':: StoryStylesheet [stylesheet]', STYLESHEET.trim(), '');
  }

  for (const p of project.passages)
    parts.get(p.id)!.forEach((part, k) => {
      const tags = !plain && part.isEnding ? ' [ending]' : '';
      const [x, y] = (positions.get(p.id) ?? '100,100').split(',').map(Number);
      out.push(`:: ${nameOf(part.id)}${tags} {"position":"${x},${y + k * 130}"}`);
      out.push(...(plain ? plainBody(part, speakers, nameOf) : sugarBody(part, speakers, nameOf)), '');
    });
  const endsByChoice = project.passages.some((p) => p.choices.some((c) => isActive(c.review) && (c.target === 'END' || !c.target)));
  if (endsByChoice) {
    const bottom = Math.max(100, ...[...positions.values()].map((v) => Number(v.split(',')[1]))) + 200;
    out.push(`:: ${endName}${plain ? '' : ' [ending]'} {"position":"100,${bottom}"}`, plain ? 'The End' : END_MARKUP, '');
  }
  log('export').info('Built Twine file', { kind, passages: project.passages.length, items: project.items.length, variables: project.variables.length });
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Splits a passage at its Continue breaks (and exits to the game). Each part but the last ends by continuing to the next
 * (a "Continue" link); the last keeps the passage's choices, divert and ending. Only the first part
 * has the scene heading. Ids of later parts are "<id>#2", "<id>#3"….
 */
function splitAtPauses(p: Passage): Passage[] {
  const segments: Passage['content'][] = [[]];
  for (const b of p.content) {
    if (b.type === 'pause') segments.push([]);
    else if (b.type === 'exit') {
      // Twine has no game to hand over to: an exit becomes a Continue link, with a note saying so.
      segments[segments.length - 1].push({ type: 'note', text: `${EXIT_PREFIX}${b.name}${b.note ? ` (${b.note})` : ''}`, origin: b.origin });
      segments.push([]);
    } else segments[segments.length - 1].push(b);
  }
  if (segments.length === 1) return [p];
  const id = (k: number) => (k ? `${p.id}#${k + 1}` : p.id);
  return segments.map((content, k) => {
    const last = k === segments.length - 1;
    return { ...p, id: id(k), content, sceneHeading: k ? undefined : p.sceneHeading, choices: last ? p.choices : [], divert: last ? p.divert : id(k + 1), isEnding: last && p.isEnding };
  });
}

/** Paragraphs of a block: blank lines separate them; single line breaks (verse, lyrics) are kept. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'))
    .filter(Boolean);
}

/** The story with its logic, for SugarCube. */
function sugarBody(p: Passage, speakers: Map<string, string>, nameOf: (id: string) => string): string[] {
  const blocks: string[] = [];
  // Lines that print nothing (effects, notes) end with "\" so they leave no empty line behind.
  const silent: string[] = [];
  const flushSilent = () => {
    if (silent.length) blocks.push(`${silent.join('')}\\`);
    silent.length = 0;
  };
  const add = (text: string) => {
    flushSilent();
    blocks.push(text);
  };
  if (p.sceneHeading) add(`@@.scene;${sugarText(p.sceneHeading)}@@`);
  for (const b of p.content) {
    switch (b.type) {
      case 'action':
        for (const para of paragraphs(b.text)) add(sugarText(para));
        break;
      case 'dialogue': {
        const name = (speakers.get(b.speakerId) ?? b.speakerId).toUpperCase() + (b.extension ? ` (${b.extension})` : '');
        const paren = b.parenthetical ? ` //(${sugarText(b.parenthetical)})//` : '';
        add(`@@.speaker;${sugarText(name)}@@${paren}\n${sugarText(paragraphs(b.text).join('\n'))}`);
        break;
      }
      case 'transition':
        add(`@@.transition;${sugarText(b.text)}@@`);
        break;
      case 'note':
        silent.push(`/* Note: ${b.text.replace(/\*\//g, '* /')} */`);
        break;
      case 'unsupported':
        silent.push(`/* Not converted (${b.reason}): ${b.text.replace(/\*\//g, '* /')} */`);
        break;
      case 'effect':
        if (isActive(b.review ?? 'approved')) silent.push(`<<set ${effectToSugarCube(b.effect)}>>`);
        break;
    }
  }
  // Effects and notes after the last paragraph sit just above the links.
  flushSilent();

  // A forced choice keeps the others out while it applies, as in Ink: they get its condition, negated.
  const guards = choiceGuards(p);
  const choices = p.choices.filter((c) => isActive(c.review)).map((c) => ({ ...c, conditions: [...c.conditions, ...(guards.get(c.id) ?? [])] }));
  if (choices.length === 0) {
    blocks.push(p.divert && p.divert !== 'END' ? `[[Continue->${nameOf(p.divert)}]]` : END_MARKUP);
    return joinBlocks(blocks);
  }
  const links = choices.map((c) => choiceLink(c, nameOf));
  // Ink's invisible fallback: offered only when every choice is conditional and none is available.
  const fallback = p.divert ?? (p.isEnding ? 'END' : undefined);
  if (fallback && choices.every((c) => c.conditions.length || c.once)) {
    const none = choices.map((c) => negate(guard(c))).join(' and ');
    links.push(`<<if ${none}>>${fallback === 'END' ? END_MARKUP : `[[Continue->${nameOf(fallback)}]]`}<</if>>`);
  }
  // Hidden choices would leave empty lines; inside the choices block the stylesheet removes them.
  blocks.push(links.some((l) => l.startsWith('<<if')) ? `@@.choices;\n${links.join('\n')}\n@@` : links.join('\n'));
  return joinBlocks(blocks);
}

/** Blocks separated by a blank line, except after a silent line (which already swallows its line break). */
function joinBlocks(blocks: string[]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    out.push(b);
    if (i < blocks.length - 1 && !b.endsWith('\\')) out.push('');
  });
  return out;
}

/** Only the story: text and links, nothing that depends on a story format. */
function plainBody(p: Passage, speakers: Map<string, string>, nameOf: (id: string) => string): string[] {
  const blocks: string[] = [];
  if (p.sceneHeading) blocks.push(p.sceneHeading);
  for (const b of p.content) {
    if (b.type === 'action') blocks.push(...paragraphs(b.text));
    else if (b.type === 'transition') blocks.push(b.text);
    else if (b.type === 'dialogue') {
      const name = (speakers.get(b.speakerId) ?? b.speakerId).toUpperCase() + (b.extension ? ` (${b.extension})` : '');
      blocks.push(`${name}${b.parenthetical ? ` (${b.parenthetical})` : ''}: ${paragraphs(b.text).join('\n')}`);
    }
  }
  const choices = p.choices.filter((c) => isActive(c.review));
  if (choices.length) blocks.push(choices.map((c) => `[[${linkText(c.text)}->${nameOf(c.target || 'END')}]]`).join('\n'));
  else blocks.push(p.divert && p.divert !== 'END' ? `[[Continue->${nameOf(p.divert)}]]` : 'The End');
  return blocks.flatMap((b, i) => (i ? ['', b] : [b]));
}

function linkText(text: string): string {
  return text.replace(/[[\]|]/g, ' ').replace(/->|<-/g, '–').replace(/\s+/g, ' ').trim() || 'Continue';
}

function guard(c: Choice): string {
  const parts = c.conditions.map((x) => (x.type === 'or' ? `(${conditionToSugarCube(x)})` : conditionToSugarCube(x)));
  if (c.once) parts.push(`not $once_${c.id}`);
  return parts.join(' and ') || 'true';
}

function negate(expr: string): string {
  return /^\$\w+$/.test(expr) ? `not ${expr}` : `not (${expr})`;
}

function choiceLink(c: Choice, nameOf: (id: string) => string): string {
  const setters = c.effects.map(effectToSugarCube);
  if (c.once) setters.push(`$once_${c.id} to true`);
  // SugarCube setter links: [[Text->Target][$a to 1, $b to 2]]
  const link = `[[${linkText(c.text)}->${nameOf(c.target || 'END')}]${setters.length ? `[${setters.join(', ')}]` : ''}]`;
  return c.conditions.length || c.once ? `<<if ${guard(c)}>>${link}<</if>>` : link;
}

const END_MARKUP = '@@.end;❦ The End ❦@@';

const STYLESHEET = `
/* Book style from Narrative Bridge. Delete this passage to use SugarCube's own look. */
body { background: #1d270f; color: #283618; font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
#passages { max-width: 46em; margin: 2.5em 0; background: #fefae0; padding: 3em 3.5em; border-radius: 2px; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5); line-height: 1.7; font-size: 1.1em; }
@media (max-width: 40em) { #passages { padding: 1.5em 1.25em; margin: 1em 0; } }
#passages a { color: #606c38; font-style: italic; }
.scene { display: block; text-align: center; font-variant: small-caps; letter-spacing: 0.2em; color: #5d6440; }
.speaker { font-variant: small-caps; letter-spacing: 0.14em; font-weight: 600; }
.transition { display: block; text-align: right; font-variant: small-caps; color: #5d6440; }
.choices br { display: none; }
.choices a { display: block; margin: 0.15em 0; }
.end { display: block; text-align: center; color: #8f4f16; font-style: italic; margin-top: 1em; }
#ui-bar { background: #2d3c1a; color: #fefae0; border-color: #1d270f; }
`;
