import { gateProposals, pickupProposals } from './adapt';
import { plainText } from './emphasis';
import { cleanLabel, firstSentence, type Proposal, type Suggester } from './proposals';

// Two cheap rules beside the heuristics in adapt.ts. They set the bar an on-device model has to clear
// (see scripts/adapt-eval.ts), and are suggesters in their own right.

/**
 * Question rule: a spoken line with a question in it, answered by another character in the same passage,
 * becomes a reply: the answer as written (its first sentence) or saying nothing. Both lead on.
 */
export const questionSuggester: Suggester = {
  id: 'rule:question',
  async suggest(project) {
    const proposals: Proposal[] = [];
    for (const p of project.passages) {
      if (p.choices.length || !p.divert || p.isEnding || p.cutscene) continue;
      for (let i = 0; i < p.content.length; i++) {
        const q = p.content[i];
        if (q.type !== 'dialogue' || !plainText(q.text).includes('?')) continue;
        const a = p.content.slice(i + 1).find((b) => b.type === 'dialogue' || b.type === 'pause' || b.type === 'exit');
        if (!a || a.type !== 'dialogue' || a.speakerId === q.speakerId) continue;
        const answer = cleanLabel(firstSentence(plainText(a.text)));
        if (!answer || answer.toLowerCase() === 'say nothing') continue;
        proposals.push({
          kind: 'reply',
          passageId: p.id,
          evidence: i,
          suggester: this.id,
          choices: [{ text: answer, target: p.divert }, { text: 'Say nothing', target: p.divert }],
        });
        break;
      }
    }
    return proposals;
  },
};

/** Ways of taking something that ACQUIRE in adapt.ts misses: "slips the letter into her pocket", "scoops up the coins". */
export const WIDE_ACQUIRE =
  /\b(?:slips?|tucks?|stuffs?|slides?|scoops? up|palms?|seizes?|gathers? up|clutch(?:es)?|hides?|stows?|pries? (?:loose|free)|fish(?:es)? out|draws? out|plucks?|snags?|hoists?|shoulders?|unhooks?|catch(?:es)?|wraps? up|bundles? up)\s+(?:the|a|an|his|her|their|its)\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})/i;

/** Wider pickup verbs: the pickup and gate rules from adapt.ts, run with WIDE_ACQUIRE. */
export const widerPickupSuggester: Suggester = {
  id: 'rule:wider_pickup',
  async suggest(project) {
    const claimed = new Set<string>();
    const { proposals, found } = pickupProposals(project, { pattern: WIDE_ACQUIRE, suggester: this.id, claimed });
    return [...proposals, ...gateProposals(project, found, claimed, this.id)];
  },
};



/** A line that tells the reader the moment is theirs to decide. */
const DECISION_CUE = /\b(?:decide|choose|your choice|up to you|what (?:will|do) you do|make (?:up )?your mind|now or never|no (?:more )?time)\b/i;
/** "Take it, or walk away." / "Stay and fight or run": two ways to go on, an imperative or a short phrase each side of "or". */
const EITHER_OR = /(?:^|[.!?]\s+)([A-Z][a-z'’\-]+(?:\s+[a-z'’\-]+){0,4}?),?\s+or\s+([a-z][a-z'’\-]*(?:\s+[a-z'’\-]+){0,4})[.!?]/;

/**
 * Decision rule: a passage whose text offers two ways to go on ("Take it, or walk away") and says the moment is the
 * reader's to decide ("But decide now") becomes a decision with those two ways as its choices, both leading on.
 * The cue is required, so the many ordinary "or"s in dialogue aren't taken for choices.
 */
export const decisionSuggester: Suggester = {
  id: 'rule:decision',
  async suggest(project) {
    const proposals: Proposal[] = [];
    for (const p of project.passages) {
      if (p.choices.length || !p.divert || p.isEnding || p.cutscene) continue;
      const lines = p.content.map((b) => (b.type === 'action' || b.type === 'dialogue' ? plainText(b.text) : ''));
      for (let i = 0; i < lines.length; i++) {
        const m = EITHER_OR.exec(lines[i]);
        if (!m) continue;
        const cued = lines.slice(i, i + 3).some((l) => DECISION_CUE.test(l));
        if (!cued) continue;
        const a = cleanLabel(m[1]);
        const b = cleanLabel(m[2]);
        if (!a || !b || a.toLowerCase() === b.toLowerCase()) continue;
        proposals.push({ kind: 'decision', passageId: p.id, evidence: i, suggester: this.id, choices: [{ text: a, target: p.divert }, { text: b, target: p.divert }] });
        break;
      }
    }
    return proposals;
  },
};

export const cheapRules: Suggester[] = [questionSuggester, widerPickupSuggester, decisionSuggester];
