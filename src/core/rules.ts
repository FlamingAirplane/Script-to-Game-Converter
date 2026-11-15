import { gateProposals, pickupProposals } from './adapt';
import { plainText } from './emphasis';
import type { StoryProject } from './isr';
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
  /\b(?:slips?|tucks?|stuffs?|slides?|scoops? up|palms?|seizes?|gathers? up|clutch(?:es)?|hides?|stows?|pries? (?:loose|free)|fish(?:es)? out|draws? out|plucks?|snags?|hoists?|shoulders?|unhooks?|catch(?:es)?|wraps? up|bundles? up)\s+(?:the|a|an|his|her|their|its)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})/i;

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
const EITHER_OR = /(?:^|[.!?]\s+)([A-Z][a-z'’-]+(?:\s+[a-z'’-]+){0,4}?),?\s+or\s+([a-z][a-z'’-]*(?:\s+[a-z'’-]+){0,4})[.!?]/;

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

/** A passage a suggestion can go in: no choices yet, a way on for the choices to lead to, not an ending or cutscene. */
const open = (p: StoryProject['passages'][number]) => !p.choices.length && !!p.divert && !p.isEnding && !p.cutscene;

/** The passage's lines as plain text by content index ('' for anything that isn't action or dialogue). */
const linesOf = (p: StoryProject['passages'][number]) => p.content.map((b) => (b.type === 'action' || b.type === 'dialogue' ? plainText(b.text) : ''));

/**
 * One proposal per passage, from the first line a rule recognises: `match` returns the two choices' labels for a
 * line (or null), and the proposal points at that line.
 */
function perLine(id: string, kind: Proposal['kind'], match: (line: string, block: StoryProject['passages'][number]['content'][number], i: number, p: StoryProject['passages'][number]) => [string, string] | null): Suggester {
  return {
    id,
    async suggest(project) {
      const proposals: Proposal[] = [];
      for (const p of project.passages) {
        if (!open(p)) continue;
        const lines = linesOf(p);
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          const labels = match(lines[i], p.content[i], i, p);
          if (!labels) continue;
          const [a, b] = labels.map(cleanLabel);
          if (!a || !b || a.toLowerCase() === b.toLowerCase()) continue;
          proposals.push({ kind, passageId: p.id, evidence: i, suggester: id, choices: [{ text: a, target: p.divert! }, { text: b, target: p.divert! }] });
          break;
        }
      }
      return proposals;
    },
  };
}

/** "Shall I open it now?": a character weighing a step out loud. The step is one way; holding back is the other. */
const SELF_QUESTION = /\b(?:Shall|Should|Must|Dare) I ([a-z][^?.!;:—]{2,48})\?/;
/** "I don't know what to do": a character at a loss, with the next step left open. */
const AT_A_LOSS = /\b(?:I (?:don[’']t|do not) know what to do|what (?:shall|should|am|can) (?:I|we) (?:to )?do|what (?:is|are) (?:I|we) to do)\b/i;

/** Dilemma rule: a character deliberating aloud ("Shall I open it now?", "What am I to do?") becomes a decision. */
export const dilemmaSuggester = perLine('rule:dilemma', 'decision', (line, b) => {
  if (b.type !== 'dialogue') return null;
  const m = SELF_QUESTION.exec(line);
  if (m) return [m[1].replace(/\s+/g, ' '), 'Not yet'];
  return AT_A_LOSS.test(line) ? ['Act now', 'Wait and see'] : null;
});

/** Something that asks to be answered or ignored. */
const PHONE = /\b(?:phone|telephone)\s+(?:rings|is ringing|starts ringing|buzzes|goes off)\b/i;
const KNOCK = /\b(?:a\s+)?knock(?:s|ing)?\s+(?:at|on)\s+the\s+door\b|\bknocking (?:within|without|outside)\b|\b(?:door ?bell|doorbell) (?:rings|sounds)\b/i;

/** Interruption rule: a phone ringing or a knock at the door, in the action, becomes a decision to answer it or not. */
export const interruptionSuggester = perLine('rule:interruption', 'decision', (line, b) => {
  if (b.type !== 'action') return null;
  if (PHONE.test(line)) return ['Answer it', 'Let it ring'];
  if (KNOCK.test(line)) return ['Open the door', 'Stay quiet'];
  return null;
});

/** "Don't call out or you'll be shot": a warning gives the reader something to defy. */
const WARNING = /\b(?:Don[’']t|Do not) ([a-z][a-z’' ]{1,30}?),? or (?:else )?(?:you|I|we|they|he|she)(?:[’']ll| will| shall)\b/;

/** Warning rule: a spoken threat ("Don't X or you'll…") becomes a decision: do X anyway, or do as told. */
export const warningSuggester = perLine('rule:warning', 'decision', (line, b) => {
  if (b.type !== 'dialogue') return null;
  const m = WARNING.exec(line);
  return m ? [`${m[1].trim()} anyway`, 'Do as you’re told'] : null;
});

/** "Promise me…", "Give me your word", "I want my daughter": a demand the reader can meet or refuse. */
const DEMAND = /\b(?:promise me|give me your (?:word|promise)|swear (?:to me|it)|I want (?:my|the|your|you to)|I insist)\b/i;

/** Demand rule: a spoken demand becomes a reply: agree or refuse. */
export const demandSuggester = perLine('rule:demand', 'reply', (line, b) => (b.type === 'dialogue' && DEMAND.test(line) ? ['Agree', 'Refuse'] : null));

/**
 * Unanswered question rule: a question that is the last spoken line of a passage ("Who's there?" before the scene
 * ends) is left for the reader to answer: answer it, or say nothing.
 */
export const lastQuestionSuggester = perLine('rule:last_question', 'reply', (line, b, i, p) => {
  if (b.type !== 'dialogue' || !line.trim().endsWith('?')) return null;
  return p.content.slice(i + 1).some((x) => x.type === 'dialogue') ? null : ['Answer', 'Say nothing'];
});

/**
 * The cheap rules, the most specific first: a passage takes only the first suggestion made for it, so the rules
 * that rarely misfire go before the question rule, which finds a question in most scenes.
 */
export const cheapRules: Suggester[] = [widerPickupSuggester, decisionSuggester, interruptionSuggester, warningSuggester, dilemmaSuggester, demandSuggester, lastQuestionSuggester, questionSuggester];

/**
 * What Interactive adaptation runs after the heuristics: every cheap rule but the question rule, which finds a question
 * in most scenes and is right too rarely (6 of 38 on the evaluation set) to put in front of writers. The evaluation
 * scores this set as its "app" row.
 */
export const appRules: Suggester[] = cheapRules.filter((s) => s !== questionSuggester);
