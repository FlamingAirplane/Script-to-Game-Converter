import type { SourceFormat } from '../isr';
import { block, fountainAction, SCENE_START } from './convert';

// PDF import. A PDF has no structure, only positioned text, so this reads every line with its
// position and rebuilds the structure from the layout:
//
// - Screenplays use standard indents (measured from the action margin: dialogue about 1", the
//   parenthetical about 1.6", the character cue about 2.2", transitions far right). Lines are
//   classified by indent, page furniture (page numbers, MORE / CONTINUED, scene numbers) is dropped,
//   and the result is Fountain.
// - Anything else is prose: lines are joined into paragraphs, and larger type becomes Markdown
//   headings (so chapters become passages).
//
// pdf.js is loaded on demand (only PDF imports need it). Fonts and scripts in the PDF are never run;
// only its text and positions are read.

export interface PdfLine {
  page: number;
  /** Left edge and baseline, in points from the page's top-left corner. */
  x: number;
  y: number;
  /** Font size in points. */
  size: number;
  text: string;
}

type TextItem = Pick<import('pdfjs-dist/types/src/display/api').TextItem, 'str' | 'transform' | 'width' | 'height'>;

/** Reads every line of text with its position. */
export async function pdfLines(bytes: Uint8Array | ArrayBuffer): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const g = globalThis as { pdfjsWorker?: unknown };
  // Run pdf.js's worker code on this thread: it works the same in the browser, the single-file
  // edition (where no separate worker file exists) and Node.
  g.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  // A copy: pdf.js takes ownership of (detaches) the buffer it is given.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password (or export the script again) and try once more.');
    throw new Error('This file could not be read as a PDF.');
  }
  const out: PdfLine[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const items = (await page.getTextContent()).items.filter((i) => 'str' in i) as TextItem[];
      out.push(...groupLines(items, n, height));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  if (!out.some((l) => /\p{L}/u.test(l.text))) throw new Error('This PDF has no selectable text. It may be a scan: export the script from your writing app instead.');
  return out;
}

/** Joins text items that share a baseline into lines, top to bottom. */
function groupLines(items: TextItem[], page: number, pageHeight: number): PdfLine[] {
  const runs = items
    .filter((i) => i.str.trim())
    .map((i) => ({ x: i.transform[4], y: pageHeight - i.transform[5], w: i.width, size: Math.hypot(i.transform[2], i.transform[3]) || i.height, str: i.str }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; size: number; runs: typeof runs }[] = [];
  for (const r of runs) {
    const line = lines.find((l) => Math.abs(l.y - r.y) < Math.max(2, r.size * 0.3));
    if (line) line.runs.push(r);
    else lines.push({ y: r.y, size: r.size, runs: [r] });
  }
  return lines.map((l) => {
    const rs = l.runs.sort((a, b) => a.x - b.x);
    let text = '';
    let end = rs[0].x;
    for (const r of rs) {
      // A visible gap between runs is a space (pdf.js often omits them).
      if (text && r.x - end > r.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(r.str)) text += ' ';
      text += r.str;
      end = r.x + r.w;
    }
    return { page, x: rs[0].x, y: l.y, size: Math.max(...rs.map((r) => r.size)), text: text.replace(/\s+/g, ' ').trim() };
  });
}

// ---------------------------------------------------------------------------------------------

type Kind = 'scene' | 'action' | 'character' | 'paren' | 'dialogue' | 'transition';

const PAGE_FURNITURE = /^(?:\d+\.?|page \d+( of \d+)?|\(?more\)?|\(?continued\)?:?|continued:?(?: \(\d+\))?|\(cont(?:'|’)d\))$/i;
const CUE = /^[^a-z]*[A-Z][^a-z]*$/; // capitals, digits, punctuation and extensions like (V.O.)
const TRANSITION = /^[A-Z][A-Z\s.']*(?:TO:|OUT\.?|IN:)$/;

/** The left margin used by action and scene headings: the leftmost indent that many lines share. */
function actionMargin(lines: PdfLine[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) counts.set(Math.round(l.x / 4) * 4, (counts.get(Math.round(l.x / 4) * 4) ?? 0) + 1);
  const common = [...counts].filter(([, c]) => c >= Math.max(3, lines.length * 0.05)).map(([x]) => x);
  return common.length ? Math.min(...common) : Math.min(...lines.map((l) => l.x));
}

function classify(l: PdfLine, margin: number, prev: Kind | ''): Kind {
  const t = l.text;
  const off = l.x - margin;
  if (off < 30) {
    if (SCENE_START.test(t)) return 'scene';
    if (TRANSITION.test(t)) return 'transition';
    return 'action';
  }
  if (off >= 240) return TRANSITION.test(t) || CUE.test(t) ? 'transition' : 'action';
  if (t.startsWith('(') && (prev === 'character' || prev === 'dialogue' || prev === 'paren')) return 'paren';
  if (off >= 135 && CUE.test(t) && /[A-Z]/.test(t)) return 'character';
  if (off >= 95 && off < 135 && prev === 'paren' && !/\)$/.test(t)) return 'paren';
  if (prev === 'character' || prev === 'dialogue' || prev === 'paren') return 'dialogue';
  return 'action';
}

/** Scene numbers printed in the margins ("12  INT. HOUSE - DAY  12") are production furniture. */
const stripSceneNumbers = (t: string) => t.replace(/^\d+[A-Z]?\.?\s+(?=(?:INT|EXT|EST|I\/E)[.\s])/i, '').replace(/\s+\d+[A-Z]?\.?$/, '');

export function pdfLinesToText(all: PdfLine[]): { text: string; format: SourceFormat } {
  const kept = all.filter((l) => !PAGE_FURNITURE.test(l.text));
  if (!kept.length) return { text: '', format: 'txt' };
  // A screenplay's first page is a title page when it has no scene heading and more pages follow.
  const titlePage = kept.some((l) => l.page > 1) && !kept.some((l) => l.page === 1 && SCENE_START.test(stripSceneNumbers(l.text))) ? kept.filter((l) => l.page === 1) : [];
  const lines = kept.filter((l) => !titlePage.includes(l));
  const margin = actionMargin(lines);
  const kinds: Kind[] = [];
  for (const l of lines) kinds.push(classify({ ...l, text: stripSceneNumbers(l.text) }, margin, kinds[kinds.length - 1] ?? ''));
  const cues = kinds.filter((k) => k === 'character').length;
  const scenes = kinds.filter((k) => k === 'scene').length;
  if (cues >= 3 && (scenes >= 1 || cues >= 6)) return { text: screenplayToFountain(titlePage, lines, kinds), format: 'fountain' };
  return { text: proseToMarkdown(kept), format: 'md' };
}

/** Whether a line carries on from the previous one: close below it, or after a page break mid-sentence. */
function continues(prev: PdfLine | undefined, l: PdfLine, step: number, prevText: string): boolean {
  if (!prev) return false;
  if (prev.page === l.page) return l.y - prev.y <= step * 1.4;
  return l.page === prev.page + 1 && !/[.!?…:"”’)]$/.test(prevText);
}

/** Typical distance between consecutive lines of one paragraph. */
function lineStep(lines: PdfLine[]): number {
  const gaps = lines.slice(1).map((l, i) => (l.page === lines[i].page ? l.y - lines[i].y : 0)).filter((g) => g > 0);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length * 0.25)] ?? 12;
}

function screenplayToFountain(titleLines: PdfLine[], lines: PdfLine[], kinds: Kind[]): string {
  const step = lineStep(lines);
  const out: string[] = [];
  if (titleLines.length) {
    const title = [...titleLines].sort((a, b) => b.size - a.size || a.y - b.y)[0];
    const by = titleLines.findIndex((l) => /^(?:written )?by$/i.test(l.text));
    out.push(`Title: ${title.text}`);
    if (by >= 0 && titleLines[by + 1]) out.push(`Author: ${titleLines[by + 1].text}`);
    out.push('');
  }
  let prevKind: Kind | '' = '';
  let prev: PdfLine | undefined;
  let para: string[] = [];
  const flush = () => {
    if (para.length) block(out, fountainAction(para.join(' ')));
    para = [];
  };
  lines.forEach((l, i) => {
    const kind = kinds[i];
    const t = stripSceneNumbers(l.text);
    if (kind !== 'action' || prevKind !== 'action' || !continues(prev, l, step, para[para.length - 1] ?? '')) flush();
    switch (kind) {
      case 'scene':
        block(out, t.toUpperCase());
        break;
      case 'transition':
        block(out, `> ${t}`);
        break;
      case 'character':
        block(out, `@${t.replace(/\s*\((?:cont(?:'|’)d|continued)\)\s*$/i, '')}`);
        break;
      case 'paren':
        if (prevKind === 'paren' && !out[out.length - 1].endsWith(')')) out[out.length - 1] += ` ${t}`;
        else out.push(t);
        break;
      case 'dialogue':
        // Wrapped dialogue continues the same speech, also across a page break.
        if (prevKind === 'dialogue' && continues(prev, l, step, out[out.length - 1])) out[out.length - 1] += ` ${t}`;
        else out.push(t);
        break;
      default:
        para.push(t);
    }
    prevKind = kind;
    prev = l;
  });
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function proseToMarkdown(lines: PdfLine[]): string {
  const step = lineStep(lines);
  const sizes = lines.map((l) => Math.round(l.size)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];
  const md: string[] = [];
  let para: string[] = [];
  let prev: PdfLine | undefined;
  const flush = () => {
    if (para.length) md.push(para.join(' ').replace(/(\p{L})- (\p{L})/gu, '$1-$2').replace(/^(#{1,6}\s)/, '\\$1'), '');
    para = [];
  };
  for (const l of lines) {
    if (l.size >= body * 1.25 && l.text.length < 80) {
      flush();
      md.push(`${l.size >= body * 1.6 ? '#' : '##'} ${l.text}`, '');
      prev = l;
      continue;
    }
    const newPara = !continues(prev, l, step, para[para.length - 1] ?? '.') || (prev!.page === l.page && l.x - prev!.x > body * 1.2);
    if (newPara) flush();
    para.push(l.text);
    prev = l;
  }
  flush();
  return md.join('\n').trim() + '\n';
}

export async function pdfToText(bytes: Uint8Array | ArrayBuffer): Promise<{ text: string; format: SourceFormat }> {
  return pdfLinesToText(await pdfLines(bytes));
}
