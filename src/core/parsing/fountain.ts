import { diag, type Diagnostic } from '../diagnostics';
import { markupToTags } from '../emphasis';
import { isMarkerLine, parseMarker } from './markers';
import type { ParsedBlock, Parser } from './types';

// Fountain screenplay parser (https://fountain.io/syntax). Handles title page, scene headings
// (incl. forced "." and scene numbers), characters (incl. forced "@", extensions, dual "^"),
// parentheticals, dialogue, transitions (incl. forced ">"), centered text, sections, synopses,
// notes, boneyard, page breaks, lyrics and emphasis. Unknown constructs are preserved, never dropped.

const SCENE_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 .'’\-]+TO:$/;

function isCharacterCue(line: string): boolean {
  const t = line.trim();
  if (t.startsWith('@')) return t.length > 1;
  const name = t.replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*/g, '').trim();
  return name.length > 0 && /[A-Z]/.test(name) && name === name.toUpperCase() && !/^[\d\W]+$/.test(name) && !TRANSITION_RE.test(t);
}

export const fountainParser: Parser = {
  format: 'fountain',
  label: 'Fountain screenplay',
  extensions: ['.fountain', '.spmd'],
  sniff(text) {
    let score = 0;
    if (/^(Title|Credit|Author|Draft date):/im.test(text)) score += 0.4;
    if (/^\s*(INT|EXT)[./]/m.test(text)) score += 0.4;
    if (/^[A-Z][A-Z .'’]+(\s*\([^)]*\))?\s*\n(?!\s*\n)/m.test(text)) score += 0.2;
    return Math.min(score, 1);
  },
  parse(text, documentId) {
    const diagnostics: Diagnostic[] = [];
    const blocks: ParsedBlock[] = [];
    // Normalise newlines and remove boneyard /* */ while keeping line numbers.
    const normalized = text.replace(/\r\n?/g, '\n');
    const src = normalized.replace(/\/\*[\s\S]*?\*\//g, (m, offset: number) => {
      const startLine = normalized.slice(0, offset).split('\n').length;
      blocks.push({ kind: 'note', text: `Boneyard: ${m.slice(2, -2).trim()}`, line: startLine });
      return m.replace(/[^\n]/g, '');
    });
    const lines = src.split('\n');
    let i = 0;

    // Title page: key: value pairs before the first blank line (only if the first line looks like one).
    if (/^[A-Za-z][\w ]*:/.test(lines[0] ?? '') && !isMarkerLine(lines[0])) {
      let key = '';
      for (; i < lines.length && lines[i].trim() !== ''; i++) {
        const kv = /^([A-Za-z][\w ]*):\s*(.*)$/.exec(lines[i]);
        if (kv && !/^\s/.test(lines[i])) {
          key = kv[1].trim();
          blocks.push({ kind: 'title', key, value: kv[2].trim(), line: i + 1 });
        } else if (key) {
          const last = blocks[blocks.length - 1];
          if (last.kind === 'title') last.value = (last.value ? last.value + '\n' : '') + lines[i].trim();
        }
      }
    }

    const blankBefore = (idx: number) => idx === 0 || lines[idx - 1].trim() === '';
    const blankAfter = (idx: number) => idx + 1 >= lines.length || lines[idx + 1].trim() === '';
    let actionBuf: { text: string[]; line: number } | null = null;
    const flushAction = () => {
      if (!actionBuf) return;
      const raw = actionBuf.text.join('\n').replace(/^\n+|\n+$/g, '');
      if (raw.trim()) {
        const clean = markupToTags(raw);
        blocks.push({ kind: 'action', text: clean, line: actionBuf.line, endLine: actionBuf.line + actionBuf.text.length - 1, transformed: clean !== raw });
      }
      actionBuf = null;
    };

    for (; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      const ln = i + 1;

      if (t === '') {
        flushAction();
        continue;
      }
      if (isMarkerLine(t)) {
        flushAction();
        const marker = parseMarker(t);
        if (marker) blocks.push({ kind: 'marker', marker, line: ln });
        continue;
      }
      // Inline notes [[ ]] on their own line.
      const note = /^\[\[([\s\S]*)\]\]$/.exec(t);
      if (note) {
        flushAction();
        blocks.push({ kind: 'note', text: note[1].trim(), line: ln });
        continue;
      }
      if (/^={3,}$/.test(t)) {
        flushAction();
        continue; // page break: layout only
      }
      if (t.startsWith('#')) {
        flushAction();
        const depth = /^#+/.exec(t)![0].length;
        blocks.push({ kind: 'section', text: t.slice(depth).trim(), depth, line: ln });
        continue;
      }
      if (/^=(?!=)/.test(t)) {
        flushAction();
        blocks.push({ kind: 'note', text: `Synopsis: ${t.slice(1).trim()}`, line: ln });
        continue;
      }
      // Scene heading
      if ((/^\.[A-Za-z0-9]/.test(t) && !t.startsWith('..')) || (SCENE_RE.test(t) && blankBefore(i))) {
        flushAction();
        let heading = t.startsWith('.') ? t.slice(1) : t;
        let sceneNumber: string | undefined;
        const num = /\s*#([\w.\-]+)#\s*$/.exec(heading);
        if (num) {
          sceneNumber = num[1];
          heading = heading.slice(0, num.index);
        }
        blocks.push({ kind: 'scene', text: heading.trim(), sceneNumber, line: ln });
        continue;
      }
      // Centered text
      if (/^>.*<$/.test(t)) {
        flushAction();
        blocks.push({ kind: 'action', text: markupToTags(t.slice(1, -1).trim()), line: ln, transformed: true });
        continue;
      }
      // Transition
      if (t.startsWith('>') || (TRANSITION_RE.test(t) && blankBefore(i) && blankAfter(i))) {
        flushAction();
        blocks.push({ kind: 'transition', text: t.replace(/^>\s*/, ''), line: ln });
        continue;
      }
      // Forced action
      if (t.startsWith('!')) {
        if (!actionBuf) actionBuf = { text: [], line: ln };
        actionBuf.text.push(line.replace(/^\s*!/, ''));
        continue;
      }
      // Lyrics
      if (t.startsWith('~')) {
        flushAction();
        blocks.push({ kind: 'action', text: `♪ ${markupToTags(t.slice(1).trim())}`, line: ln, transformed: true });
        continue;
      }
      // Character + dialogue
      if (blankBefore(i) && !actionBuf && isCharacterCue(t) && !blankAfter(i)) {
        flushAction();
        const cue = t.replace(/^@/, '');
        const dual = /\^\s*$/.test(cue);
        const extMatch = /\(([^)]*)\)/.exec(cue);
        const character = cue.replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        let j = i + 1;
        let parenthetical: string | undefined;
        const speech: string[] = [];
        const pendingParens: string[] = [];
        for (; j < lines.length && lines[j].trim() !== ''; j++) {
          const d = lines[j].trim();
          if (/^\(.*\)$/.test(d)) {
            if (speech.length === 0) parenthetical = d.slice(1, -1).trim();
            else pendingParens.push(d);
          } else {
            if (pendingParens.length) speech.push(...pendingParens.splice(0));
            speech.push(d.replace(/^~/, '♪ '));
          }
        }
        if (pendingParens.length) speech.push(...pendingParens);
        const raw = speech.join(' ');
        const clean = markupToTags(raw);
        const words = character.split(/\s+/).length;
        const ambiguity =
          !t.startsWith('@') && (words > 3 || /[.!?]$/.test(character))
            ? `"${character}" was read as a character cue but could be an action line or heading.`
            : undefined;
        if (ambiguity) {
          diagnostics.push(
            diag('PARSE_AMBIGUOUS_CUE', 'warning', 'parsing', ambiguity, {
              source: { documentId, line: ln },
              remediation: 'Prefix with "@" to force a character, or "!" to force action.',
              exportBlocked: false,
            }),
          );
        }
        blocks.push({
          kind: 'dialogue',
          character,
          extension: extMatch?.[1],
          parenthetical,
          text: clean,
          dual,
          line: ln,
          endLine: j,
          ambiguity,
          transformed: clean !== raw,
        });
        i = j - 1;
        continue;
      }
      // Action (multi-line paragraphs are kept together)
      if (!actionBuf) actionBuf = { text: [], line: ln };
      actionBuf.text.push(line.replace(/^\t+/, ''));
    }
    flushAction();

    return { format: 'fountain', blocks, diagnostics };
  },
};
