import { markupToTags, plainText } from '../emphasis';
import { isMarkerLine, parseMarker } from './markers';
import type { ParsedBlock, Parser } from './types';

// Markdown parser: headings become sections (optionally with {#anchor} ids), "**NAME:** text" or
// "NAME: text" become dialogue, "- [Text](#target)" list items become choices, HTML comments become
// notes, everything else is prose. Code fences are preserved as unsupported content for review.

export const markdownParser: Parser = {
  format: 'md',
  label: 'Markdown',
  extensions: ['.md', '.markdown'],
  sniff(text) {
    let s = 0;
    if (/^#{1,6}\s/m.test(text)) s += 0.5;
    if (/\[[^\]]+\]\(#[^)]+\)/.test(text)) s += 0.3;
    if (/\*\*[^*]+\*\*/.test(text)) s += 0.1;
    return Math.min(s, 1);
  },
  parse(text) {
    const blocks: ParsedBlock[] = [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let para: { lines: string[]; line: number } | null = null;
    const flush = () => {
      if (para) {
        const raw = para.lines.join(' ').replace(/\s+/g, ' ').trim();
        const clean = inline(raw);
        if (clean) blocks.push({ kind: 'action', text: clean, line: para.line, transformed: clean !== raw });
      }
      para = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      const ln = i + 1;
      if (!t) {
        flush();
        continue;
      }
      if (t.startsWith('```')) {
        flush();
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith('```')) j++;
        blocks.push({ kind: 'unsupported', text: lines.slice(i + 1, j).join('\n'), reason: 'Code block', line: ln, endLine: j + 1 });
        i = j;
        continue;
      }
      if (t.startsWith('<!--')) {
        flush();
        let j = i;
        while (j < lines.length && !lines[j].includes('-->')) j++;
        const body = lines.slice(i, j + 1).join('\n').replace(/^\s*<!--|-->\s*$/g, '').trim();
        blocks.push({ kind: 'note', text: body, line: ln });
        i = j;
        continue;
      }
      if (isMarkerLine(t)) {
        flush();
        const m = parseMarker(t);
        if (m) blocks.push({ kind: 'marker', marker: m, line: ln });
        continue;
      }
      const h = /^(#{1,6})\s+(.*?)(?:\s*\{#([\w-]+)\})?\s*#*$/.exec(t);
      if (h) {
        flush();
        blocks.push({ kind: 'section', depth: h[1].length, text: inline(h[2], true), anchor: h[3]?.replace(/-/g, '_'), line: ln });
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
        flush();
        continue;
      }
      const dlg = /^(?:\*\*([^*]+?):?\*\*:?|([A-Z][A-Z .'’\-]{0,30}):)\s+(.+)$/.exec(t);
      if (dlg && !para) {
        const name = (dlg[1] ?? dlg[2]).trim();
        const paren = /^\(([^)]*)\)\s*(.*)$/.exec(dlg[3]);
        blocks.push({
          kind: 'dialogue',
          character: name,
          parenthetical: paren?.[1],
          text: inline(paren ? paren[2] : dlg[3]),
          line: ln,
        });
        continue;
      }
      const quote = /^>\s?(.*)$/.exec(t);
      const listItem = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(t);
      if (listItem || quote) {
        flush();
        const body = (listItem ?? quote)![1];
        blocks.push({ kind: 'action', text: inline(body), line: ln, transformed: true });
        continue;
      }
      if (!para) para = { lines: [], line: ln };
      para.lines.push(t);
    }
    flush();
    return { format: 'md', blocks, diagnostics: [] };
  },
};

/** Inline Markdown as plain text; emphasis is kept as <i>/<b> tags (see emphasis.ts) unless `plain`. */
function inline(s: string, plain = false): string {
  const t = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const tagged = markupToTags(t, 'markdown');
  return (plain ? plainText(tagged) : tagged)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1') // Markdown backslash escapes
    .trim();
}
