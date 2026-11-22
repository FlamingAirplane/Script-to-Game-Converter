import { choiceGuards } from './forced';
import { isActive, type Choice, type Condition, type Passage } from './isr';

// Where a passage leads: which choices it offers (with the extra conditions a forced choice gives the others), and
// where the story goes when it offers none, or none can be taken. The Ink, the Twine export and the Ren'Py export all
// ask this one function, so they cannot disagree about it; each only writes the answer in its own language.

export interface FlowChoice {
  choice: Choice;
  /** The conditions the writer gave the choice. */
  own: Condition[];
  /** What a forced choice of the passage adds: this choice is kept out while it applies (see forced.ts). */
  guards: Condition[];
  /** All of them: what must hold for the choice to be offered. */
  conditions: Condition[];
}

export interface PassageFlow {
  /** The approved choices, in order. */
  choices: FlowChoice[];
  /**
   * Where the story goes when the passage offers no choice, or none can be taken: a passage id, or 'END'. Null when it
   * goes nowhere (a passage with choices that is not an ending and has no "then": the story waits at the choices).
   */
  then: string | null;
  /**
   * Whether `then` can be reached while the passage has choices: only when every choice can be unavailable (it has a
   * condition, or is once-only). Otherwise some choice is always on offer and the fallback is never taken.
   */
  thenIsReachable: boolean;
}

export function passageFlow(p: Pick<Passage, 'choices' | 'divert' | 'isEnding'>): PassageFlow {
  const guards = choiceGuards(p);
  const choices = p.choices
    .filter((c) => isActive(c.review))
    .map((choice) => {
      const g = guards.get(choice.id) ?? [];
      return { choice, own: choice.conditions, guards: g, conditions: [...choice.conditions, ...g] };
    });
  const then = p.divert ?? (p.isEnding || !choices.length ? 'END' : null);
  return { choices, then, thenIsReachable: then !== null && (!choices.length || choices.every((c) => c.conditions.length > 0 || c.choice.once)) };
}
