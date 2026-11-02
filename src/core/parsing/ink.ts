import { parseCondition, parseValue } from './markers';
import type { ParsedBlock, Parser } from './types';

// Ink import/passthrough. Existing Ink is preserved verbatim for generation (see buildStory),
// and this parser only extracts enough structure — knots, stitches, choices, diverts, VARs —
// to drive graph analysis and the review UI.

export const inkParser: Parser = {
  format: 'ink',
  label: 'Ink',
  extensions: ['.ink'],
  sniff(text) {
    let s = 0;
    if (/^\s*={2,}\s*\w+\s*={0,}\s*$/m.test(text)) s += 0.5;
    if (/->\s*\w+/.test(text)) s += 0.3;
    if (/^\s*VAR\s+\w+\s*=/m.test(text)) s += 0.2;
    return Math.min(s, 1);
  },
  parse(text) {
    const blocks: ParsedBlock[] = [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let knot = '';
    let inFunction = false;
    let inComment = false;
    for (let i = 0; i < lines.length; i++) {
      let t = lines[i].trim();
      const ln = i + 1;
      if (inComment) {
        if (t.includes('*/')) inComment = false;
        continue;
      }
      if (t.startsWith('/*')) {
        if (!t.includes('*/')) inComment = true;
        continue;
      }
      t = t.replace(/\/\/.*$/, '').trim();
      if (!t || t.startsWith('INCLUDE') || t.startsWith('EXTERNAL') || t.startsWith('TODO')) continue;

      const knotM = /^={2,}\s*(function\s+)?([A-Za-z_]\w*)/.exec(t);
      if (knotM) {
        inFunction = !!knotM[1];
        if (!inFunction) {
          knot = knotM[2];
          blocks.push({ kind: 'marker', marker: { type: 'passage', id: knot, title: knot }, line: ln });
        }
        continue;
      }
      if (inFunction) continue;
      const stitchM = /^=\s*([A-Za-z_]\w*)/.exec(t);
      if (stitchM) {
        const id = `${knot}__${stitchM[1]}`;
        blocks.push({ kind: 'marker', marker: { type: 'passage', id, title: `${knot}.${stitchM[1]}` }, line: ln });
        continue;
      }
      const varM = /^(?:VAR|CONST)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(t);
      if (varM) {
        blocks.push({ kind: 'marker', marker: { type: 'var', id: varM[1], value: parseValue(varM[2]) }, line: ln });
        continue;
      }
      const choiceM = /^([*+])[\s*+]*((?:\{[^}]*\}\s*)*)(.*)$/.exec(t);
      if (choiceM) {
        const body = choiceM[3];
        let target = /->\s*([A-Za-z_][\w.]*)/.exec(body)?.[1] ?? '';
        if (!target) {
          for (let j = i + 1; j < lines.length; j++) {
            const n = lines[j].trim();
            if (/^[*+=]/.test(n)) break;
            const d = /->\s*([A-Za-z_][\w.]*)/.exec(n);
            if (d) {
              target = d[1];
              break;
            }
          }
        }
        const display = body.replace(/->.*$/, '').replace(/\[([^\]]*)\].*$/, '$1').trim() || '(choice)';
        blocks.push({
          kind: 'marker',
          marker: {
            type: 'choice',
            once: choiceM[1] === '*',
            text: display,
            target: normaliseTarget(target, knot),
            conditions: [...choiceM[2].matchAll(/\{([^}]*)\}/g)].map((x) => parseCondition(x[1])),
            effects: [],
          },
          line: ln,
        });
        continue;
      }
      const assign = /^~\s*([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(t);
      if (assign) {
        blocks.push({ kind: 'marker', marker: { type: 'effect', effect: { type: 'set_var', variableId: assign[1], value: parseValue(assign[2]) } }, line: ln });
        continue;
      }
      if (/^~/.test(t) || /^-\s*$/.test(t) || /^\{.*\}$/.test(t)) continue;
      const divertOnly = /^(?:-\s*)?->\s*([A-Za-z_][\w.]*)\s*$/.exec(t);
      if (divertOnly) {
        const target = divertOnly[1];
        blocks.push({
          kind: 'marker',
          marker: target === 'END' || target === 'DONE' ? { type: 'end' } : { type: 'divert', target: normaliseTarget(target, knot) },
          line: ln,
        });
        continue;
      }
      const speech = /^([A-Z][A-Z .'’\-]{0,30}):\s+(.*?)(?:\s+#.*)?$/.exec(t);
      if (speech) {
        blocks.push({ kind: 'dialogue', character: speech[1].trim(), text: speech[2], line: ln });
        continue;
      }
      blocks.push({ kind: 'action', text: t.replace(/\s+#.*$/, '').replace(/->.*$/, '').trim() || t, line: ln });
    }
    return { format: 'ink', blocks, diagnostics: [] };
  },
};

// Ink "knot.stitch" paths map to "knot__stitch" passage ids; a bare stitch name inside a knot
// is resolved relative to that knot by the story builder.
function normaliseTarget(target: string, knot: string): string {
  if (!target) return '';
  if (target === 'END' || target === 'DONE') return 'END';
  if (target.includes('.')) return target.replace('.', '__');
  return knot ? `${target}|${knot}` : target;
}
