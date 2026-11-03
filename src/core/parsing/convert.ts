import type JSZip from 'jszip';
import type { SourceInput } from '../builder';
import type { SourceFormat } from '../isr';

// Converters for formats that aren't plain text. Each turns the file into Fountain (screenplays) or
// Markdown (prose), which the existing parsers then read. The converted text is what the source pane
// shows and what is preserved in exports; the original file name is kept for provenance.
// Pure string/regex processing (no DOM), so it runs the same in the browser, the CLI and tests.

export interface ConvertedInput extends SourceInput {
  format: SourceFormat;
  convertedFrom: 'fdx' | 'docx' | 'pdf' | 'twine';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const SCENE_START = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const MARKER_START = /^(?:@[a-z]|->|[*+-]\s*[[{])/;

/** An action paragraph is forced with "!" whenever Fountain would otherwise read it as something else. */
export function fountainAction(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const caps = /[A-Z]/.test(t) && t === t.toUpperCase() && t.length < 60;
  const special = /^[#=>~.@!\[]/.test(t) || SCENE_START.test(t) || MARKER_START.test(t) || /TO:$/.test(t);
  return caps || special ? t.split('\n').map((l) => `!${l}`).join('\n') : t;
}

export function block(lines: string[], text: string) {
  if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  lines.push(text);
}

// ---------------------------------------------------------------------------------------------
// Final Draft (.fdx): XML with <Paragraph Type="…"><Text>…</Text></Paragraph> inside <Content>.

function fdxParagraphs(xml: string): { type: string; text: string; dual: boolean }[] {
  const out: { type: string; text: string; dual: boolean }[] = [];
  const re = /<DualDialogue\b[^>]*>([\s\S]*?)<\/DualDialogue>|<Paragraph\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Paragraph>)/g;
  let m: RegExpExecArray | null;
  const para = (attrs: string, body: string | undefined, dual: boolean) => {
    const type = /\bType="([^"]*)"/.exec(attrs)?.[1] ?? 'General';
    const text = [...(body ?? '').matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((t) => decodeXml(t[1])).join('');
    out.push({ type, text: text.replace(/\r\n?/g, '\n'), dual });
  };
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) {
      let first = true;
      for (const p of m[1].matchAll(/<Paragraph\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Paragraph>)/g)) {
        const isChar = /\bType="Character"/.test(p[1]);
        para(p[1], p[2], isChar && !first);
        if (isChar) first = false;
      }
    } else para(m[2], m[3], false);
  }
  return out;
}

export function fdxToFountain(xml: string): string {
  if (!/<FinalDraft\b/.test(xml)) throw new Error('This file is not a Final Draft (.fdx) document.');
  const titleXml = /<TitlePage\b[\s\S]*?<\/TitlePage>/.exec(xml)?.[0] ?? '';
  const body = xml.replace(/<TitlePage\b[\s\S]*?<\/TitlePage>/, '');
  const content = /<Content\b[^>]*>([\s\S]*?)<\/Content>/.exec(body)?.[1] ?? '';
  const lines: string[] = [];

  const titleLines = fdxParagraphs(titleXml).map((p) => p.text.trim()).filter(Boolean);
  if (titleLines.length) {
    lines.push(`Title: ${titleLines[0]}`);
    const by = titleLines.findIndex((l) => /^(written )?by$/i.test(l));
    if (by >= 0 && titleLines[by + 1]) lines.push(`Author: ${titleLines[by + 1]}`);
    else {
      const inline = titleLines.find((l) => /^(written )?by\s+/i.test(l));
      if (inline) lines.push(`Author: ${inline.replace(/^(written )?by\s+/i, '')}`);
    }
    lines.push('');
  }

  let prev = '';
  for (const p of fdxParagraphs(content)) {
    const text = p.text.trim();
    switch (p.type) {
      case 'Scene Heading':
        if (text) block(lines, SCENE_START.test(text) ? text.toUpperCase() : `.${text}`);
        break;
      case 'Character':
        if (text) block(lines, `@${text}${p.dual ? ' ^' : ''}`);
        break;
      case 'Parenthetical':
        if (text) lines.push(/^\(.*\)$/s.test(text) ? text : `(${text})`);
        break;
      case 'Dialogue':
        if (text) {
          if (prev !== 'Character' && prev !== 'Parenthetical' && prev !== 'Dialogue') block(lines, `!${text}`);
          else lines.push(...text.split('\n'));
        }
        break;
      case 'Transition':
        if (text) block(lines, `> ${text}`);
        break;
      case 'Lyrics':
        if (text) block(lines, text.split('\n').map((l) => `~${l}`).join('\n'));
        break;
      case 'New Act':
      case 'End of Act':
        if (text) block(lines, `# ${text}`);
        break;
      default: // Action, General, Shot, Cast List, …
        if (text) block(lines, fountainAction(text));
    }
    if (text) prev = p.type;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------------------------
// Word (.docx): word/document.xml paragraphs, classified by their paragraph style.

type DocxKind = 'scene' | 'character' | 'dialogue' | 'paren' | 'transition' | 'h1' | 'h2' | 'h3' | 'body';

function docxKind(styleId: string, styleName: string): DocxKind {
  const s = `${styleId} ${styleName}`.toLowerCase().replace(/[\s_-]+/g, '');
  if (/sceneheading|slugline|scene/.test(s)) return 'scene';
  if (/parenthetical/.test(s)) return 'paren';
  if (/character/.test(s)) return 'character';
  if (/dialog/.test(s)) return 'dialogue';
  if (/transition/.test(s)) return 'transition';
  if (/heading1|^title|title$/.test(s)) return 'h1';
  if (/heading2|subtitle/.test(s)) return 'h2';
  if (/heading[3-6]/.test(s)) return 'h3';
  return 'body';
}

export async function docxToText(bytes: Uint8Array | ArrayBuffer): Promise<{ text: string; format: SourceFormat }> {
  let zip: JSZip;
  try {
    // Loaded on demand: only Word imports need the zip reader.
    const { default: JSZipLib } = await import('jszip');
    zip = await JSZipLib.loadAsync(bytes);
  } catch {
    throw new Error('This file is not a Word (.docx) document. Older .doc files must be re-saved as .docx.');
  }
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) throw new Error('This Word file has no document body.');
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? '';
  const styleNames = new Map<string, string>();
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g)) styleNames.set(m[1], m[2]);

  const paras: { kind: DocxKind; text: string }[] = [];
  const bodyXml = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  for (const p of bodyXml.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = p[1] ?? '';
    const styleId = /<w:pStyle w:val="([^"]+)"/.exec(inner)?.[1] ?? '';
    const text = [...inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)]
      .map((r) => (r[2] === 'tab' ? ' ' : r[2] ? '\n' : decodeXml(r[1])))
      .join('');
    paras.push({ kind: docxKind(styleId, styleNames.get(styleId) ?? ''), text: text.replace(/[ \t]+$/gm, '') });
  }

  const styled = paras.some((p) => p.kind === 'scene' || p.kind === 'character');
  const plainScreenplay = !styled && paras.some((p) => SCENE_START.test(p.text.trim()));
  if (styled) return { text: docxScreenplayToFountain(paras), format: 'fountain' };
  if (plainScreenplay) {
    // Screenplay typed without styles: one paragraph per line is already Fountain-shaped.
    return { text: paras.map((p) => p.text).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', format: 'fountain' };
  }
  const md: string[] = [];
  for (const p of paras) {
    const t = p.text.trim();
    if (!t) continue;
    if (p.kind === 'h1') md.push(`# ${t}`, '');
    else if (p.kind === 'h2') md.push(`## ${t}`, '');
    else if (p.kind === 'h3') md.push(`### ${t}`, '');
    else md.push(t.replace(/^(#{1,6}\s)/, '\\$1'), '');
  }
  return { text: md.join('\n').trim() + '\n', format: 'md' };
}

function docxScreenplayToFountain(paras: { kind: DocxKind; text: string }[]): string {
  const lines: string[] = [];
  let prev: DocxKind | '' = '';
  for (const p of paras) {
    const t = p.text.trim();
    if (!t) continue;
    switch (p.kind) {
      case 'scene':
        block(lines, SCENE_START.test(t) ? t.toUpperCase() : `.${t}`);
        break;
      case 'character':
        block(lines, `@${t}`);
        break;
      case 'paren':
        lines.push(/^\(.*\)$/s.test(t) ? t : `(${t})`);
        break;
      case 'dialogue':
        if (prev === 'character' || prev === 'paren' || prev === 'dialogue') lines.push(...t.split('\n'));
        else block(lines, `!${t}`);
        break;
      case 'transition':
        block(lines, `> ${t}`);
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        block(lines, `# ${t}`);
        break;
      default:
        block(lines, fountainAction(t));
    }
    prev = p.kind;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------------------------
// Twine 2 HTML: a published story or a library archive (<tw-storydata> with <tw-passagedata>).

const attr = (tag: string, name: string) => decodeXml(new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '');
const escapeTweeName = (s: string) => s.replace(/([\\[\]{}])/g, '\\$1');

/** Converts a Twine 2 HTML file to Twee 3. An archive may hold several stories: the first is used. */
export function twineHtmlToTwee(html: string): { text: string; stories: number; title: string } {
  const stories = [...html.matchAll(/<tw-storydata\b([^>]*)>([\s\S]*?)<\/tw-storydata>/gi)];
  if (!stories.length) throw new Error('This web page is not a Twine story. In Twine, use Build → Publish to File, or Library → Archive.');
  const [, head, inner] = stories[0];
  const passages = [...inner.matchAll(/<tw-passagedata\b([^>]*)>([\s\S]*?)<\/tw-passagedata>/gi)].map(([, a, body]) => ({
    pid: attr(a, 'pid'),
    name: attr(a, 'name'),
    tags: attr(a, 'tags').split(/\s+/).filter(Boolean),
    position: attr(a, 'position'),
    text: decodeXml(body),
  }));
  const startPid = attr(head, 'startnode');
  const start = passages.find((p) => p.pid === startPid)?.name ?? passages[0]?.name ?? '';
  const title = attr(head, 'name') || 'Untitled Story';
  const data = { ifid: attr(head, 'ifid'), format: attr(head, 'format'), 'format-version': attr(head, 'format-version'), start };
  const out = [':: StoryTitle', title, '', ':: StoryData', JSON.stringify(data, null, 2), ''];
  const css = /<style[^>]*role="stylesheet"[^>]*>([\s\S]*?)<\/style>/i.exec(inner)?.[1].trim();
  if (css) out.push(':: StoryStylesheet [stylesheet]', decodeXml(css), '');
  const js = /<script[^>]*role="script"[^>]*>([\s\S]*?)<\/script>/i.exec(inner)?.[1].trim();
  if (js) out.push(':: StoryScript [script]', decodeXml(js), '');
  for (const p of passages) {
    const meta = p.position ? ` {"position":"${p.position}"}` : '';
    out.push(`:: ${escapeTweeName(p.name)}${p.tags.length ? ` [${p.tags.join(' ')}]` : ''}${meta}`, p.text, '');
  }
  return { text: out.join('\n'), stories: stories.length, title };
}

/** Turn any supported file into parser-ready text. Text formats pass through unchanged. */
export async function prepareInput(fileName: string, data: string | Uint8Array | ArrayBuffer): Promise<SourceInput> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.fdx')) {
    const xml = typeof data === 'string' ? data : new TextDecoder().decode(data);
    return { fileName, text: fdxToFountain(xml), format: 'fountain', convertedFrom: 'fdx' } satisfies ConvertedInput;
  }
  if (lower.endsWith('.docx')) {
    if (typeof data === 'string') throw new Error('Word files must be read as binary data.');
    const { text, format } = await docxToText(data);
    return { fileName, text, format, convertedFrom: 'docx' } satisfies ConvertedInput;
  }
  if (lower.endsWith('.pdf')) {
    if (typeof data === 'string') throw new Error('PDF files must be read as binary data.');
    // Loaded on demand: pdf.js is large and only PDF imports need it.
    const { pdfToText } = await import('./pdf');
    const { text, format } = await pdfToText(data);
    return { fileName, text, format, convertedFrom: 'pdf' } satisfies ConvertedInput;
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const html = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const { text, stories, title } = twineHtmlToTwee(html);
    const note = stories > 1 ? `${fileName} holds ${stories} Twine stories; "${title}" was imported. Publish the others to their own files to import them.` : undefined;
    return { fileName, text, format: 'twee', convertedFrom: 'twine', note } satisfies ConvertedInput;
  }
  return { fileName, text: typeof data === 'string' ? data : new TextDecoder().decode(data) };
}

export const BINARY_EXTENSIONS = ['.docx', '.pdf'];
export const CONVERTED_EXTENSIONS = ['.fdx', '.docx', '.pdf', '.html', '.htm'];
