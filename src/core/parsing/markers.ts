import type { CompareOp, Condition, Effect } from '../isr';
import type { Marker } from './types';

// Structured-import marker grammar, shared by all text parsers:
//   @passage <id> [Title words]      start a passage
//   @start <id>                      set the start passage
//   @end                             mark the current passage as an ending
//   -> <target>                      unconditional divert
//   @item <id> ["Display Name"] [consumable]
//   @var <id> = <true|false|number|"text">
//   @give <item>   @take <item>   @set <var> = <value>   @add <var> <n>
//   @pause                           a Continue break: what follows waits for the reader
//   * [Choice text] -> target        once-only choice
//   + {has key} [Choice text] -> target @take key     sticky, gated choice with effects
//   - [Choice text](#target)         Markdown link form

const KEYWORDS = new Set(['passage', 'start', 'end', 'pause', 'item', 'var', 'give', 'take', 'set', 'add']);

export function isMarkerLine(line: string): boolean {
  const t = line.trim();
  if (/^->\s*[A-Za-z_][\w.]*\s*$/.test(t)) return true;
  if (/^[*+]\s*(\{[^}]*\}\s*)*\[[^\]]+\]/.test(t)) return true;
  if (/^[-*]\s+\[[^\]]+\]\(#[^)]+\)/.test(t)) return true;
  const m = /^@([a-z]+)\b/.exec(t);
  return !!m && KEYWORDS.has(m[1]);
}

export function parseValue(raw: string): boolean | number | string {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  const q = /^"(.*)"$/.exec(v);
  return q ? q[1] : v;
}

export function parseCondition(src: string): Condition {
  const s = src.trim();
  const orParts = splitTop(s, /\s+(?:or|\|\|)\s+/);
  if (orParts.length > 1) return { type: 'or', conditions: orParts.map(parseCondition) };
  const andParts = splitTop(s, /\s+(?:and|&&)\s+/);
  if (andParts.length > 1) return { type: 'and', conditions: andParts.map(parseCondition) };
  let m = /^(?:not\s+|!)(.+)$/.exec(s);
  if (m) return { type: 'not', condition: parseCondition(m[1]) };
  m = /^has\s+([A-Za-z_]\w*)$/.exec(s);
  if (m) return { type: 'has_item', itemId: m[1] };
  m = /^([A-Za-z_]\w*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(s);
  if (m) return { type: 'compare', variableId: m[1], op: m[2] as CompareOp, value: parseValue(m[3]) };
  // Bare identifier: resolved to item possession or a boolean variable by the story builder.
  return { type: 'has_item', itemId: s.replace(/^has_/, '') };
}

function splitTop(s: string, re: RegExp): string[] {
  return s.split(re).map((x) => x.trim()).filter(Boolean);
}

function parseEffects(rest: string): Effect[] {
  const effects: Effect[] = [];
  const re = /@(give|take|set|add)\s+([A-Za-z_]\w*)(?:\s*=\s*("[^"]*"|\S+)|\s+(-?\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const [, kind, id, setVal, addVal] = m;
    if (kind === 'give') effects.push({ type: 'give_item', itemId: id });
    else if (kind === 'take') effects.push({ type: 'take_item', itemId: id });
    else if (kind === 'set') effects.push({ type: 'set_var', variableId: id, value: parseValue(setVal ?? 'true') });
    else effects.push({ type: 'add_var', variableId: id, amount: parseInt(addVal ?? setVal ?? '1', 10) });
  }
  return effects;
}

export function parseMarker(line: string): Marker | null {
  const t = line.trim();
  let m = /^->\s*([A-Za-z_][\w.]*)\s*$/.exec(t);
  if (m) return m[1].toUpperCase() === 'END' ? { type: 'end' } : { type: 'divert', target: m[1] };

  m = /^([*+])\s*((?:\{[^}]*\}\s*)*)\[([^\]]+)\]\s*(?:->\s*([A-Za-z_][\w.]*))?(.*)$/.exec(t);
  if (m) {
    const conds = [...m[2].matchAll(/\{([^}]*)\}/g)].map((x) => parseCondition(x[1]));
    return { type: 'choice', once: m[1] === '*', conditions: conds, text: m[3].trim(), target: m[4] ?? '', effects: parseEffects(m[5]) };
  }
  m = /^[-*]\s+\[([^\]]+)\]\(#([^)]+)\)(.*)$/.exec(t);
  if (m) return { type: 'choice', once: false, conditions: [], text: m[1].trim(), target: m[2].trim(), effects: parseEffects(m[3]) };

  m = /^@([a-z]+)\s*(.*)$/.exec(t);
  if (!m || !KEYWORDS.has(m[1])) return null;
  const [, kw, rest] = m;
  switch (kw) {
    case 'passage': {
      const p = /^([A-Za-z_][\w]*)\s*(.*)$/.exec(rest);
      return p ? { type: 'passage', id: p[1], title: p[2].trim() || undefined } : null;
    }
    case 'start':
      return rest.trim() ? { type: 'start', id: rest.trim() } : null;
    case 'end':
      return { type: 'end' };
    case 'pause':
      return { type: 'pause' };
    case 'item': {
      const p = /^([A-Za-z_]\w*)\s*(?:"([^"]*)")?\s*(consumable)?/.exec(rest);
      return p ? { type: 'item', id: p[1], displayName: p[2], consumable: !!p[3] } : null;
    }
    case 'var': {
      const p = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(rest);
      return p ? { type: 'var', id: p[1], value: parseValue(p[2]) } : null;
    }
    default: {
      const effects = parseEffects(`@${kw} ${rest}`);
      return effects.length ? { type: 'effect', effect: effects[0] } : null;
    }
  }
}
