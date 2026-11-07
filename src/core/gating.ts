import { forcedOffered } from './forced';
import { isActive, itemVar, type Choice, type Condition, type StoryProject } from './isr';

// Gated choices: choices that need an item or a value. Playtest uses these to show the ones the reader
// can't take yet, and what each one needs.

/** Whether a condition holds, given a way to read Ink variables (items are `has_<item>`). */
export function conditionHolds(c: Condition, read: (name: string) => unknown): boolean {
  switch (c.type) {
    case 'has_item':
      return read(itemVar(c.itemId)) === true;
    case 'not':
      return !conditionHolds(c.condition, read);
    case 'and':
      return c.conditions.every((x) => conditionHolds(x, read));
    case 'or':
      return c.conditions.some((x) => conditionHolds(x, read));
    case 'compare': {
      const v = read(c.variableId) as never;
      const w = c.value as never;
      switch (c.op) {
        case '==':
          return v === w;
        case '!=':
          return v !== w;
        case '<':
          return v < w;
        case '<=':
          return v <= w;
        case '>':
          return v > w;
        case '>=':
          return v >= w;
      }
    }
  }
  return false;
}

/** A condition in plain words, e.g. "Archive Key", "no Lamp", "trust at least 2". */
export function describeCondition(c: Condition, project: StoryProject): string {
  const item = (id: string) => project.items.find((i) => i.id === id)?.displayName ?? id;
  const value = (v: unknown) => (typeof v === 'string' ? `"${v}"` : v === true ? 'yes' : v === false ? 'no' : String(v));
  const part = (x: Condition) => (x.type === 'and' || x.type === 'or' ? `(${describeCondition(x, project)})` : describeCondition(x, project));
  switch (c.type) {
    case 'has_item':
      return item(c.itemId);
    case 'not':
      return c.condition.type === 'has_item' ? `no ${item(c.condition.itemId)}` : `not ${part(c.condition)}`;
    case 'and':
      return c.conditions.map(part).join(' and ');
    case 'or':
      return c.conditions.map(part).join(' or ');
    case 'compare': {
      const words: Record<string, string> = { '==': 'is', '!=': 'is not', '<': 'below', '<=': 'at most', '>': 'above', '>=': 'at least' };
      return `${c.variableId} ${words[c.op]} ${value(c.value)}`;
    }
  }
}

export interface LockedChoice {
  choice: Choice;
  /** The conditions that don't hold, in plain words. */
  needs: string[];
}

/**
 * The approved choices of a passage that the reader can't take right now because a condition fails.
 * `offered` is the text of the choices the story is offering, so nothing is listed twice.
 */
export function lockedChoices(project: StoryProject, passageId: string, read: (name: string) => unknown, offered: string[]): LockedChoice[] {
  const passage = project.passages.find((p) => p.id === passageId);
  // While a forced choice applies, it's the only way on: nothing else is shown, not even as locked.
  if (!passage || forcedOffered(passage, offered)) return [];
  const out: LockedChoice[] = [];
  for (const choice of passage.choices) {
    if (!isActive(choice.review) || !choice.conditions.length || offered.includes(choice.text)) continue;
    const failing = choice.conditions.filter((c) => !conditionHolds(c, read));
    if (failing.length) out.push({ choice, needs: failing.map((c) => describeCondition(c, project)) });
  }
  return out;
}
