import { diag, type Diagnostic } from '../diagnostics';
import { slugify, uniqueId, type Condition, type Effect } from '../isr';
import { parseAssignment, parseConditionExpr } from './expr';
import type { ParsedBlock, Parser } from './types';

// Twine import: Twee 3 (and Twee 1) source, as exported by Twine 2 (Build → Export as Twee), Tweego,
// or Narrative Bridge. Twine's .html files are converted to Twee first (see convert.ts).
//
// Passages become passages, links become choices, and the common story-format logic becomes the
// story model's conditions and effects: SugarCube <<if>> / <<set>> / setter links and Harlowe
// (if:) / (set:). Narrative Bridge's own export (scene, speaker and transition marks, once-only
// flags, "Continue" fallbacks) comes back as it was. Anything else (other macros, multi-line
// conditional text, scripts) is kept as a note so it is visible in Review rather than lost.

interface TweePassage {
  name: string;
  tags: string[];
  line: number;
  body: string;
}

const SPECIAL = /^(StoryTitle|StoryData|StoryInit|StoryStylesheet|StoryScript|StoryCaption|StoryMenu|StoryBanner|StorySubtitle|StoryAuthor|StoryInterface|StoryShare|PassageReady|PassageDone|PassageHeader|PassageFooter)$/;
const CODE_TAGS = new Set(['script', 'stylesheet', 'widget', 'Twine.private', 'annotation']);
const SCENE_START = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const LINK = /\[\[((?:[^\]]|\](?!\]))*?)\](?:\[([^\]]*)\])?\]/g;

function unescapeName(s: string): string {
  return s.replace(/\\(.)/g, '$1').trim();
}

export function splitTwee(text: string): TweePassage[] {
  const passages: TweePassage[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let cur: TweePassage | null = null;
  const body: string[] = [];
  const close = () => {
    if (cur) passages.push({ ...cur, body: body.join('\n').replace(/\s+$/, '') });
    body.length = 0;
  };
  lines.forEach((l, i) => {
    const m = /^::\s*((?:\\.|[^\\[{])*?)\s*(?:\[((?:\\.|[^\]\\])*)\])?\s*(\{.*\})?\s*$/.exec(l);
    if (m) {
      close();
      cur = { name: unescapeName(m[1]), tags: (m[2] ?? '').split(/\s+/).filter(Boolean), line: i + 1, body: '' };
    } else if (cur) body.push(l);
  });
  close();
  return passages;
}

/** "A->B", "B<-A", "A|B", "B": the text shown and the passage it leads to. */
function parseLinkInner(inner: string): { text: string; target: string } {
  let m = /^(.*)->(.*)$/s.exec(inner);
  if (m) return { text: m[1].trim(), target: m[2].trim() };
  m = /^(.*?)<-(.*)$/s.exec(inner);
  if (m) return { text: m[2].trim(), target: m[1].trim() };
  m = /^(.*)\|(.*)$/s.exec(inner);
  if (m) return { text: m[1].trim(), target: m[2].trim() };
  return { text: inner.trim(), target: inner.trim() };
}

/** Splits a SugarCube setter list "$a to 1, $b += 2" on top-level commas. */
function splitSetters(s: string): string[] {
  const out: string[] = [];
  let cur = '', q = '', depth = 0;
  for (const ch of s) {
    if (q) (cur += ch), ch === q && (q = '');
    else if (ch === '"' || ch === "'") (q = ch), (cur += ch);
    else if (ch === '(') depth++, (cur += ch);
    else if (ch === ')') depth--, (cur += ch);
    else if (ch === ',' && depth === 0) out.push(cur), (cur = '');
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Removes formatting marks (bold, italic, underline) that the story model doesn't keep. */
function plainText(s: string): string {
  return s
    .replace(/''(.+?)''/g, '$1')
    .replace(/\/\/(.+?)\/\//g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:span|div|p|em|strong|i|b|u)(?:\s[^>]*)?>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+$/gm, '');
}

export const tweeParser: Parser = {
  format: 'twee',
  label: 'Twine (Twee)',
  extensions: ['.twee', '.tw'],
  sniff(text) {
    let s = 0;
    if (/^::\s*Story(?:Title|Data)\b/m.test(text)) s += 0.7;
    if ((text.match(/^::\s*\S/gm) ?? []).length >= 2) s += 0.2;
    if (/\[\[[^\]]+\]\]/.test(text)) s += 0.2;
    return Math.min(s, 1);
  },
  parse(text, documentId) {
    const blocks: ParsedBlock[] = [];
    const diagnostics: Diagnostic[] = [];
    const passages = splitTwee(text);
    const skipped: string[] = [];

    // Passage names → ids (links refer to names).
    const taken = new Set<string>();
    const ids = new Map<string, string>();
    const story = passages.filter((p) => !SPECIAL.test(p.name) && !p.tags.some((t) => CODE_TAGS.has(t)) && !p.tags.includes('startup'));
    // Parts of a passage split at Continue breaks ("Name (continued)") are merged back into it.
    const next = continuations(story);
    const parts = new Set([...next.values()].map((q) => q.name));
    for (const p of story) if (!parts.has(p.name)) ids.set(p.name, uniqueId(p.name, taken, 'passage'));
    const idOf = (name: string) => ids.get(name) ?? (slugify(name) || 'passage');

    let format = '';
    let start = '';
    for (const p of passages) {
      if (p.name === 'StoryTitle' && p.body.trim()) blocks.push({ kind: 'title', key: 'title', value: p.body.trim(), line: p.line });
      else if (p.name === 'StoryData') {
        try {
          const data = JSON.parse(p.body) as { start?: string; format?: string };
          if (data.start) start = data.start;
          format = data.format ?? '';
        } catch {
          diagnostics.push(diag('TWINE_STORYDATA', 'warning', 'parsing', 'The StoryData passage is not valid JSON, so the start passage was guessed.', { entityId: documentId, exportBlocked: false }));
        }
      } else if (p.name === 'StoryInit' || p.tags.includes('startup')) blocks.push(...declarations(p));
      else if (SPECIAL.test(p.name) || p.tags.some((t) => CODE_TAGS.has(t))) skipped.push(p.name);
    }
    start ||= story.find((p) => p.name === 'Start')?.name ?? story[0]?.name ?? '';
    if (start && ids.has(start)) blocks.push({ kind: 'marker', marker: { type: 'start', id: idOf(start) }, line: 1 });
    if (skipped.length)
      diagnostics.push(
        diag('TWINE_CODE_SKIPPED', 'info', 'parsing', `Left out ${skipped.length} Twine passage${skipped.length === 1 ? '' : 's'} of code or styling (${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}). They stay in the original file.`, {
          entityId: documentId,
          exportBlocked: false,
        }),
      );
    if (format && !/^(SugarCube|Harlowe|Chapbook|Snowman)$/i.test(format))
      diagnostics.push(diag('TWINE_FORMAT', 'info', 'parsing', `This story uses the ${format} story format; its links and text are imported, but its own code may not be.`, { entityId: documentId, exportBlocked: false }));

    for (const p of story) {
      if (parts.has(p.name)) continue;
      blocks.push({ kind: 'marker', marker: { type: 'passage', id: idOf(p.name), title: p.name }, line: p.line });
      for (let part: TweePassage | undefined = p, first = true; part; first = false) {
        const after = next.get(part.name);
        if (part.tags.includes('ending')) blocks.push({ kind: 'marker', marker: { type: 'end' }, line: part.line });
        blocks.push(...passageBlocks(part, idOf, { continueTo: after?.name, continued: !first }));
        if (after) blocks.push({ kind: 'marker', marker: { type: 'pause' }, line: after.line });
        part = after;
      }
    }
    return { format: 'twee', blocks, diagnostics };
  },
};

/** The [[…]] links in a passage body, as written. */
function linksIn(body: string): { text: string; target: string }[] {
  return [...body.matchAll(LINK)].map((l) => parseLinkInner(l[1]));
}

/**
 * Continue breaks come back from Twine as "Name" → "Name (continued)" (see export/twine.ts). A
 * passage Q is the next part of P when Q is named "… (continued[ n])", P's only link is
 * [[Continue->Q]], and nothing else links to Q. Returns P's name → Q.
 */
function continuations(story: TweePassage[]): Map<string, TweePassage> {
  const incoming = new Map<string, number>();
  for (const p of story) for (const l of linksIn(p.body)) incoming.set(l.target, (incoming.get(l.target) ?? 0) + 1);
  const byName = new Map(story.map((p) => [p.name, p]));
  const out = new Map<string, TweePassage>();
  for (const p of story) {
    const links = linksIn(p.body);
    if (links.length !== 1 || !/^continue$/i.test(links[0].text)) continue;
    const q = byName.get(links[0].target);
    if (q && q !== p && /\(continued(?: \d+)?\)′*$/.test(q.name) && incoming.get(q.name) === 1) out.set(p.name, q);
  }
  return out;
}

/** StoryInit / startup passages: variables and items. */
function declarations(p: TweePassage): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const body = p.body.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/\n/g, ' '));
  body.split('\n').forEach((line, i) => {
    const ln = p.line + 1 + i;
    const display = /\/\*\s*(.*?)\s*\*\//.exec(line)?.[1];
    for (const m of line.matchAll(/<<set\s+([\s\S]*?)>>|\(set:\s*([\s\S]*?)\)/g)) {
      for (const part of splitSetters((m[1] ?? m[2]).replace(/\s+into\s+/, ' to '))) {
        const e = parseAssignment(part);
        if (!e) out.push({ kind: 'unsupported', text: m[0], reason: 'Twine set-up code', line: ln });
        else if (e.type === 'give_item' || e.type === 'take_item') out.push({ kind: 'marker', marker: { type: 'item', id: e.itemId, displayName: display && !/^Made with/.test(display) ? display : undefined, consumable: false }, line: ln });
        else if (e.type === 'set_var' && !/^once_/.test(e.variableId)) out.push({ kind: 'marker', marker: { type: 'var', id: e.variableId, value: e.value }, line: ln });
      }
    }
  });
  return out;
}

type Link = { text: string; target: string; effects: Effect[]; conditions: Condition[]; once: boolean };

/** Strips Narrative Bridge's once-only flag ($once_<id>) from a condition, reporting whether it was there. */
function takeOnce(c: Condition | null): { cond: Condition | null; once: boolean } {
  if (!c) return { cond: null, once: false };
  const isOnce = (x: Condition) => x.type === 'not' && x.condition.type === 'has_item' && /^once_/.test(x.condition.itemId);
  if (isOnce(c)) return { cond: null, once: true };
  if (c.type === 'and' && c.conditions.some(isOnce)) {
    const rest = c.conditions.filter((x) => !isOnce(x));
    return { cond: rest.length === 1 ? rest[0] : { type: 'and', conditions: rest }, once: true };
  }
  return { cond: c, once: false };
}

/** `continueTo`: the next part of this passage (its Continue link is a break, not a route); `continued`: this is a later part. */
function passageBlocks(p: TweePassage, idOf: (name: string) => string, opts: { continueTo?: string; continued?: boolean } = {}): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const links: (Link & { line: number })[] = [];
  let body = p.body;
  // Narrative Bridge's earlier exports wrapped dialogue in HTML spans.
  body = body
    .replace(/<span class="dialogue"><span class="speaker">(.*?)<\/span>(?:<span class="paren">(.*?)<\/span>)?(.*?)<\/span>/g, (_, who, paren, line) => `@@.speaker;${who}@@${paren ? ` //${paren}//` : ''}\n${line}`)
    .replace(/<span class="(scene|transition|end)">(.*?)<\/span>/g, '@@.$1;$2@@');
  // Verbatim text is literal: protect it from link and macro parsing.
  const verbatim: string[] = [];
  body = body.replace(/"""([\s\S]*?)"""|<nowiki>([\s\S]*?)<\/nowiki>/g, (_, a, b) => `\u0000${verbatim.push((a ?? b).replace(/​/g, '')) - 1}\u0000`);
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => verbatim[Number(i)]);
  body = body.replace(/\\\n/g, '\n'); // SugarCube line continuations: the parts are separate lines here
  // Comments become notes (and Narrative Bridge's "Not converted" notes come back as such).
  body = body.replace(/\/\*([\s\S]*?)\*\/|<!--([\s\S]*?)-->/g, (_, a, b) => {
    const c = (a ?? b).trim();
    const nc = /^Not converted \((.*?)\):\s*([\s\S]*)$/.exec(c);
    if (nc) out.push({ kind: 'unsupported', text: nc[2], reason: nc[1], line: p.line });
    else if (c) out.push({ kind: 'note', text: c.replace(/^Note:\s*/, ''), line: p.line });
    return '';
  });

  const lineOf = (i: number) => p.line + 1 + i;
  const linkFrom = (inner: string, setter: string | undefined, conditions: Condition[], once: boolean): Link => {
    const { text, target } = parseLinkInner(restore(inner));
    const effects: Effect[] = [];
    let isOnce = once;
    for (const s of splitSetters(setter ?? '')) {
      if (/^\$once_\w+\s+to\s+true$/.test(s)) {
        isOnce = true;
        continue;
      }
      const e = parseAssignment(s);
      if (e) effects.push(e);
    }
    return { text: plainText(text), target, effects, conditions, once: isOnce };
  };
  const conditionFrom = (src: string, i: number): { conds: Condition[]; once: boolean } | null => {
    const { cond, once } = takeOnce(parseConditionExpr(src));
    if (!cond && !once) {
      out.push({ kind: 'unsupported', text: src, reason: 'Twine condition', line: lineOf(i) });
      return null;
    }
    return { conds: cond ? [cond] : [], once };
  };

  const lines = body.split('\n');
  let para: string[] = [];
  let paraLine = 0;
  let speaker: { who: string; paren?: string; line: number } | null = null;
  let headingDone = !!opts.continued;
  const pushText = (text: string, ln: number) => {
    const t = restore(text).trim();
    if (!t) return;
    // Plain formats: scene headings, transitions and "NAME (direction): line" dialogue.
    // (Scene headings are capitals; a sentence that merely starts with "INT." is text.)
    if (!headingDone && SCENE_START.test(t) && !t.includes('\n') && t === t.toUpperCase()) {
      headingDone = true;
      out.push({ kind: 'marker', marker: { type: 'heading', text: plainText(t) }, line: ln });
      return;
    }
    headingDone = true;
    if (/^[A-Z][A-Z .'’]*TO:$/.test(t)) {
      out.push({ kind: 'transition', text: t, line: ln });
      return;
    }
    const d = /^([A-Z][A-Z0-9 .'’\-]{0,30}?)(?:\s*\(([^)]*)\))?:\s+([\s\S]+)$/.exec(t);
    if (d) out.push({ kind: 'dialogue', character: d[1].trim(), parenthetical: d[2], text: plainText(d[3]), line: ln });
    else out.push({ kind: 'action', text: plainText(t), line: ln });
  };
  const flush = () => {
    if (speaker) {
      out.push({ kind: 'dialogue', character: plainText(restore(speaker.who)), parenthetical: speaker.paren, text: plainText(restore(para.join('\n'))), line: speaker.line });
      speaker = null;
    } else if (para.length) pushText(para.join('\n'), paraLine);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const ln = lineOf(i);
    if (!t) {
      flush();
      continue;
    }
    if (t === '@@.choices;' || t === '@@') continue;
    let m: RegExpExecArray | null;
    // Narrative Bridge marks.
    if ((m = /^@@\.end;.*@@$/.exec(t)) || /^The End$/i.test(t)) {
      flush();
      out.push({ kind: 'marker', marker: { type: 'end' }, line: ln });
      continue;
    }
    if ((m = /^@@\.scene;(.*)@@$/.exec(t))) {
      flush();
      headingDone = true;
      out.push({ kind: 'marker', marker: { type: 'heading', text: plainText(restore(m[1])) }, line: ln });
      continue;
    }
    if ((m = /^@@\.transition;(.*)@@$/.exec(t))) {
      flush();
      out.push({ kind: 'transition', text: plainText(restore(m[1])), line: ln });
      continue;
    }
    if ((m = /^@@\.speaker;(.*?)@@\s*(?:\/\/\((.*)\)\/\/)?$/.exec(t))) {
      flush();
      speaker = { who: m[1], paren: m[2] ? restore(m[2]) : undefined, line: ln };
      headingDone = true;
      continue;
    }
    // Conditional links: <<if cond>>[[…]]<</if>> (SugarCube) or (if: cond)[ [[…]] ] (Harlowe).
    if ((m = /^<<if\s+(.+?)>>\s*(\[\[[\s\S]*\]\])\s*<<\/if>>$/.exec(t) ?? /^\(if:\s*(.+?)\)\s*\[\s*(\[\[[\s\S]*\]\])\s*\]$/.exec(t))) {
      flush();
      const c = conditionFrom(m[1], i);
      if (c) for (const l of m[2].matchAll(LINK)) links.push({ ...linkFrom(l[1], l[2], c.conds, c.once), line: ln });
      continue;
    }
    // Effects on their own line.
    if (/^(?:\s*(?:<<set\s+[\s\S]*?>>|\(set:\s*[\s\S]*?\)))+$/.test(t)) {
      flush();
      for (const s of t.matchAll(/<<set\s+([\s\S]*?)>>|\(set:\s*([\s\S]*?)\)/g))
        for (const part of splitSetters((s[1] ?? s[2]).replace(/\s+into\s+/, ' to '))) {
          const e = parseAssignment(part);
          if (e) out.push({ kind: 'marker', marker: { type: 'effect', effect: e }, line: ln });
          else out.push({ kind: 'unsupported', text: s[0], reason: 'Twine code', line: ln });
        }
      continue;
    }
    // Navigation macros.
    if ((m = /^(?:<<goto\s+["'](.+?)["']\s*>>|\(go-?to:\s*["'](.+?)["']\s*\))$/.exec(t))) {
      flush();
      out.push({ kind: 'marker', marker: { type: 'divert', target: idOf(m[1] ?? m[2]) }, line: ln });
      continue;
    }
    if ((m = /^\(link-goto:\s*["'](.+?)["']\s*(?:,\s*["'](.+?)["'])?\s*\)$/.exec(t))) {
      flush();
      links.push({ text: m[1], target: m[2] ?? m[1], effects: [], conditions: [], once: false, line: ln });
      continue;
    }
    if ((m = /^<<link\s+["'](.+?)["']\s+["'](.+?)["']\s*>>([\s\S]*?)<<\/link>>$/.exec(t))) {
      flush();
      const effects = [...m[3].matchAll(/<<set\s+([\s\S]*?)>>/g)].flatMap((s) => splitSetters(s[1]).map(parseAssignment).filter((e): e is Effect => !!e));
      links.push({ text: m[1], target: m[2], effects, conditions: [], once: false, line: ln });
      continue;
    }
    // Lines of links.
    if (/^(?:\s*\[\[(?:[^\]]|\](?!\]))*?\](?:\[[^\]]*\])?\])+\s*$/.test(t)) {
      flush();
      for (const l of t.matchAll(LINK)) links.push({ ...linkFrom(l[1], l[2], [], false), line: ln });
      continue;
    }
    // Other macros and multi-line conditional text can't be represented: keep them as notes.
    if (/<<(?!\/?(?:nobr|silently)\b)[A-Za-z/]|\((?:if|else-?if|else|unless|for|loop|live|event|either|cond|display|print|replace|append|prepend|show|hide|click|mouseover|link|link-reveal|link-repeat|cycling-link|dropdown|input|textarea|history|visits|random|a|dm|ds)\s*:/i.test(t)) {
      flush();
      let block = t;
      // A conditional block spans lines until it closes.
      if (/<<(if|for|switch|nobr|silently|link|button|widget)\b/.test(t) && !/<<\/(if|for|switch|nobr|silently|link|button|widget)>>/.test(t))
        while (i + 1 < lines.length && !/<<\/(if|for|switch|nobr|silently|link|button|widget)>>/.test(block)) block += `\n${lines[++i]}`;
      out.push({ kind: 'unsupported', text: restore(block), reason: 'Twine code', line: ln });
      continue;
    }
    // Text, possibly with links inside it: the link text stays in the sentence and becomes a choice.
    const inline = [...t.matchAll(LINK)];
    if (inline.length) {
      for (const l of inline) links.push({ ...linkFrom(l[1], l[2], [], false), line: ln });
      if (!para.length) paraLine = ln;
      para.push(t.replace(LINK, (_, inner) => parseLinkInner(restore(inner)).text));
      continue;
    }
    if (!para.length) paraLine = ln;
    para.push(t);
  }
  flush();

  // "Continue" is the passage's onward route, not a choice, when it is the only link or the
  // conditional fallback Narrative Bridge exports (offered only when no other choice is).
  // The link to the passage's next part is the Continue break the caller adds.
  if (opts.continueTo) links.splice(0, links.length, ...links.filter((l) => !(/^continue$/i.test(l.text) && l.target === opts.continueTo)));
  const onward = (l: Link) => /^continue$/i.test(l.text) && !l.effects.length && (links.length === 1 || l.conditions.length > 0);
  const choices = links.filter((l) => !onward(l));
  for (const l of links.filter(onward)) out.push({ kind: 'marker', marker: { type: 'divert', target: idOf(l.target) }, line: l.line });
  for (const l of choices)
    out.push({ kind: 'marker', marker: { type: 'choice', text: l.text || l.target, target: idOf(l.target), conditions: l.conditions, effects: l.effects, once: l.once }, line: l.line });
  return out;
}
