// Emphasis (italics, bold, underline) kept from the script. Inside the story it's written as the rich-text tags
// <i>…</i>, <b>…</b> and <u>…</u>: what Unity's text (TextMeshPro and UI Toolkit) and Unreal's rich text read,
// and plain enough for writers to type in Review. Only these three tags count; any other "<" is just text.
// Every reader shows them (Playtest, the playable page, Unity); counts, voice and search use the plain text.

export type EmphasisTag = 'i' | 'b' | 'u';
export interface Span {
  text: string;
  i?: boolean;
  b?: boolean;
  u?: boolean;
}

const TAG_RE = /<(\/?)([ibu])>/g;

/** True if the text has any emphasis tags. */
export function hasEmphasis(text: string): boolean {
  return /<\/?[ibu]>/.test(text);
}

/** The text without its emphasis tags. */
export function plainText(text: string): string {
  return text.includes('<') ? text.replace(TAG_RE, '') : text;
}

/** The text as runs of plain, italic, bold and underlined text (tags left open run to the end). */
export function emphasisSpans(text: string): Span[] {
  const out: Span[] = [];
  const on = { i: 0, b: 0, u: 0 };
  let last = 0;
  const push = (s: string) => {
    if (!s) return;
    const span: Span = { text: s };
    if (on.i) span.i = true;
    if (on.b) span.b = true;
    if (on.u) span.u = true;
    out.push(span);
  };
  for (const m of text.matchAll(TAG_RE)) {
    push(text.slice(last, m.index));
    const tag = m[2] as EmphasisTag;
    on[tag] = Math.max(0, on[tag] + (m[1] ? -1 : 1));
    last = m.index! + m[0].length;
  }
  push(text.slice(last));
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Safe HTML for the text: everything escaped, emphasis as <em>, <strong> and <u>. */
export function emphasisHtml(text: string): string {
  return emphasisSpans(text)
    .map((s) => {
      let h = escapeHtml(s.text);
      if (s.u) h = `<u>${h}</u>`;
      if (s.b) h = `<strong>${h}</strong>`;
      if (s.i) h = `<em>${h}</em>`;
      return h;
    })
    .join('');
}

/** Balanced tags from spans (each run opens and closes its own), e.g. for text whose tags were left open. */
export function spansToTags(spans: Span[]): string {
  return spans.map((s) => `${s.i ? '<i>' : ''}${s.b ? '<b>' : ''}${s.u ? '<u>' : ''}${s.text}${s.u ? '</u>' : ''}${s.b ? '</b>' : ''}${s.i ? '</i>' : ''}`).join('');
}

/**
 * Fountain and Markdown emphasis as tags: ***bold italic***, **bold**, *italic*, _underline_ (Fountain) and
 * __bold__ (Markdown). A backslash keeps a * or _ as written. Unmatched markers stay as they are.
 */
export function markupToTags(s: string, flavour: 'fountain' | 'markdown' = 'fountain'): string {
  // Escaped marks are set aside first (\u0001 for *, \u0002 for _), so they can't pair up.
  let t = s.replace(/\\\*/g, '\u0001').replace(/\\_/g, '\u0002');
  t = t.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  if (flavour === 'markdown') t = t.replace(/__([^_\n]+?)__/g, '<b>$1</b>');
  t = t.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1<i>$2</i>');
  t = t.replace(/(^|[^\w])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, flavour === 'fountain' ? '$1<u>$2</u>' : '$1<i>$2</i>');
  return t.replace(/\u0001/g, '*').replace(/\u0002/g, '_');
}

/** Tags back as Fountain emphasis (for the screenplay export). */
export function tagsToFountain(text: string): string {
  return emphasisSpans(text)
    .map((s) => {
      const lead = s.text.match(/^\s*/)![0];
      const trail = s.text.slice(lead.length).match(/\s*$/)![0];
      const core = s.text.slice(lead.length, s.text.length - trail.length);
      if (!core) return s.text;
      let w = core.replace(/([*_])/g, '\\$1');
      if (s.u) w = `_${w}_`;
      if (s.i && s.b) w = `***${w}***`;
      else if (s.b) w = `**${w}**`;
      else if (s.i) w = `*${w}*`;
      return lead + w + trail;
    })
    .join('');
}
