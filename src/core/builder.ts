import { diag, type Diagnostic } from './diagnostics';
import { sha256Hex } from './hash';
import { log } from './log';
import { markupToTags, plainText } from './emphasis';
import { stripGuards } from './forced';
import {
  cueName,
  cueValue,
  SCHEMA_VERSION,
  nameCode,
  slugify,
  uniqueId,
  type Character,
  type Choice,
  type Condition,
  type ContentBlock,
  type ConversionMode,
  type OriginalFile,
  type Effect,
  type Item,
  type Passage,
  type Provenance,
  type SourceDocument,
  type SourceFormat,
  type StoryProject,
  type Variable,
} from './isr';
import { proposeAdaptations } from './adapt';
import { inkUnsupported } from './parsing/ink';
import { detectFormat, parserFor } from './parsing/registry';
import type { ParsedBlock } from './parsing/types';

export interface SourceInput {
  fileName: string;
  text: string;
  /** Set when the text was converted from another format (see parsing/convert.ts); skips detection. */
  format?: SourceFormat;
  convertedFrom?: 'fdx' | 'docx' | 'pdf' | 'twine';
  /**
   * Ink only: 'edit' turns it into an editable story; 'keep' keeps the Ink exactly as written
   * (passthrough: playable and exportable, but edits in Review don't change it). Unset: 'edit' when
   * the editor can represent everything in it, otherwise 'keep' (see inkUnsupported).
   */
  inkMode?: 'edit' | 'keep';
  /** Something the writer should know about the conversion (shown as a note in Diagnostics). */
  note?: string;
  /** The converted file itself (its description; the browser keeps the bytes, see originalBytes). */
  original?: OriginalFile;
  /** The converted file's bytes, for the browser to keep. Not part of the story. */
  originalBytes?: Uint8Array;
}

const CONVERTED_LABEL = { fdx: 'Final Draft', docx: 'Word', pdf: 'PDF', twine: "Twine's web page format" } as const;

export interface BuildOptions {
  mode: ConversionMode;
  title?: string;
}

export interface BuildResult {
  project: StoryProject;
  diagnostics: Diagnostic[];
}

const MAX_BYTES = 5 * 1024 * 1024;
const logger = log('build');

export async function buildStory(inputs: SourceInput[], options: BuildOptions): Promise<BuildResult> {
  const done = logger.time('Built story', 'info');
  const diagnostics: Diagnostic[] = [];
  const sources: SourceDocument[] = [];
  const parsed: { doc: SourceDocument; blocks: ParsedBlock[]; keepInk?: boolean }[] = [];

  for (const [index, input] of inputs.entries()) {
    const docId = `doc_${index + 1}`;
    const byteLength = new TextEncoder().encode(input.text).length;
    if (byteLength > MAX_BYTES) {
      diagnostics.push(diag('INPUT_TOO_LARGE', 'error', 'input_validation', `${input.fileName} exceeds 5 MB.`, { entityId: docId }));
      continue;
    }
    if (/\u0000/.test(input.text)) {
      diagnostics.push(
        diag('INPUT_BINARY', 'error', 'input_validation', `${input.fileName} looks like a binary file, not text.`, {
          entityId: docId,
          remediation: 'DOCX, FDX and PDF are not supported yet. Export the script as .fountain or .txt.',
        }),
      );
      continue;
    }
    if (input.text.includes('�')) {
      diagnostics.push(
        diag('INPUT_ENCODING', 'warning', 'input_validation', `${input.fileName} contains characters that could not be decoded.`, {
          entityId: docId,
          remediation: 'Re-save the file as UTF-8.',
          exportBlocked: false,
        }),
      );
    }
    const detected = input.format ? { format: input.format, confidence: 1, by: 'extension' as const } : detectFormat(input.fileName, input.text);
    if (input.convertedFrom) {
      diagnostics.push(
        diag('INPUT_CONVERTED', 'info', 'input_validation', `${input.fileName} was converted from ${CONVERTED_LABEL[input.convertedFrom]} to ${parserFor(detected.format).label}. Text and structure are kept; fonts, bold and italics are not.`, {
          entityId: docId,
          exportBlocked: false,
        }),
      );
    }
    if (input.note) diagnostics.push(diag('INPUT_NOTE', 'info', 'input_validation', input.note, { entityId: docId, exportBlocked: false }));
    if (detected.by === 'content' && detected.format !== 'txt') {
      diagnostics.push(
        diag('INPUT_FORMAT_SNIFFED', 'info', 'input_validation', `${input.fileName} was detected as ${parserFor(detected.format).label} from its content.`, {
          entityId: docId,
          exportBlocked: false,
        }),
      );
    }
    const doc: SourceDocument = {
      id: docId,
      fileName: input.fileName,
      format: detected.format,
      sha256: await sha256Hex(input.text),
      byteLength,
      text: input.text,
      ...(input.original ? { original: input.original } : {}),
    };
    sources.push(doc);
    const parsed1 = logger.time('Parsed document');
    const result = parserFor(doc.format).parse(input.text, docId);
    parsed1({ document: docId, format: doc.format, detectedBy: detected.by, converted: input.convertedFrom, bytes: byteLength, lines: input.text.split('\n').length, blocks: result.blocks.length, warnings: result.diagnostics.length });
    diagnostics.push(...result.diagnostics);
    let keepInk: boolean | undefined;
    if (doc.format === 'ink') {
      const features = inkUnsupported(input.text);
      keepInk = input.inkMode ? input.inkMode === 'keep' : features.length > 0;
      const kinds = [...new Set(features.map((f) => f.feature.replace(/ \(.*$|\s\{.*$/, '')))];
      if (keepInk)
        diagnostics.push(
          diag('INK_KEPT_AS_WRITTEN', 'info', 'input_validation', `${input.fileName} is kept exactly as written, so it plays as before but edits in Review don't change it.${features.length ? ` It uses Ink the editor can't show: ${kinds.slice(0, 4).join(', ')}${kinds.length > 4 ? '…' : ''}.` : ''}`, {
            entityId: docId,
            remediation: 'To edit it here, import it again and choose "Edit in Narrative Bridge"; those parts are then kept as notes.',
            exportBlocked: false,
          }),
        );
      else if (features.length)
        diagnostics.push(
          diag('INK_CONVERTED_PARTLY', 'warning', 'input_validation', `${input.fileName} was made editable, but ${features.length} line${features.length === 1 ? '' : 's'} use Ink the editor can't show (${kinds.slice(0, 4).join(', ')}${kinds.length > 4 ? '…' : ''}). They are kept as notes.`, {
            entityId: docId,
            remediation: 'Check those passages in Review, or import the file again and choose "Keep the Ink exactly as written".',
            exportBlocked: false,
          }),
        );
    }
    parsed.push({ doc, blocks: result.blocks, keepInk });
  }

  const project = assemble(parsed, options, diagnostics);
  project.sources = sources;
  if (options.mode === 'adaptation') proposeAdaptations(project);
  done({
    mode: options.mode,
    documents: sources.length,
    passages: project.passages.length,
    characters: project.characters.length,
    items: project.items.length,
    variables: project.variables.length,
    proposals: project.passages.reduce((n, p) => n + p.choices.filter((c) => c.review === 'pending').length, 0),
    diagnostics: diagnostics.length,
  });
  return { project, diagnostics };
}

const SCENE_PREFIX = /^(?:INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]+/i;
const TIME_SUFFIX = /\s*[-–—]\s*(?:DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|LATER|CONTINUOUS|MOMENTS LATER|SAME|AFTERNOON)\b.*$/i;

export function sceneSlug(heading: string): string {
  return slugify(heading.replace(SCENE_PREFIX, '').replace(TIME_SUFFIX, '')) || 'scene';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function assemble(
  parsed: { doc: SourceDocument; blocks: ParsedBlock[]; keepInk?: boolean }[],
  options: BuildOptions,
  diagnostics: Diagnostic[],
): StoryProject {
  const all = parsed.flatMap(({ doc, blocks }) => blocks.map((b) => ({ doc, b })));
  // Ink kept exactly as written is passed through to generation; the parsed structure only drives review.
  const isInk = parsed.length > 0 && parsed.every((p) => p.doc.format === 'ink' && p.keepInk);
  // Ink and Twine say where every passage goes; a passage that says nothing is an ending (scripts flow on).
  const explicitFlow = parsed.length > 0 && parsed.every((p) => p.doc.format === 'ink' || p.doc.format === 'twee');
  const hasPassageMarkers = all.some(({ b }) => b.kind === 'marker' && b.marker.type === 'passage');
  const scenes = all.filter(({ b }) => b.kind === 'scene').length;
  const sections = all.filter(({ b }) => b.kind === 'section');
  const isMd = parsed.some((p) => p.doc.format === 'md');

  // Choose passage boundaries: explicit markers > Markdown headings > scenes > sections > one passage.
  let sectionDepth = 0;
  if (!hasPassageMarkers && sections.length && (isMd || scenes === 0)) {
    const depths = sections.map(({ b }) => (b.kind === 'section' ? b.depth : 0));
    const d1 = depths.filter((d) => d === 1).length;
    sectionDepth = d1 <= 1 && depths.some((d) => d > 1) ? Math.min(...depths.filter((d) => d > 1)) : Math.min(...depths);
  }
  const boundary = (b: ParsedBlock): boolean => {
    if (hasPassageMarkers) return b.kind === 'marker' && b.marker.type === 'passage';
    if (sectionDepth) return b.kind === 'section' && b.depth === sectionDepth;
    return b.kind === 'scene';
  };

  let title = options.title?.trim() || '';
  let author: string | undefined;
  const taken = new Set<string>();
  const passages: Passage[] = [];
  const characters = new Map<string, Character>();
  const items = new Map<string, Item>();
  const variables = new Map<string, Variable>();
  let start = '';
  let sceneCounter = 0;
  let current: Passage | null = null;
  const choiceIds = new Set<string>();

  const origin = (b: ParsedBlock): Provenance => (b.transformed ? 'transformed' : 'source');
  const src = (doc: SourceDocument, b: ParsedBlock) => ({ documentId: doc.id, line: b.line, endLine: b.endLine });

  const newPassage = (id: string, ptitle: string, doc: SourceDocument, b: ParsedBlock, extra: Partial<Passage> = {}) => {
    const p: Passage = {
      id,
      title: ptitle,
      content: [],
      choices: [],
      isEnding: false,
      origin: 'source',
      review: 'approved',
      source: src(doc, b),
      ...extra,
    };
    passages.push(p);
    current = p;
    return p;
  };
  const ensureCurrent = (doc: SourceDocument, b: ParsedBlock): Passage =>
    current ?? newPassage(uniqueId('opening', taken), 'Opening', doc, b, { origin: 'transformed' });

  const characterFor = (raw: string): Character => {
    const name = raw.replace(/\s*\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D|CONT’D|CONTINUED)\)\s*/gi, ' ').trim();
    const key = name.toUpperCase();
    let c = characters.get(key);
    if (!c) {
      const id = uniqueId(name, new Set([...characters.values()].map((x) => x.id)), 'character');
      c = { id, displayName: name, aliases: [] };
      characters.set(key, c);
    }
    if (raw !== name && !c.aliases.includes(raw)) c.aliases.push(raw);
    return c;
  };

  for (const { doc, b } of all) {
    if (b.kind === 'title') {
      if (/^title$/i.test(b.key) && !title) title = plainText(markupToTags(b.value.replace(/\n/g, ' ')));
      if (/^(author|authors|credit)$/i.test(b.key) && /^author/i.test(b.key)) author = b.value;
      continue;
    }
    if (boundary(b)) {
      if (b.kind === 'marker' && b.marker.type === 'passage') {
        const id = b.marker.id;
        if (taken.has(id)) {
          diagnostics.push(diag('DUPLICATE_PASSAGE_ID', 'error', 'parsing', `Passage id "${id}" is declared more than once.`, { entityId: id, source: src(doc, b) }));
        }
        taken.add(id);
        newPassage(id, b.marker.title ?? titleCase(id.replace(/_/g, ' ')), doc, b);
      } else if (b.kind === 'section') {
        const id = b.anchor && !taken.has(b.anchor) ? (taken.add(b.anchor), b.anchor) : uniqueId(b.text, taken, 'section');
        newPassage(id, b.text, doc, b, { origin: 'transformed' });
      } else if (b.kind === 'scene') {
        sceneCounter++;
        const id = uniqueId(sceneSlug(b.text), taken, 'scene');
        const ptitle = titleCase(b.text.replace(SCENE_PREFIX, '').replace(TIME_SUFFIX, '')) || b.text;
        newPassage(id, ptitle, doc, b, {
          sceneHeading: b.text,
          sourceId: `scene_${String(b.sceneNumber ?? sceneCounter).padStart(2, '0')}`,
        });
      }
      continue;
    }

    if (b.kind === 'section' && b.depth === 1 && !title) {
      title = b.text;
      continue;
    }
    // Global declarations never force an "Opening" passage into existence.
    if (!current && b.kind === 'marker' && ['item', 'var', 'start'].includes(b.marker.type)) {
      toContent(doc, b, null as unknown as Passage);
      continue;
    }
    const p = ensureCurrent(doc, b);
    const block = toContent(doc, b, p);
    if (block) p.content.push(block);
  }

  function toContent(doc: SourceDocument, b: ParsedBlock, p: Passage): ContentBlock | null {
    const s = src(doc, b);
    switch (b.kind) {
      case 'action':
        return { type: 'action', text: b.text, origin: origin(b), source: s };
      case 'dialogue': {
        const cue = b.character + (b.extension ? ` (${b.extension})` : '');
        const c = characterFor(cue);
        const extension = voiceExtension(cue);
        return { type: 'dialogue', speakerId: c.id, text: b.text, parenthetical: b.parenthetical, ...(extension ? { extension } : {}), origin: origin(b), source: s };
      }
      case 'transition':
        return { type: 'transition', text: b.text, origin: 'source', source: s };
      case 'scene':
        return { type: 'action', text: b.text, origin: 'transformed', source: s };
      case 'section':
        return { type: 'note', text: `Section: ${b.text}`, origin: 'transformed', source: s };
      case 'note':
        return { type: 'note', text: b.text, origin: 'source', source: s };
      case 'unsupported':
        // (Ink kept as written still runs these lines; they only can't be shown in the editor.)
        if (!isInk)
          diagnostics.push(
            diag('UNSUPPORTED_CONSTRUCT', 'review', 'parsing', `${b.reason} cannot be represented in the story model and was preserved as a comment.`, {
              entityId: p.id,
              source: s,
              exportBlocked: false,
            }),
          );
        return { type: 'unsupported', text: b.text, reason: b.reason, origin: 'source', source: s };
      case 'marker': {
        const m = b.marker;
        switch (m.type) {
          case 'start':
            start = m.id;
            return null;
          case 'end':
            p.isEnding = true;
            return null;
          case 'heading':
            if (!p.sceneHeading) p.sceneHeading = m.text;
            return null;
          case 'pause':
            return { type: 'pause', origin: 'source', source: s };
          case 'exit':
            return { type: 'exit', name: m.name, ...(m.note ? { note: m.note } : {}), origin: 'source', source: s };
          case 'cue':
            return { type: 'cue', name: cueName(m.name), ...(cueValue(m.value) ? { value: cueValue(m.value) } : {}), origin: 'source', source: s };
          case 'divert':
            if (p.divert) diagnostics.push(diag('MULTIPLE_DIVERTS', 'warning', 'parsing', `Passage "${p.id}" has more than one divert; the last one wins.`, { entityId: p.id, source: s, exportBlocked: false }));
            p.divert = m.target;
            return null;
          case 'item':
            items.set(m.id, { id: m.id, displayName: m.displayName ?? titleCase(m.id.replace(/_/g, ' ')), consumable: m.consumable, origin: 'source' });
            return null;
          case 'var':
            variables.set(m.id, { id: m.id, type: typeof m.value === 'boolean' ? 'bool' : typeof m.value === 'number' ? 'int' : 'string', initial: m.value, origin: 'source' });
            return null;
          case 'effect':
            return { type: 'effect', effect: m.effect, origin: 'source', review: 'approved', source: s };
          case 'choice': {
            const choiceId = uniqueId(`${p.id}_${m.text}`, choiceIds, 'choice');
            const choice: Choice = {
              id: choiceId,
              text: m.text,
              target: m.target,
              conditions: m.conditions,
              effects: m.effects,
              once: m.once,
              ...(m.forced ? { forced: true } : {}),
              origin: 'source',
              review: 'approved',
              source: s,
            };
            p.choices.push(choice);
            return null;
          }
          case 'passage':
            return null;
        }
      }
    }
    return null;
  }

  // Resolve Ink-relative stitch targets ("stitch|knot").
  const ids = new Set(passages.map((p) => p.id));
  const resolveRel = (t: string | undefined): string | undefined => {
    if (!t || !t.includes('|')) return t;
    const [name, knot] = t.split('|');
    if (ids.has(name)) return name;
    if (ids.has(`${knot}__${name}`)) return `${knot}__${name}`;
    return name;
  };
  for (const p of passages) {
    p.divert = resolveRel(p.divert);
    for (const c of p.choices) c.target = resolveRel(c.target) ?? '';
  }

  // Ink written by Narrative Bridge spells out what forced choices do to the other choices; take that back off.
  for (const p of passages) if (p.choices.some((c) => c.forced)) stripGuards(p);

  // Linear flow: passages without explicit control flow continue to the next passage.
  passages.forEach((p, i) => {
    if (p.choices.length || p.divert || p.isEnding) return;
    if (i + 1 < passages.length && !explicitFlow) p.divert = passages[i + 1].id;
    else p.isEnding = true;
  });
  // A script's own "THE END" is the ending, which every reader already marks: kept as a note, not shown twice.
  for (const p of passages) {
    if (!p.isEnding || p.choices.length || p.divert) continue;
    const i = p.content.length - 1;
    const last = p.content[i];
    if (i > 0 && last && (last.type === 'action' || last.type === 'transition') && END_MARK.test(plainText(last.text))) {
      p.content[i] = { type: 'note', text: `The script's ending: ${plainText(last.text).trim()}`, origin: 'transformed', source: last.source };
    }
  }
  if (passages.length === 0) {
    const doc = parsed[0]?.doc;
    passages.push({
      id: 'start',
      title: 'Start',
      content: doc ? [{ type: 'note', text: 'The source contained no narrative content.', origin: 'transformed' }] : [],
      choices: [],
      isEnding: true,
      origin: 'transformed',
      review: 'approved',
    });
    diagnostics.push(diag('INPUT_EMPTY', 'warning', 'parsing', 'No narrative content was found in the input.', { exportBlocked: false }));
  }

  // Auto-declare items and variables referenced by effects (flagged as transformed, never silently).
  const declareItem = (id: string, where: string) => {
    if (items.has(id) || variables.has(id) || variables.has(`has_${id}`)) return;
    items.set(id, { id, displayName: titleCase(id.replace(/_/g, ' ')), consumable: false, origin: 'transformed' });
    diagnostics.push(diag('ITEM_AUTO_DECLARED', 'info', 'story_validation', `Item "${id}" was declared automatically because ${where} gives or takes it.`, { entityId: id, exportBlocked: false }));
  };
  const declareVar = (e: Effect, where: string) => {
    if (e.type !== 'set_var' && e.type !== 'add_var') return;
    if (variables.has(e.variableId)) return;
    const v = e.type === 'add_var' ? 0 : e.value;
    variables.set(e.variableId, {
      id: e.variableId,
      type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'int' : 'string',
      initial: typeof v === 'boolean' ? false : typeof v === 'number' ? 0 : '',
      origin: 'transformed',
    });
    diagnostics.push(diag('VAR_AUTO_DECLARED', 'info', 'story_validation', `Variable "${e.variableId}" was declared automatically because ${where} sets it.`, { entityId: e.variableId, exportBlocked: false }));
  };
  for (const p of passages) {
    const effects: Effect[] = [
      ...p.content.flatMap((c) => (c.type === 'effect' ? [c.effect] : [])),
      ...p.choices.flatMap((c) => c.effects),
    ];
    for (const e of effects) {
      if (e.type === 'give_item' || e.type === 'take_item') declareItem(e.itemId, `passage "${p.id}"`);
      else declareVar(e, `passage "${p.id}"`);
    }
  }
  // Resolve bare identifiers in conditions now that items and variables are known.
  const resolveCond = (c: Condition): Condition => {
    switch (c.type) {
      case 'has_item':
        if (items.has(c.itemId)) return c;
        if (variables.has(c.itemId)) return { type: 'compare', variableId: c.itemId, op: '==', value: true };
        if (variables.has(`has_${c.itemId}`)) return { type: 'compare', variableId: `has_${c.itemId}`, op: '==', value: true };
        return c;
      case 'not':
        return { type: 'not', condition: resolveCond(c.condition) };
      case 'and':
      case 'or':
        return { type: c.type, conditions: c.conditions.map(resolveCond) };
      default:
        return c;
    }
  };
  for (const p of passages) for (const ch of p.choices) ch.conditions = ch.conditions.map(resolveCond);

  const firstDoc = parsed[0]?.doc;
  if (!title) title = firstDoc ? titleCase(firstDoc.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')) : 'Untitled Story';

  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      id: slugify(title) || (/[\p{L}\p{N}]/u.test(title) ? `story_${nameCode(title)}` : 'story'),
      title,
      author,
      startPassage: start || passages[0].id,
      mode: options.mode,
    },
    sources: [],
    characters: [...characters.values()],
    items: [...items.values()],
    variables: [...variables.values()],
    passages,
    inkPassthrough: isInk ? parsed.map((p) => p.doc.text).join('\n') : undefined,
  };
}

/** A line that only says the story is over: "THE END", "The End.", "END", "FIN". */
const END_MARK = /^\s*(?:the\s+end|end|fin)\s*[.!]?\s*$/i;

/** The voice extension in a character cue, written the usual way: "PORTER (V.O.)" → "V.O.", "(os)" → "O.S.". */
export function voiceExtension(cue: string): string | undefined {
  const m = /\(\s*(V\.?\s*O|O\.?\s*S|O\.?\s*C)\.?\s*\)/i.exec(cue);
  return m ? `${m[1].replace(/[^a-z]/gi, '').toUpperCase().split('').join('.')}.` : undefined;
}
