// Cuts scene-length excerpts from public-domain plays (Project Gutenberg plain text) into Fountain, for the
// adaptation evaluation set. tests/adaptation-eval/plays/sources.json lists each excerpt: the ebook, the line
// range, and what the play is. The Fountain files it writes are committed, so this only needs re-running to
// add a play or change a range.
//
//   node scripts/play-excerpts.mjs                 download what is missing (to a cache folder) and write every excerpt
//   node scripts/play-excerpts.mjs --cache <dir>   where the pgNNNN.txt files are kept (default: the system temp folder)
//   node scripts/play-excerpts.mjs --only hedda    one excerpt
//
// A play is one long scene, and suggestions go at the end of a passage, so an excerpt is cut into short scenes:
// at the play's own scene headings, at entrances and exits, and otherwise every six speeches. Stage
// directions inside a speech become action lines of their own, so "takes the letter" is a line a suggester can cite.
// `continuation` in a source marks editions where a speech goes on after a stage direction (verse, the French text).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name) => (args.indexOf(`--${name}`) >= 0 ? args[args.indexOf(`--${name}`) + 1] : undefined);
const dir = fileURLToPath(new URL('../tests/adaptation-eval/plays/', import.meta.url));
const cache = opt('cache') ?? join(tmpdir(), 'narrative-bridge-gutenberg');
const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));

const CAPS = "A-ZÀ-ÖØ-Þ";
const NAME = `(?:[${CAPS}][${CAPS}'’\\-]*\\.?\\s)*[${CAPS}][${CAPS}'’\\-]+`;
const NAME_ONLY = new RegExp(`^(${NAME})[.:]?$`);
const NAME_INLINE = new RegExp(`^(${NAME})(?:[.:]\\s+|\\s+(?=[\\[(_]))(\\S.*)$`);
const FRENCH_NAME = /^-\s+(.+?)\s+-$/;
const HEADING = /^(?:ACT|SCENE|ACTE|SC[ÈE]NE)\b/i;
const ENTERS = /\b(?:enters?|re-enters?|comes? in|entre|rentre)\b/i;
const EXITS = /\b(?:exit|exeunt|goes out|go out)\b/i;
const DIRECTION = /^_?[\[(].*[\])]\.?_?$/;
const MAX_SPEECHES = 6;

async function text(ebook) {
  mkdirSync(cache, { recursive: true });
  const file = join(cache, `pg${ebook}.txt`);
  if (!existsSync(file)) {
    const r = await fetch(`https://www.gutenberg.org/cache/epub/${ebook}/pg${ebook}.txt`);
    if (!r.ok) throw new Error(`Could not download ebook ${ebook}: ${r.status}`);
    writeFileSync(file, await r.text());
  }
  return readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
}

/** Splits a speech into what is said and the stage directions inside it. */
function speech(raw) {
  const directions = [];
  const take = (_, d) => {
    const t = clean(d);
    if (t) directions.push(t);
    return ' ';
  };
  let said = raw
    .replace(/\(\d+\)/g, ' ') // footnote marks
    .replace(/^_([^_]+)_\s*[—–-]+\s*/, take) // Synge: _Turning the cake out._—It's destroyed…
    .replace(/_?\[([^\]]*)\]\.?_?/g, take)
    .replace(/_?\(([^)]*)\)\.?_?/g, take)
    .replace(/\[([^\]]*)$/, take); // a direction left open at the end of a speech
  said = clean(said);
  return { said, directions };
}

function clean(s) {
  return s.replace(/[_\[\]]/g, '').replace(/\s+/g, ' ').replace(/^[\s.,;:—–-]+(?=\S)/, '').trim();
}

/** The excerpt as blocks: { type: 'heading' | 'action' | 'speech', … }. */
function blocks(lines, continuation) {
  const paragraphs = lines.join('\n').split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean)).filter((p) => p.length);
  const out = [];
  let pending = null; // a speaker whose speech is the next paragraph
  let last = null; // the last speaker, for editions where a speech goes on after a stage direction
  for (const p of paragraphs) {
    const first = p[0];
    const whole = p.join(' ');
    const french = FRENCH_NAME.exec(first);
    if (/^-{3,}$/.test(whole)) continue;
    if (HEADING.test(first) && whole.length < 120) {
      out.push({ type: 'heading', text: clean(whole) });
      pending = null;
      last = null;
      continue;
    }
    let name = null;
    let rest = null;
    if (french) [name, rest] = [french[1], p.slice(1).join(' ')];
    else if (NAME_ONLY.test(first)) [name, rest] = [NAME_ONLY.exec(first)[1], p.slice(1).join(' ')];
    else if (NAME_INLINE.test(whole)) [, name, rest] = NAME_INLINE.exec(whole);
    if (name && HEADING.test(name)) {
      out.push({ type: 'heading', text: clean(whole) });
      pending = null;
      continue;
    }
    if (name) {
      name = name.toUpperCase().replace(/[.:\s]+$/, '');
      if (!rest.trim()) {
        pending = name;
        continue;
      }
      out.push({ type: 'speech', name, ...speech(rest) });
      pending = null;
      last = name;
      continue;
    }
    const direction = DIRECTION.test(whole) || /^(?:Enter|Re-enter|Exit|Exeunt)\b/.test(whole);
    if (pending && !direction) {
      out.push({ type: 'speech', name: pending, ...speech(whole) });
      last = pending;
      pending = null;
      continue;
    }
    if (continuation && last && !pending && !direction) {
      out.push({ type: 'speech', name: last, ...speech(whole) });
      continue;
    }
    const action = clean(whole.replace(/[()]/g, ''));
    if (action) out.push({ type: 'action', text: action });
  }
  return out;
}

function fountain(source, body) {
  const lines = [`Title: ${source.title}`, `Author: ${source.author}`, `Source: Project Gutenberg ebook ${source.ebook}, lines ${source.lines[0]} to ${source.lines[1]}${source.translator ? `; translated by ${source.translator}` : ''}`, ''];
  let scene = 0;
  let speeches = 0;
  let inScene = 0;
  let closing = false;
  const heading = () => {
    closing = false;
    scene++;
    speeches = 0;
    inScene = 0;
    lines.push(`INT. ${source.setting.toUpperCase()} ${scene} - DAY`, '');
  };
  heading();
  for (const b of body) {
    if (b.type === 'heading') {
      if (inScene >= 2) heading();
      lines.push(`!${b.text}`, '');
      continue;
    }
    if (b.type === 'action') {
      // An entrance opens a new scene and an exit closes one, once the scene has something in it.
      const exits = EXITS.test(b.text) && !ENTERS.test(b.text);
      if (!exits && ENTERS.test(b.text) && inScene >= 4) heading();
      lines.push(`!${b.text}`, '');
      inScene++;
      if (exits && inScene >= 4) closing = true;
      continue;
    }
    if (speeches >= MAX_SPEECHES || closing) heading();
    if (b.said) {
      lines.push(b.name, b.said, '');
      speeches++;
      inScene++;
    }
    for (const d of b.directions) {
      lines.push(`!${d}`, '');
      inScene++;
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

for (const source of sources) {
  if (opt('only') && source.id !== opt('only')) continue;
  const all = (await text(source.ebook)).split('\n');
  let [start, end] = source.lines;
  // Snap to whole paragraphs.
  while (start > 1 && all[start - 2].trim()) start--;
  while (end < all.length && all[end].trim()) end++;
  const body = blocks(all.slice(start - 1, end), source.continuation);
  const out = fountain(source, body);
  writeFileSync(join(dir, `${source.id}.fountain`), out);
  console.log(`${source.id.padEnd(22)} ${String(body.filter((b) => b.type === 'speech').length).padStart(3)} speeches, ${(out.match(/^INT\. /gm) ?? []).length} scenes, ${out.split(/\s+/).length} words`);
}
