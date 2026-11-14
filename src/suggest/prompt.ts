// The prompt an on-device model sees for one passage, the shape its reply must take, and how a reply becomes a
// Proposal. The model recognises; code constructs: it names at most one moment (a line, a kind, an item or two
// labels) and this module builds the choices with the same rules the heuristics use, so their structure is always
// valid. Everything it returns still goes through the six checks in applyProposals.

import { gateProposals, headNoun, itemDisplayName, trimPhrase, type FoundItem } from '../core/adapt';
import { plainText } from '../core/emphasis';
import { slugify, type Item, type Passage, type StoryProject } from '../core/isr';
import { cleanLabel, type Proposal, type ProposalKind } from '../core/proposals';

/** A line of a passage as the prompt shows it: `n` is its number in the prompt (from 1), `index` its place in passage.content. */
export interface PromptLine {
  n: number;
  index: number;
  text: string;
}

/** What a model may answer: the one moment in the passage where the reader could choose, or null. */
export interface Moment {
  line: number;
  kind: ProposalKind;
  item?: string;
  labels?: string[];
  flag?: string;
}

/** Characters of prompt lines per call; about 1,000 tokens. Longer passages are cut into windows. */
export const PROMPT_CHAR_BUDGET = 3500;

export const SYSTEM_PROMPT = `You help turn a linear screenplay into an interactive story. You are shown one scene, its lines numbered, and the items the reader may already hold. Name at most one moment in the scene where the reader could choose what happens. Most scenes have none: then answer {"moment": null}.

Kinds of moment:
- pickup: a character takes an object the reader could choose to leave. Give "item": the object, in a few words.
- gate: a character uses one of the listed items, so a reader without it could not go on. Give "item": the item's id as listed.
- reply: a character is asked or told something they could answer in more than one way. Give "labels": two short things the reader could say or do.
- decision: a character faces a choice the story could remember later. Give "labels": the two ways to decide, and "flag": a short name for the first.

Answer with one JSON object and nothing else. Labels are at most eight words. Name only what is in the lines shown.`;

/** Worked examples shown before the real scene (none of them from the evaluation set). */
export const EXAMPLES: { prompt: string; reply: string }[] = [
  {
    prompt: 'Scene 2 of 6: INT. STUDY - NIGHT\n1 [action] Dust on every shelf. Anna takes the silver locket from the desk.\n2 [ANNA] She kept it all these years.\nItems the reader may already hold: none\nName at most one moment where the reader could choose what happens.',
    reply: '{"moment": {"line": 1, "kind": "pickup", "item": "silver locket"}}',
  },
  {
    prompt: 'Scene 3 of 6: EXT. HARBOUR - DAY\n1 [action] Gulls wheel over the boats.\n2 [OFFICER] Where were you last night?\n3 [ANNA] At home.\nItems the reader may already hold: Silver Locket (silver_locket)\nName at most one moment where the reader could choose what happens.',
    reply: '{"moment": {"line": 2, "kind": "reply", "labels": ["Tell him the truth", "Lie to him"]}}',
  },
  {
    prompt: 'Scene 4 of 6: INT. KITCHEN - NIGHT\n1 [action] A sealed letter lies on the table. Anna stares at it.\n2 [ANNA] Not tonight.\nItems the reader may already hold: Silver Locket (silver_locket)\nName at most one moment where the reader could choose what happens.',
    reply: '{"moment": {"line": 1, "kind": "decision", "labels": ["Open the letter", "Leave it sealed"], "flag": "opened the letter"}}',
  },
  {
    prompt: 'Scene 1 of 6: EXT. ROAD - DAWN\n1 [action] Mist over the fields. A cart rolls by.\nItems the reader may already hold: none\nName at most one moment where the reader could choose what happens.',
    reply: '{"moment": null}',
  },
];

const LABELS = { type: 'array', items: { type: 'string', maxLength: 80 }, minItems: 2, maxItems: 2 } as const;

/**
 * The JSON schema a reply is held to while generating: null, or one moment with everything its kind needs.
 * Line numbers are limited to the lines shown and a gate's item to the items listed, so neither can be invented.
 */
export function momentSchema(lineNumbers: number[], itemIds: string[]) {
  const line = lineNumbers.length ? { enum: lineNumbers } : { type: 'integer', minimum: 1 };
  const kind = (k: string, properties: Record<string, unknown>) => ({
    type: 'object',
    properties: { line, kind: { const: k }, ...properties },
    required: ['line', 'kind', ...Object.keys(properties)],
    additionalProperties: false,
  });
  return {
    type: 'object',
    properties: {
      moment: {
        anyOf: [
          { type: 'null' },
          kind('pickup', { item: { type: 'string', minLength: 2, maxLength: 60 } }),
          ...(itemIds.length ? [kind('gate', { item: { enum: itemIds } })] : []),
          kind('reply', { labels: LABELS }),
          kind('decision', { labels: LABELS, flag: { type: 'string', minLength: 2, maxLength: 40 } }),
        ],
      },
    },
    required: ['moment'],
    additionalProperties: false,
  };
}

/** The schema with nothing known about the scene (any line, no gate). */
export const MOMENT_SCHEMA = momentSchema([], []);

/** The passage's action and dialogue lines, numbered from 1, as the prompt shows them. */
export function promptLines(p: Passage, speakers: Map<string, string>): PromptLine[] {
  const lines: PromptLine[] = [];
  p.content.forEach((b, index) => {
    if (b.type === 'action') lines.push({ n: lines.length + 1, index, text: `[action] ${plainText(b.text).replace(/\s+/g, ' ').trim()}` });
    else if (b.type === 'dialogue') lines.push({ n: lines.length + 1, index, text: `[${(speakers.get(b.speakerId) ?? b.speakerId).toUpperCase()}] ${plainText(b.text).replace(/\s+/g, ' ').trim()}` });
  });
  return lines;
}

/** Cuts a long passage into windows of lines that each fit the budget. Line numbers stay those of the whole passage. */
export function windows(lines: PromptLine[], budget = PROMPT_CHAR_BUDGET): PromptLine[][] {
  const out: PromptLine[][] = [];
  let current: PromptLine[] = [];
  let size = 0;
  for (const l of lines) {
    if (current.length && size + l.text.length > budget) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(l);
    size += l.text.length + 8;
  }
  if (current.length) out.push(current);
  return out;
}

export interface PromptInput {
  passage: Passage;
  /** 1-based position among the passages the model reads, and how many there are. */
  index: number;
  total: number;
  lines: PromptLine[];
  knownItems: Item[];
}

/** The user message for one window of one passage. */
export function buildPrompt({ passage, index, total, lines, knownItems }: PromptInput): string {
  const heading = passage.sceneHeading ?? passage.title;
  const items = knownItems.length ? knownItems.map((i) => `${i.displayName} (${i.id})`).join(', ') : 'none';
  return [
    `Scene ${index} of ${total}: ${heading}`,
    ...lines.map((l) => `${l.n} ${l.text}`),
    `Items the reader may already hold: ${items}`,
    'Name at most one moment where the reader could choose what happens.',
  ].join('\n');
}

/**
 * The moment in a reply: `null` when the model says there is none, `undefined` when the reply cannot be read
 * at all (the caller retries once). Anything readable is returned as it is; the checks judge its content.
 */
export function parseReply(text: string): Moment | null | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null || !('moment' in data)) return undefined;
  const m = (data as { moment: unknown }).moment;
  if (m === null) return null;
  if (typeof m !== 'object' || Array.isArray(m)) return undefined;
  const r = m as Record<string, unknown>;
  return {
    line: typeof r.line === 'number' ? r.line : Number.NaN,
    kind: r.kind as ProposalKind,
    ...(typeof r.item === 'string' ? { item: r.item } : {}),
    ...(Array.isArray(r.labels) ? { labels: r.labels.map((l) => (typeof l === 'string' ? l : '')) } : {}),
    ...(typeof r.flag === 'string' ? { flag: r.flag } : {}),
  };
}

/** The item phrase as the heuristics would spell it: lower case, no leading article, cut at the first preposition. */
export function itemPhrase(item: string): string {
  return trimPhrase(plainText(item).replace(/[^\p{L}\p{N}\s'\-]/gu, ' ').replace(/^\s*(?:the|a|an|his|her|their|its)\s+/i, '').trim()).trim();
}

export interface ProposalContext {
  suggester: string;
  /** Passages already claimed by earlier proposals (this run's and other suggesters'); the gate kind avoids them. */
  claimed: Set<string>;
  /** Items this run's pickups declare, so a gate's way back can lead to one of them. */
  found?: FoundItem[];
}

/**
 * Turns a moment into a Proposal with the heuristics' own builders. A moment that names nothing usable still
 * becomes a proposal (with an empty label, an unknown item, or a line out of range) so applyProposals can drop
 * it and the drop is counted; this never throws. For a pickup, `found` lets the gate rule look for where the
 * item is used later.
 */
export function momentToProposal(project: StoryProject, passage: Passage, moment: Moment, lines: PromptLine[], ctx: ProposalContext): { proposal: Proposal; found?: FoundItem } {
  const evidence = Number.isInteger(moment.line) ? lines[moment.line - 1]?.index ?? -1 : -1;
  const next = passage.divert ?? '';
  const labels = (moment.labels ?? []).map(cleanLabel);
  const base = { kind: moment.kind, passageId: passage.id, evidence, suggester: ctx.suggester };
  switch (moment.kind) {
    case 'pickup': {
      const display = itemPhrase(moment.item ?? '');
      const itemId = slugify(display);
      const index = project.passages.indexOf(passage);
      return {
        proposal: {
          ...base,
          newItems: [{ id: itemId, displayName: itemDisplayName(display) }],
          choices: [
            { text: display ? `Take the ${display}` : '', target: next, effects: [{ type: 'give_item', itemId }] },
            { text: 'Leave it', target: next },
          ],
        },
        found: display ? { itemId, noun: headNoun(display), display, index } : undefined,
      };
    }
    case 'gate': {
      const wanted = (moment.item ?? '').trim();
      const item = project.items.find((i) => i.id === wanted || i.id === slugify(wanted) || i.displayName.toLowerCase() === wanted.toLowerCase() || i.id === slugify(itemPhrase(wanted)));
      const itemId = item?.id ?? (slugify(wanted) || 'item');
      const display = item ? item.displayName.toLowerCase() : itemPhrase(wanted);
      // The choices go in the passage before this one; the way back leads to where the item is given.
      const prev = project.passages.find((q) => q.divert === passage.id && q.choices.length === 0 && !ctx.claimed.has(q.id));
      const start = project.passages.find((q) => q.id === project.project.startPassage);
      const pickup = ctx.found?.find((f) => f.itemId === itemId);
      const giver = pickup
        ? project.passages[pickup.index]
        : project.passages.find((q) => q.choices.some((c) => c.effects.some((e) => e.type === 'give_item' && e.itemId === itemId)) || q.content.some((b) => b.type === 'effect' && b.effect.type === 'give_item' && b.effect.itemId === itemId));
      return {
        proposal: {
          ...base,
          passageId: prev?.id ?? '',
          evidencePassageId: passage.id,
          choices: [
            { text: `Use the ${display}`, target: passage.id, conditions: [{ type: 'has_item', itemId }] },
            // With no known giver the way back leads to the start; the checks then say whether the item can be had at all.
            { text: `Go back to ${(giver ?? start)?.title ?? 'the start'}`, target: (giver ?? start)?.id ?? '' },
          ],
        },
      };
    }
    case 'reply':
      return { proposal: { ...base, choices: [{ text: labels[0] ?? '', target: next }, { text: labels[1] ?? '', target: next }] } };
    case 'decision': {
      const flag = slugify(moment.flag ?? '');
      return {
        proposal: {
          ...base,
          newVariables: [{ id: flag, type: 'bool', initial: false }],
          choices: [
            { text: labels[0] ?? '', target: next, effects: [{ type: 'set_var', variableId: flag, value: true }] },
            { text: labels[1] ?? '', target: next },
          ],
        },
      };
    }
    default:
      // An unknown kind: the shape check names it.
      return { proposal: { ...base, choices: [{ text: labels[0] ?? '', target: next }, { text: labels[1] ?? '', target: next }] } };
  }
}

/** Rule-based gates for the items a model found, as the heuristics make them (see adapt.ts). */
export function gatesForFound(project: StoryProject, found: FoundItem[], claimed: Set<string>, suggester: string): Proposal[] {
  return gateProposals(project, found, claimed, suggester);
}
