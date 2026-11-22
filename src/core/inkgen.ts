import { actsOf, actTitleLine } from './acts';
import { paragraphId } from './ids';
import { audioFileName } from './audio';
import { passageFlow } from './flow';
import { isForcing } from './forced';
import { describeNeed } from './gating';
import { imageFileName } from './images';
import { lineEntries, passageLineLabels } from './lines';
import { forPlayers } from './players';
import { GENERATOR_VERSION } from './version';
import { CONTINUE_TEXT, conversionMode, cueName, cueTag, EXIT_PREFIX, exitName, isActive, itemVar, type Choice, type Condition, type Effect, type Passage, type StoryProject } from './isr';

// Deterministic, template-based Ink generation. Same ISR in → byte-identical Ink out.
//
// Conventions (see "Ink conventions" in the README):
//  - Items are Boolean VARs named has_<item_id>.
//  - Dialogue lines are "NAME: text" with a #speaker:<id> tag. A voice extension is shown after the name,
//    "NAME (V.O.): text", and tagged #ext:V.O.; parentheticals add #paren:<text>, and
//    a recorded clip adds #audio:<file> (the file ships with the export).
//  - Transitions carry a #transition tag; scene headings are a #scene tag on the first line.
//  - A cutscene's dialogue lines carry #cutscene: readers show them one at a time, going on by themselves.
//  - Acts are a comment before the first knot of each act, "// @act <id> <Title>" (a bare "// @act" when the passages
//    after it are in no act), which the Ink importer reads back (see acts.ts). A story without acts has none.
//  - Notes and unsupported constructs are preserved as Ink comments. So is everything but dialogue when players
//    see only the dialogue (presentation.dialogueOnly; see players.ts).
//  - A Continue break is "+ [Continue]" followed by a gather "-": what follows waits for the reader.
//  - A forced choice ends with "// forced"; every other choice in its passage gets an extra {not (its condition)},
//    so while it applies it's the only choice (see forced.ts).
//  - Every dialogue line is a labelled gather, "- (line_<speaker>_<words>) NAME: text", and gets an entry knot at the
//    end, "=== passage__line_… ===" "-> passage.line_…", so a game can start the story at that line (see lines.ts).
//  - Choices are sticky (+) unless marked once-only (*). A passage divert becomes an invisible
//    fallback choice when the passage also has choices.

export interface SourceMapEntry {
  line: number; // 1-based line in generated Ink
  passageId: string;
  entityId: string;
}

/** A choice that needs something, as the readers need to know it. */
export interface GatedChoiceInfo {
  passage: string;
  /** The choice's id (the #id tag inside its brackets in the Ink). */
  choiceId: string;
  text: string;
  /** While its conditions hold it's the only choice in the passage (see forced.ts). */
  forced: boolean;
  /** One per condition: in plain words, and as data a reader can check. */
  requirements: { words: string; condition: Condition }[];
}

/**
 * What the readers need to know about the story beyond what the Ink says, collected in the same pass that writes the
 * Ink, from the same choices, so the two cannot disagree. The playable page, Playtest and the engine exports use
 * this instead of working it out from the model again.
 */
export interface ReaderInfo {
  /** The choices with conditions: shown greyed out, with what they need, while the reader can't take them yet. */
  gated: GatedChoiceInfo[];
  /** The passages (Ink knots) a game can start the story at, each with its title and its act ("" for none). */
  passages: { id: string; title: string; act: string }[];
  /** The story's acts, in order, with titles as one line. */
  acts: { id: string; title: string }[];
  /** Each line of dialogue a game can start at ("passage.line_…") and how it reads in a menu. */
  lines: { path: string; display: string }[];
  /** The Ink variables that mirror inventory items (has_<item>): exactly the ones the Ink declares. */
  itemVariables: string[];
  /** The story's own variables, as the Ink declares them. */
  variables: string[];
  /** The exits to the game, by name. */
  exits: string[];
  /** The cues the writer added (#music:calm → "music"), and each one as it appears, with its value ("music:calm"). */
  cues: string[];
  cueTags: string[];
}

export interface GeneratedInk {
  ink: string;
  sourceMap: SourceMapEntry[];
  info: ReaderInfo;
}

/** Words Ink reads as a statement when a line starts with them. */
const INK_LINE_KEYWORD = /^(?:TODO|VAR|CONST|LIST|EXTERNAL|INCLUDE)\b/;

export function escapeInk(text: string): string {
  let out = text
    .replace(/\\/g, '\\\\')
    .replace(/([{}[\]|#~])/g, '\\$1')
    .replace(/\/(?=[/*])/g, '\\/')
    .replace(/-(?=>)/g, '\\-')
    .replace(/<(?=[->])/g, '\\<');
  // Characters and words that are syntax at the start of a line (declarations, INCLUDE and TODO notes).
  if (/^[*+\-=(]/.test(out)) out = `\\${out}`;
  else if (INK_LINE_KEYWORD.test(out)) out = `\\${out}`;
  return out;
}

function escapeTagValue(text: string): string {
  return text.replace(/[#\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function conditionToInk(c: Condition): string {
  switch (c.type) {
    case 'has_item':
      return itemVar(c.itemId);
    case 'not':
      return `not ${wrap(c.condition)}`;
    case 'and':
      return c.conditions.map(wrap).join(' && ');
    case 'or':
      return c.conditions.map(wrap).join(' || ');
    case 'compare':
      return `${c.variableId} ${c.op} ${literal(c.value)}`;
  }
}

function wrap(c: Condition): string {
  return c.type === 'has_item' ? conditionToInk(c) : `(${conditionToInk(c)})`;
}

function literal(v: boolean | number | string): string {
  if (typeof v === 'string') return `"${v.replace(/["\\]/g, '')}"`;
  return String(v);
}

export function effectToInk(e: Effect): string {
  switch (e.type) {
    case 'give_item':
      return `~ ${itemVar(e.itemId)} = true`;
    case 'take_item':
      return `~ ${itemVar(e.itemId)} = false`;
    case 'set_var':
      return `~ ${e.variableId} = ${literal(e.value)}`;
    case 'add_var':
      return e.amount >= 0 ? `~ ${e.variableId} += ${e.amount}` : `~ ${e.variableId} -= ${-e.amount}`;
  }
}

export function generateInk(story: StoryProject): GeneratedInk {
  if (story.inkPassthrough !== undefined) return passthrough(story);
  // "Players see only the dialogue": narration and the rest become comments.
  const project = forPlayers(story);

  const lines: string[] = [];
  const sourceMap: SourceMapEntry[] = [];
  const gated: GatedChoiceInfo[] = [];
  const passageInfo: ReaderInfo['passages'] = [];
  const exits = new Set<string>();
  const cues = new Set<string>();
  const cueTags = new Set<string>();
  const emit = (line: string, passageId = '', entityId = '') => {
    lines.push(line);
    if (passageId) sourceMap.push({ line: lines.length, passageId, entityId: entityId || passageId });
  };

  emit(`// ${project.project.title.replace(/\n/g, ' ')}`);
  emit(`// Generated by Pen to Ink ${GENERATOR_VERSION} from ISR schema ${project.schemaVersion} (${conversionMode(project.project.mode)} conversion).`);
  emit('// Edit the source document or the Pen to Ink project, not this file — it is regenerated.');
  emit(`# title: ${escapeTagValue(project.project.title)}`);
  if (project.project.author) emit(`# author: ${escapeTagValue(project.project.author)}`);
  emit('');

  const referencedItems = new Set<string>();
  for (const p of project.passages) {
    for (const c of p.choices.filter((c) => isActive(c.review))) {
      c.effects.forEach((e) => 'itemId' in e && referencedItems.add(e.itemId));
      c.conditions.forEach((x) => collectItems(x, referencedItems));
    }
    for (const b of p.content) if (b.type === 'effect' && isActive(b.review ?? 'approved') && 'itemId' in b.effect) referencedItems.add(b.effect.itemId);
  }
  const items = project.items.filter((i) => i.origin !== 'generated' || referencedItems.has(i.id));
  if (items.length) emit('// Inventory: one Boolean per item (the host game may mirror these; see NarrativeController).');
  const itemVariables = items.map((i) => itemVar(i.id));
  for (const i of items) emit(`VAR ${itemVar(i.id)} = false // ${i.displayName.replace(/\n/g, ' ')}${i.consumable ? ' (consumable)' : ''}`);
  for (const v of project.variables) emit(`VAR ${v.id} = ${literal(v.initial)}`);
  if (items.length || project.variables.length) emit('');

  emit(`-> ${project.project.startPassage}`);

  const speakers = new Map(project.characters.map((c) => [c.id, c]));
  const acts = new Map(actsOf(project).map((a) => [a.id, a]));
  let act: string | undefined;
  for (const p of project.passages) {
    emit('');
    const pAct = p.act && acts.has(p.act) ? p.act : undefined;
    if (pAct !== act) {
      act = pAct;
      emit(act ? `// @act ${act} ${actTitleLine(acts.get(act)!.title)}` : '// @act');
    }
    emit(`=== ${p.id} ===`, p.id);
    passageInfo.push({ id: p.id, title: p.title || p.id, act: pAct ?? '' });
    if (p.title && p.title !== p.id) emit(`// ${p.title.replace(/\n/g, ' ')}${p.source ? ` (source line ${p.source.line})` : ''}`, p.id);
    const labels = passageLineLabels(p);
    let lineIndex = 0;
    let firstText = true;
    const sceneTag = () => {
      if (!firstText) return '';
      firstText = false;
      return `${p.sceneHeading ? ` #scene:${escapeTagValue(p.sceneHeading)}` : ''}${p.image ? ` #image:${imageFileName(p.image)}` : ''}`;
    };
    for (const b of p.content) {
      switch (b.type) {
        case 'action':
          b.text.split('\n').map((s) => s.trim()).filter(Boolean).forEach((para, k) => emit(`${escapeInk(para)}${idTag(b.id, k)}${sceneTag()}`, p.id));
          break;
        case 'dialogue': {
          const who = speakers.get(b.speakerId);
          const name = (who?.displayName ?? b.speakerId).toUpperCase();
          const ext = b.extension ? ` #ext:${escapeTagValue(b.extension)}` : '';
          const paren = b.parenthetical ? ` #paren:${escapeTagValue(b.parenthetical)}` : '';
          const audio = b.audio ? ` #audio:${audioFileName(b.audio)}` : '';
          const cut = p.cutscene ? ' #cutscene' : '';
          // A labelled gather, so a game can start the story here (see lines.ts).
          emit(`- (${labels[lineIndex++]}) ${escapeInk(`${name}${b.extension ? ` (${b.extension})` : ''}: ${b.text}`)} #speaker:${b.speakerId}${ext}${paren}${audio}${cut}${idTag(b.id)}${sceneTag()}`, p.id);
          break;
        }
        case 'transition':
          emit(`${escapeInk(b.text)} #transition${idTag(b.id)}${sceneTag()}`, p.id);
          break;
        case 'note':
          for (const l of b.text.split('\n')) emit(`// ${l}`, p.id);
          break;
        case 'unsupported':
          emit(`// [unsupported: ${b.reason}]`, p.id);
          for (const l of b.text.split('\n')) emit(`//   ${l}`, p.id);
          break;
        case 'effect':
          if (isActive(b.review ?? 'approved')) emit(effectToInk(b.effect), p.id);
          break;
        case 'pause':
          // A Continue break: a lone sticky choice and a gather, so every Ink player shows a Continue
          // button and what follows waits for it. (Sticky, so revisiting the passage never runs dry.)
          emit(`+ [${CONTINUE_TEXT}]`, p.id);
          emit('-', p.id);
          break;
        case 'cue':
          // A tag on its own line: Ink attaches it to the next line (or, with no text after it, to an empty line).
          emit(`# ${cueTag(b.name, b.value)}`, p.id);
          cues.add(cueName(b.name));
          cueTags.add(cueTag(b.name, b.value));
          break;
        case 'exit':
          // An exit to the game: a lone choice the game takes when it resumes the story (players
          // without a game show it as a Resume button), then a gather.
          exits.add(exitName(b.name));
          emit(`+ [${escapeInk(EXIT_PREFIX + exitName(b.name))}]${b.note ? ` // ${b.note.replace(/\s+/g, ' ')}` : ''}`, p.id);
          emit('-', p.id);
          break;
      }
    }
    emitFlow(project, p, emit, gated);
  }
  const entries = lineEntries(project);
  if (entries.length) {
    emit('');
    emit('// Where a game can start the story at a line of dialogue: StartAt("passage.line_…") chooses one of these.');
    for (const e of entries) {
      emit(`=== ${e.entryKnot} ===`, e.passageId);
      emit(`-> ${e.path}`, e.passageId);
    }
  }
  emit('');
  const info: ReaderInfo = {
    gated,
    passages: passageInfo,
    acts: actsOf(project).map((a) => ({ id: a.id, title: actTitleLine(a.title) })),
    lines: entries.map((l) => ({ path: l.path, display: l.display })),
    itemVariables,
    variables: project.variables.map((v) => v.id),
    exits: [...exits],
    cues: [...cues],
    cueTags: [...cueTags],
  };
  return { ink: lines.join('\n'), sourceMap, info };
}

/** A line's or choice's id as an Ink tag (nothing for one made before ids; ensureIds gives those theirs). */
function idTag(id: string | undefined, paragraph = 0): string {
  return id ? ` #id:${paragraphId(id, paragraph)}` : '';
}

function emitFlow(project: StoryProject, p: Passage, emit: (line: string, passageId?: string, entityId?: string) => void, gated: GatedChoiceInfo[]) {
  const flow = passageFlow(p);
  if (flow.choices.length === 0) {
    emit(`-> ${flow.then}`, p.id);
    return;
  }
  for (const { choice: c, guards } of flow.choices) {
    const bullet = c.once ? '*' : '+';
    const cond = c.conditions.length ? ` {${c.conditions.map(wrap).join(' && ')}}` : '';
    // Kept out while a forced choice of this passage applies (each its own {…}, so the Ink importer can tell them apart).
    const guard = guards.map((g) => ` {${conditionToInk(g)}}`).join('');
    emit(`${bullet}${cond}${guard} [${escapeInk(c.text)}${idTag(c.id)}]${isForcing(c) ? ' // forced' : ''}`, p.id, c.id);
    if (c.conditions.length) gated.push(gatedInfo(project, p, c));
    for (const e of c.effects) emit(`    ${effectToInk(e)}`, p.id, c.id);
    emit(`    -> ${c.target || 'END'}`, p.id, c.id);
  }
  // Invisible fallback: taken automatically only when no other choice is available.
  if (flow.then) emit(`+ -> ${flow.then}`, p.id);
}

/** What readers need to know about a choice that has conditions. */
function gatedInfo(project: StoryProject, p: Passage, c: Choice): GatedChoiceInfo {
  return { passage: p.id, choiceId: c.id, text: c.text.trim(), forced: isForcing(c), requirements: c.conditions.map((x) => ({ words: describeNeed(x, project), condition: x })) };
}

function collectItems(c: Condition, out: Set<string>) {
  if (c.type === 'has_item') out.add(c.itemId);
  else if (c.type === 'not') collectItems(c.condition, out);
  else if (c.type === 'and' || c.type === 'or') c.conditions.forEach((x) => collectItems(x, out));
}

function passthrough(project: StoryProject): GeneratedInk {
  const ink = project.inkPassthrough ?? '';
  const sourceMap: SourceMapEntry[] = [];
  let current = '';
  ink.split('\n').forEach((line, i) => {
    const m = /^\s*={2,}\s*(?!function)([A-Za-z_]\w*)/.exec(line);
    if (m) current = m[1];
    if (current) sourceMap.push({ line: i + 1, passageId: current, entityId: current });
  });
  // Kept Ink is the writer's own: its choices are the model's best reading of it, limited to the passages it really has.
  const knots = new Set(sourceMap.map((e) => e.passageId));
  const here = project.passages.filter((p) => knots.has(p.id));
  const gated = here.flatMap((p) => p.choices.filter((c) => isActive(c.review) && c.conditions.length).map((c) => gatedInfo(project, p, c)));
  const blocks = here.flatMap((p) => p.content);
  const cueBlocks = blocks.flatMap((b) => (b.type === 'cue' ? [b] : []));
  const actIds = new Set(actsOf(project).map((a) => a.id));
  const info: ReaderInfo = {
    gated,
    passages: here.map((p) => ({ id: p.id, title: p.title || p.id, act: p.act && actIds.has(p.act) ? p.act : '' })),
    acts: actsOf(project).map((a) => ({ id: a.id, title: actTitleLine(a.title) })),
    lines: [], // no entry knots were added to the writer's Ink, so a game cannot start at a line
    itemVariables: project.items.map((i) => itemVar(i.id)).filter((v) => ink.includes(`VAR ${v} `)),
    variables: project.variables.map((v) => v.id),
    exits: [...new Set(blocks.flatMap((b) => (b.type === 'exit' ? [exitName(b.name)] : [])))],
    cues: [...new Set(cueBlocks.map((b) => cueName(b.name)))],
    cueTags: [...new Set(cueBlocks.map((b) => cueTag(b.name, b.value)))],
  };
  return { ink, sourceMap, info };
}
