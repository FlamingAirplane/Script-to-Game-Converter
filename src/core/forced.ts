import { isActive, type Choice, type Condition, type Passage } from './isr';

// Forced choices: a choice marked forced becomes the only choice in its passage while its condition holds (for
// example, once the player has the brass key, "Use the brass key" is the only way on). It works in plain Ink, so
// every player and engine gets it: each other choice in the passage is given an extra condition, "not (the forced
// choice's condition)", so it's left out while the forced one applies. If two forced choices apply at once, the
// first one wins.

/** All of a choice's conditions as one. */
function allOf(conditions: Condition[]): Condition {
  return conditions.length === 1 ? conditions[0] : { type: 'and', conditions };
}

/** The condition that keeps other choices out while this forced choice applies. */
export function forcedGuard(c: Pick<Choice, 'conditions'>): Condition {
  return { type: 'not', condition: allOf(c.conditions) };
}

/** Whether a choice is forced in a way that does anything (forced, approved, and with a condition). */
export function isForcing(c: Choice): boolean {
  return !!c.forced && isActive(c.review) && c.conditions.length > 0;
}

/** The extra conditions each approved choice of a passage gets in the Ink, by choice id (empty when none). */
export function choiceGuards(p: Pick<Passage, 'choices'>): Map<string, Condition[]> {
  const active = p.choices.filter((c) => isActive(c.review));
  const forcing = active.filter(isForcing);
  const out = new Map<string, Condition[]>();
  for (const c of active) {
    // A forced choice gives way only to forced choices before it; any other choice gives way to them all.
    const before = isForcing(c) ? forcing.slice(0, forcing.indexOf(c)) : forcing;
    out.set(c.id, before.map(forcedGuard));
  }
  return out;
}

/** The same condition, whatever order its fields were written in. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
const same = (a: Condition, b: Condition) => canonical(a) === canonical(b);

/**
 * Takes the extra conditions back off a passage's choices (for Ink brought back in, where they're written out): each
 * choice loses the conditions choiceGuards would add, once each.
 */
export function stripGuards(p: Pick<Passage, 'choices'>): void {
  const strip = (c: Choice, guards: Condition[]) => {
    for (const g of guards) {
      const i = c.conditions.findIndex((x) => same(x, g));
      if (i >= 0) c.conditions.splice(i, 1);
    }
  };
  // Forced choices first, in order: each one's guards come from the forced choices before it, cleaned already.
  const active = p.choices.filter((c) => isActive(c.review));
  const forcing = active.filter(isForcing);
  forcing.forEach((f, i) => strip(f, forcing.slice(0, i).map(forcedGuard)));
  for (const c of active) if (!isForcing(c)) strip(c, forcing.map(forcedGuard));
}

/** Whether, of the choices on offer (by text), one is a forced choice of this passage: then nothing is shown as locked. */
export function forcedOffered(p: Pick<Passage, 'choices'> | undefined, offered: string[]): boolean {
  return !!p && p.choices.some((c) => isForcing(c) && offered.includes(c.text));
}
