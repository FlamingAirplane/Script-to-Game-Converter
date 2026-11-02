import { diag, type Diagnostic } from '../diagnostics';
import { isMarkerLine, parseMarker } from './markers';
import type { ParsedBlock, Parser } from './types';

// Plain-text parser with configurable conventions. Recognises:
//  - scene headings: INT./EXT., "SCENE 3", "CHAPTER IV", "ACT 1" (configurable)
//  - inline dialogue: "MIRA: The archive is locked."  /  "Mira: ..."
//  - screenplay-style dialogue: an ALL-CAPS cue line followed by speech
//  - transitions: "CUT TO:", "FADE OUT."
// Everything else is action/prose. Ambiguous cues are flagged for review, never dropped.

export interface PlainTextConventions {
  sceneHeading: RegExp;
  inlineDialogue: boolean;
  capsCueDialogue: boolean;
}

export const DEFAULT_CONVENTIONS: PlainTextConventions = {
  sceneHeading: /^(?:(?:INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s]|(?:SCENE|CHAPTER|ACT|PART)\s+[\w\dIVXLC]+\b)/i,
  inlineDialogue: true,
  capsCueDialogue: true,
};

const TRANSITION = /^(?:[A-Z ]+ TO:|FADE (?:IN|OUT)[.:]?|FADE TO BLACK\.?|THE END\.?)$/;

export function makePlainTextParser(conv: PlainTextConventions = DEFAULT_CONVENTIONS): Parser {
  return {
    format: 'txt',
    label: 'Plain text',
    extensions: ['.txt', '.text'],
    sniff: () => 0.1,
    parse(text, documentId) {
      const diagnostics: Diagnostic[] = [];
      const blocks: ParsedBlock[] = [];
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      let para: { lines: string[]; line: number } | null = null;
      const flush = () => {
        if (para) {
          const t = para.lines.join(' ').replace(/\s+/g, ' ').trim();
          if (t) blocks.push({ kind: 'action', text: t, line: para.line, endLine: para.line + para.lines.length - 1 });
        }
        para = null;
      };
      const blank = (i: number) => i < 0 || i >= lines.length || lines[i].trim() === '';

      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        const ln = i + 1;
        if (!t) {
          flush();
          continue;
        }
        if (isMarkerLine(t)) {
          flush();
          const m = parseMarker(t);
          if (m) blocks.push({ kind: 'marker', marker: m, line: ln });
          continue;
        }
        if (para === null && conv.sceneHeading.test(t)) {
          blocks.push({ kind: 'scene', text: t.replace(/[:.]$/, ''), line: ln });
          continue;
        }
        if (para === null && TRANSITION.test(t)) {
          blocks.push({ kind: 'transition', text: t, line: ln });
          continue;
        }
        if (conv.inlineDialogue && para === null) {
          const m = /^([A-Z][A-Za-z.'’\- ]{0,30}?)(?:\s*\(([^)]*)\))?\s*:\s+(.+)$/.exec(t);
          if (m && m[1].split(/\s+/).length <= 3 && !/^(Note|Title|Author|Chapter)$/i.test(m[1])) {
            const isCaps = m[1] === m[1].toUpperCase();
            const ambiguity = isCaps ? undefined : `"${m[1]}:" may be a speaker label or a prose label.`;
            if (ambiguity)
              diagnostics.push(
                diag('PARSE_AMBIGUOUS_CUE', 'warning', 'parsing', ambiguity, {
                  source: { documentId, line: ln },
                  remediation: 'Write speaker names in CAPITALS to make dialogue unambiguous.',
                  exportBlocked: false,
                }),
              );
            blocks.push({ kind: 'dialogue', character: m[1].trim(), parenthetical: m[2], text: m[3].trim(), line: ln, ambiguity });
            continue;
          }
        }
        if (conv.capsCueDialogue && para === null && blank(i - 1) && !blank(i + 1)) {
          const name = t.replace(/\s*\([^)]*\)\s*$/, '');
          if (/[A-Z]/.test(name) && name === name.toUpperCase() && name.length <= 40 && !/[:]$/.test(name)) {
            let j = i + 1;
            let parenthetical: string | undefined;
            const speech: string[] = [];
            for (; j < lines.length && lines[j].trim(); j++) {
              const d = lines[j].trim();
              if (/^\(.*\)$/.test(d) && speech.length === 0) parenthetical = d.slice(1, -1);
              else speech.push(d);
            }
            const words = name.split(/\s+/).length;
            const ambiguity =
              words > 3 || /[.!?]$/.test(name) ? `"${name}" could be a heading or emphasis rather than a speaker.` : undefined;
            if (ambiguity)
              diagnostics.push(
                diag('PARSE_AMBIGUOUS_CUE', 'warning', 'parsing', ambiguity, {
                  source: { documentId, line: ln },
                  remediation: 'Review this line in the Review tab.',
                  exportBlocked: false,
                }),
              );
            blocks.push({ kind: 'dialogue', character: name, parenthetical, text: speech.join(' '), line: ln, endLine: j, ambiguity });
            i = j - 1;
            continue;
          }
        }
        if (!para) para = { lines: [], line: ln };
        para.lines.push(t);
      }
      flush();
      return { format: 'txt', blocks, diagnostics };
    },
  };
}

export const plainTextParser = makePlainTextParser();
