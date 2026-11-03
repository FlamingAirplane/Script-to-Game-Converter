import type { CompareOp, Condition, Effect } from '../isr';

// Conditions and assignments written in Ink, SugarCube or Harlowe, read into the story model.
// Both functions return null for anything the model can't represent (arithmetic, function calls,
// temporary variables, visit counts…), so callers can keep that text instead of mangling it.
//
//   Ink:        has_key && (trust >= 2)      ~ trust += 1      ~ has_key = true
//   SugarCube:  $has_key and $trust gte 2    $trust += 1       $has_key to true
//   Harlowe:    $has_key and $trust >= 2     (set: $trust to it + 1)

type Tok = { t: 'id' | 'lit' | 'op' | '(' | ')' | 'not' | 'and' | 'or'; v: string | number | boolean };

const WORD_OPS: Record<string, CompareOp> = { is: '==', eq: '==', isnot: '!=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\s+/.exec(rest))) i += m[0].length;
    else if (rest[0] === '(' || rest[0] === ')') (out.push({ t: rest[0], v: rest[0] }), i++);
    else if ((m = /^(===|!==|==|!=|>=|<=|>|<)/.exec(rest))) (out.push({ t: 'op', v: m[1] === '===' ? '==' : m[1] === '!==' ? '!=' : m[1] }), (i += m[1].length));
    else if ((m = /^(&&|\|\|)/.exec(rest))) (out.push({ t: m[1] === '&&' ? 'and' : 'or', v: m[1] }), (i += 2));
    else if (rest[0] === '!') (out.push({ t: 'not', v: '!' }), i++);
    else if ((m = /^-?\d+(?:\.\d+)?/.exec(rest))) (out.push({ t: 'lit', v: Number(m[0]) }), (i += m[0].length));
    else if ((m = /^"([^"\\]*)"|^'([^'\\]*)'/.exec(rest))) (out.push({ t: 'lit', v: m[1] ?? m[2] }), (i += m[0].length));
    else if ((m = /^\$?[A-Za-z_]\w*/.exec(rest))) {
      const w = m[0];
      i += w.length;
      if (w === 'true' || w === 'false') out.push({ t: 'lit', v: w === 'true' });
      else if (w === 'and' || w === 'or' || w === 'not') out.push({ t: w, v: w });
      else if (w in WORD_OPS) {
        // Harlowe and SugarCube "is not".
        const n = /^\s+not\b/.exec(src.slice(i));
        if (w === 'is' && n) (out.push({ t: 'op', v: '!=' }), (i += n[0].length));
        else out.push({ t: 'op', v: WORD_OPS[w] });
      } else if (w === 'has') out.push({ t: 'id', v: 'has' });
      else if (w.startsWith('_')) return null; // temporary variables live only for one passage
      else out.push({ t: 'id', v: w.replace(/^\$/, '') });
    } else return null;
  }
  return out;
}

/** Identifiers named has_<item> are item possession; others are variables (resolved later by the builder). */
function ref(id: string): Condition {
  return { type: 'has_item', itemId: id.replace(/^has_/, '') };
}

export function parseConditionExpr(src: string): Condition | null {
  const toks = tokenize(src);
  if (!toks || !toks.length) return null;
  let pos = 0;
  const peek = () => toks[pos];
  const orExpr = (): Condition | null => {
    const parts = [andExpr()];
    while (peek()?.t === 'or') (pos++, parts.push(andExpr()));
    if (parts.some((p) => !p)) return null;
    return parts.length === 1 ? parts[0] : { type: 'or', conditions: parts as Condition[] };
  };
  const andExpr = (): Condition | null => {
    const parts = [unary()];
    while (peek()?.t === 'and') (pos++, parts.push(unary()));
    if (parts.some((p) => !p)) return null;
    return parts.length === 1 ? parts[0] : { type: 'and', conditions: parts as Condition[] };
  };
  const unary = (): Condition | null => {
    if (peek()?.t === 'not') {
      pos++;
      const c = unary();
      return c && { type: 'not', condition: c };
    }
    return primary();
  };
  const primary = (): Condition | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === '(') {
      pos++;
      const c = orExpr();
      if (peek()?.t !== ')') return null;
      pos++;
      return c;
    }
    if (t.t === 'id' && t.v === 'has' && toks[pos + 1]?.t === 'id') {
      pos += 2;
      return ref(`has_${toks[pos - 1].v}`);
    }
    // comparison: identifier op literal (either way round), or a bare identifier
    if (t.t === 'id' || t.t === 'lit') {
      pos++;
      const op = peek();
      if (op?.t === 'op') {
        pos++;
        const other = peek();
        if (!other || (other.t !== 'id' && other.t !== 'lit') || other.t === t.t) return null;
        pos++;
        const [id, lit, flip] = t.t === 'id' ? [String(t.v), other.v, false] : [String(other.v), t.v, true];
        const FLIP: Record<string, CompareOp> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=', '==': '==', '!=': '!=' };
        const cmp = (flip ? FLIP[String(op.v)] : op.v) as CompareOp;
        if (/^has_/.test(id) && typeof lit === 'boolean' && (cmp === '==' || cmp === '!=')) {
          const has = ref(id);
          return lit === (cmp === '==') ? has : { type: 'not', condition: has };
        }
        return { type: 'compare', variableId: id, op: cmp, value: lit };
      }
      return t.t === 'id' ? ref(String(t.v)) : null;
    }
    return null;
  };
  const c = orExpr();
  return c && pos === toks.length ? c : null;
}

/** One assignment: Ink "x = 1", "x += 1", "x++"; SugarCube/Harlowe "$x to 1", "$x to $x + 1", "$x += 1". */
export function parseAssignment(src: string): Effect | null {
  const s = src.trim().replace(/;$/, '');
  let m = /^\$?([A-Za-z]\w*)\s*(\+\+|--)$/.exec(s);
  if (m) return { type: 'add_var', variableId: m[1], amount: m[2] === '++' ? 1 : -1 };
  m = /^\$?([A-Za-z]\w*)\s*(\+=|-=)\s*(\d+)$/.exec(s);
  if (m) return { type: 'add_var', variableId: m[1], amount: (m[2] === '+=' ? 1 : -1) * Number(m[3]) };
  m = /^\$?([A-Za-z]\w*)\s*(?:=|\bto\b)\s*(?:\$?\1|it)\s*([+-])\s*(\d+)$/.exec(s);
  if (m) return { type: 'add_var', variableId: m[1], amount: (m[2] === '+' ? 1 : -1) * Number(m[3]) };
  m = /^\$?([A-Za-z]\w*)\s*(?:=|\bto\b)\s*(true|false|-?\d+|"[^"\\]*"|'[^'\\]*')$/.exec(s);
  if (!m) return null;
  const [, id, raw] = m;
  const value: boolean | number | string = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw.slice(1, -1);
  if (/^has_/.test(id) && typeof value === 'boolean') return { type: value ? 'give_item' : 'take_item', itemId: id.slice(4) };
  return { type: 'set_var', variableId: id, value };
}
