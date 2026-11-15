import { diag } from '../diagnostics';
import type { ParsedBlock, ParsedDocument } from './types';

// Novel-style prose, read after the format's own parser. It finds two things a screenplay parser doesn't:
//  - speech in quotation marks with a speech tag: “Take it,” said Mira. / Mira said, “Take it.” / “Go,” she said.
//    becomes a line spoken by that character (a pronoun means the last speaker named; an untagged reply in a
//    back-and-forth goes to the other of the last two speakers). Guesses are marked for review.
//  - breaks between sections (* * *, ---, #) and chapter lines (Chapter One, Prologue), which start a new scene.
// A quotation without a speech tag in the middle of narration (The sign reads “KEEP OUT”.) stays narration.

const SAID =
  '(?:said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|muttered|mutters|called|calls|cried|cries|snapped|snaps|added|adds|continued|continues|murmured|murmurs|demanded|demands|insisted|insists|sighed|sighs|laughed|laughs|growled|growls|yelled|yells|began|begins|went on|goes on|repeated|repeats|agreed|agrees|warned|warns|offered|offers|admitted|admits|told|tells)';
const NAME = "([A-Z][A-Za-z'’\\-]+(?:\\s(?:[A-Z][A-Za-z'’\\-]+|[A-Z]\\.))?(?:\\s[A-Z][A-Za-z'’\\-]+)?)";
const PRONOUN = '(?:he|she|they)';
/** Capitalised words that open a sentence but aren't anyone's name. */
const NOT_A_NAME = /^(?:The|A|An|He|She|They|It|We|I|You|Then|And|But|So|Nobody|Someone|Somebody|Everyone|No|Yes|There|This|That|His|Her|Their|My|Our|Your|When|After|Before|Finally|Suddenly)$/;

const NAME_SAID = new RegExp(`\\b${NAME}\\s+${SAID}\\b`);
const SAID_NAME = new RegExp(`\\b${SAID}\\s+${NAME}`);
const PRONOUN_SAID = new RegExp(`\\b${PRONOUN}\\s+${SAID}\\b|\\b${SAID}\\s+${PRONOUN}\\b`, 'i');
/** A speech tag and nothing else, e.g. ", said Mira." or "she asked," (what's left over is dropped, not kept as narration). */
const ONLY_A_TAG = new RegExp(`^[\\s,.:;—–-]*(?:${NAME}\\s+${SAID}|${SAID}\\s+${NAME}|${PRONOUN}\\s+${SAID}|${SAID}\\s+${PRONOUN})[\\s,.:;—–-]*$`, 'i');

const QUOTE = /[“"]([^“”"]+)[”"]/g;
const SECTION_BREAK = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:~\s*){3,}|(?:#\s*){1,3}|⁂|(?:•\s*){3,})$/;
const CHAPTER_LINE = /^(?:(?:chapter|part|book)\s+[\w\d]+(?:\s*[:.—–-]\s*.{1,60})?|prologue|epilogue|interlude)$/i;

type Segment = { quote: boolean; text: string };

function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(QUOTE)) {
    if (m.index > at) out.push({ quote: false, text: text.slice(at, m.index) });
    out.push({ quote: true, text: m[1].trim() });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ quote: false, text: text.slice(at) });
  return out.filter((s) => s.text.trim());
}

/** Who a narration segment says is speaking: a name, 'pronoun', or nothing. */
function tagged(narration: string): { name?: string; pronoun?: boolean } {
  for (const re of [NAME_SAID, SAID_NAME]) {
    const m = re.exec(narration);
    const name = m?.[1];
    // "Then Mira said": the name is the last word or two, not the word that opens the sentence.
    const words = name?.split(/\s+/).filter((w) => !NOT_A_NAME.test(w));
    if (words?.length) return { name: words.join(' ') };
  }
  return PRONOUN_SAID.test(narration) ? { pronoun: true } : {};
}

export interface ProseOptions {
  /** Read quoted speech (off for a screenplay that already has speakers). */
  speech: boolean;
  /** Turn section breaks and chapter lines into scenes (off when the document is divided by headings). */
  breaks: boolean;
}

/** What the prose pass makes of a document's narration; the document is returned as it was when nothing applies. */
export function readProse(doc: ParsedDocument, documentId: string, options: ProseOptions): ParsedDocument {
  const blocks: ParsedBlock[] = [];
  const guessed: number[] = [];
  let changed = false;
  let section = 1;
  // The last two different speakers, most recent first.
  let recent: string[] = [];
  const spoke = (name: string) => (recent = [name, ...recent.filter((n) => n.toUpperCase() !== name.toUpperCase())].slice(0, 2));
  let lastWasSpeech = false;

  for (const b of doc.blocks) {
    if (b.kind === 'dialogue') {
      spoke(b.character);
      lastWasSpeech = true;
      blocks.push(b);
      continue;
    }
    if (b.kind !== 'action') {
      if (b.kind === 'scene' || b.kind === 'section') recent = [];
      lastWasSpeech = false;
      blocks.push(b);
      continue;
    }
    const text = b.text.trim();
    if (options.breaks && SECTION_BREAK.test(text)) {
      blocks.push({ kind: 'scene', text: `Section ${++section}`, line: b.line, transformed: true });
      recent = [];
      lastWasSpeech = false;
      changed = true;
      continue;
    }
    if (options.breaks && CHAPTER_LINE.test(text)) {
      blocks.push({ kind: 'scene', text: text.replace(/[:.]$/, ''), line: b.line });
      recent = [];
      lastWasSpeech = false;
      changed = true;
      continue;
    }
    const parts = options.speech ? segments(text) : [];
    if (!parts.some((p) => p.quote)) {
      lastWasSpeech = false;
      blocks.push(b);
      continue;
    }
    const narration = parts.filter((p) => !p.quote).map((p) => p.text).join(' ');
    const tag = tagged(narration);
    let speaker: string | undefined = tag.name;
    let guess: string | undefined;
    if (!speaker && tag.pronoun && recent[0]) {
      speaker = recent[0];
      guess = `The script says only “he”, “she” or “they” here; ${speaker} was the last speaker named.`;
    } else if (!speaker && !narration.trim() && lastWasSpeech && recent.length === 2) {
      // A reply with no speech tag, in the middle of an exchange: the other of the two.
      speaker = recent[1];
      guess = `No speaker is named here; ${speaker} is the other voice in this exchange.`;
    }
    if (!speaker) {
      lastWasSpeech = false;
      blocks.push(b);
      continue;
    }
    changed = true;
    if (guess) guessed.push(b.line);
    for (const p of parts) {
      if (p.quote) blocks.push({ kind: 'dialogue', character: speaker, text: p.text.replace(/,$/, '.'), line: b.line, endLine: b.endLine, transformed: true, ambiguity: guess });
      else if (!ONLY_A_TAG.test(p.text)) {
        const kept = p.text.replace(/^[\s,;]+|[\s,;]+$/g, '');
        if (/[A-Za-z]{2}/.test(kept)) blocks.push({ kind: 'action', text: kept, line: b.line, endLine: b.endLine, transformed: true });
      }
    }
    spoke(speaker);
    lastWasSpeech = true;
  }

  if (!changed) return doc;
  const diagnostics = [...doc.diagnostics];
  if (guessed.length)
    diagnostics.push(
      diag('PARSE_AMBIGUOUS_CUE', 'warning', 'parsing', `${guessed.length} spoken line${guessed.length === 1 ? ' was' : 's were'} given to a character by a guess (a “she said” with no name, or a reply with no speech tag), first at line ${guessed[0]}.`, {
        source: { documentId, line: guessed[0] },
        remediation: 'Check who speaks these lines in the Review tab, or name the speaker in the script (“said Mira”).',
        exportBlocked: false,
      }),
    );
  return { ...doc, blocks, diagnostics };
}
