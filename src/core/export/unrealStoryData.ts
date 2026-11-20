import { actsOf, actTitleLine } from '../acts';
import { audioFileName } from '../audio';
import { cueSounds } from '../cues';
import { isForcing } from '../forced';
import { describeNeed, conditionHolds } from '../gating';
import { portraitFiles } from '../images';
import { cueName, cueTag, exitName, isActive, itemVar, RESERVED_TAGS, type Condition } from '../isr';
import { lineEntries } from '../lines';
import type { ProcessedStory } from '../pipeline';
import { itemVarNames, storyVersion } from './common';

// What the Unreal export knows about a story, as plain data: its passages, lines, acts, items, cues and the conditions
// of its locked choices. Written to StorySource/StoryInfo.json (schemas/unreal-story-info.schema.json); the runtime's
// UNarrativeStoryData reads it, and the same data still fills NarrativeBridgeStoryInfo.h until the runtime reads it only.

/** Bumped when a field changes meaning or goes. The runtime reads any version up to its own and ignores fields it doesn't know. */
export const STORY_INFO_SCHEMA_VERSION = 1;

export type StoryValue = boolean | number | string;

export interface StoryInfoData {
  schemaVersion: number;
  title: string;
  projectId: string;
  /** Changes whenever the generated Ink changes. Saves from another version are carried over by replaying their choices. */
  storyVersion: string;
  sourceLanguage: string;
  passages: { id: string; title: string; act: string }[];
  acts: { id: string; title: string }[];
  lines: { path: string; text: string }[];
  itemVariables: string[];
  variables: string[];
  exits: string[];
  cues: string[];
  cueTags: string[];
  cueSounds: { tag: string; file: string }[];
  portraits: { speaker: string; file: string }[];
  reservedTags: string[];
  gatedChoices: {
    passage: string;
    text: string;
    /** What it needs, in words (e.g. "Archive Key"). */
    needs: string;
    /** While it's on offer it's the only choice in its passage. */
    forced: boolean;
    /** One per condition, each holding the ISR condition tree itself. */
    requirements: { words: string; condition: Condition }[];
  }[];
}

export function storyInfoData(story: ProcessedStory): StoryInfoData {
  const lines = lineEntries(story.project);
  const entryKnots = new Set(lines.map((l) => l.entryKnot));
  const passageIds = [...story.generated.ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]).filter((k) => !entryKnots.has(k));
  const knots = new Set(passageIds);
  const acts = actsOf(story.project);
  const actIds = new Set(acts.map((a) => a.id));
  const blocks = story.project.passages.flatMap((p) => p.content);
  const cueBlocks = blocks.flatMap((b) => (b.type === 'cue' ? [b] : []));
  return {
    schemaVersion: STORY_INFO_SCHEMA_VERSION,
    title: story.project.project.title,
    projectId: story.project.project.id,
    storyVersion: storyVersion(story),
    sourceLanguage: 'en',
    passages: passageIds.map((id) => {
      const p = story.project.passages.find((x) => x.id === id);
      return { id, title: p?.title || id, act: actIds.has(p?.act ?? '') ? p!.act! : '' };
    }),
    acts: acts.map((a) => ({ id: a.id, title: actTitleLine(a.title) })),
    lines: lines.map((l) => ({ path: l.path, text: l.display })),
    itemVariables: itemVarNames(story),
    variables: story.project.variables.map((v) => v.id),
    exits: [...new Set(blocks.flatMap((b) => (b.type === 'exit' ? [exitName(b.name)] : [])))],
    cues: [...new Set(cueBlocks.map((b) => cueName(b.name)))],
    cueTags: [...new Set(cueBlocks.map((b) => cueTag(b.name, b.value)))],
    cueSounds: [...cueSounds(story.project)].map(([tag, ref]) => ({ tag, file: audioFileName(ref) })),
    portraits: Object.entries(portraitFiles(story.project)).map(([speaker, file]) => ({ speaker, file })),
    reservedTags: [...RESERVED_TAGS],
    gatedChoices: story.project.passages.flatMap((p) =>
      knots.has(p.id)
        ? p.choices
            .filter((c) => isActive(c.review) && c.conditions.length)
            .map((c) => ({
              passage: p.id,
              text: c.text.trim(),
              needs: c.conditions.map((x) => describeNeed(x, story.project)).join(', '),
              forced: isForcing(c),
              requirements: c.conditions.map((x) => ({ words: describeNeed(x, story.project), condition: x })),
            }))
        : [],
    ),
  };
}

/** One way the story's variables could be set, and whether a condition then holds, worked out by the TypeScript evaluator. */
export interface ConditionCase {
  vars: Record<string, StoryValue>;
  holds: boolean;
}

/** The variables a condition reads, with the values worth trying for each (a few around each number it compares with). */
function scenarios(c: Condition): Map<string, StoryValue[]> {
  const out = new Map<string, Set<StoryValue>>();
  const add = (name: string, ...values: StoryValue[]) => {
    const set = out.get(name) ?? new Set<StoryValue>();
    for (const v of values) set.add(v);
    out.set(name, set);
  };
  const walk = (x: Condition) => {
    if (x.type === 'has_item') add(itemVar(x.itemId), true, false);
    else if (x.type === 'not') walk(x.condition);
    else if (x.type === 'and' || x.type === 'or') x.conditions.forEach(walk);
    else if (typeof x.value === 'number') add(x.variableId, x.value - 1, x.value, x.value + 1);
    else if (typeof x.value === 'boolean') add(x.variableId, true, false);
    else add(x.variableId, x.value, `not ${x.value}`);
  };
  walk(c);
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

/** Every combination of the values worth trying, capped so a wide condition stays small. */
export function conditionCases(c: Condition, limit = 24): ConditionCase[] {
  const names = scenarios(c);
  const keys = [...names.keys()];
  const cases: ConditionCase[] = [];
  const pick = (i: number, vars: Record<string, StoryValue>) => {
    if (cases.length >= limit) return;
    if (i === keys.length) {
      cases.push({ vars: { ...vars }, holds: conditionHolds(c, (n) => vars[n]) });
      return;
    }
    for (const v of names.get(keys[i])!) pick(i + 1, { ...vars, [keys[i]]: v });
  };
  pick(0, {});
  return cases;
}

export interface ConditionCheck {
  passage: string;
  choice: string;
  requirement: number;
  cases: ConditionCase[];
}

/** The expected result of every locked choice's conditions, for the runtime's automation test to compare with. */
export function conditionChecks(data: StoryInfoData): ConditionCheck[] {
  return data.gatedChoices.flatMap((g) => g.requirements.map((r, requirement) => ({ passage: g.passage, choice: g.text, requirement, cases: conditionCases(r.condition) })));
}
