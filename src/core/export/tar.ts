// A minimal ustar writer plus gzip, for Unity package tarballs (.tgz). Unity's Package Manager
// installs these with "Install package from tarball…": every path sits under package/, as npm packs it.

export interface TarEntry {
  path: string;
  content: string | Uint8Array;
}

// A fixed date (npm uses the same one) so the same package always packs to the same bytes.
const MTIME = 499162500;
const enc = new TextEncoder();

function bytesOf(c: string | Uint8Array): Uint8Array {
  return typeof c === 'string' ? enc.encode(c) : c;
}

function writeString(h: Uint8Array, offset: number, length: number, s: string) {
  const b = enc.encode(s);
  if (b.length > length) throw new Error(`Tar field too long: ${s}`);
  h.set(b, offset);
}

function writeOctal(h: Uint8Array, offset: number, length: number, n: number) {
  writeString(h, offset, length, n.toString(8).padStart(length - 1, '0') + '\0');
}

/** Splits a path into ustar's name (100 bytes) and prefix (155 bytes) fields. */
export function splitTarPath(path: string): { name: string; prefix: string } {
  if (enc.encode(path).length <= 100) return { name: path, prefix: '' };
  for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100) return { name, prefix };
  }
  throw new Error(`Path too long for a tar file: ${path}`);
}

function header(path: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const { name, prefix } = splitTarPath(path);
  writeString(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, MTIME);
  h.fill(0x20, 148, 156); // checksum is computed with this field as spaces
  h[156] = 0x30; // '0': a regular file
  writeString(h, 257, 6, 'ustar\0');
  writeString(h, 263, 2, '00');
  writeString(h, 345, 155, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  writeString(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}

/** An uncompressed tar archive of the entries. */
export function tar(entries: TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const data = bytesOf(e.content);
    parts.push(header(e.path, data.length), data);
    if (data.length % 512) parts.push(new Uint8Array(512 - (data.length % 512)));
  }
  parts.push(new Uint8Array(1024)); // two empty blocks end the archive
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Gzip, with the browser's (and Node's) built-in CompressionStream. */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The entries as a .tgz, each under `package/` as Unity's Package Manager expects. */
export async function packageTarball(entries: TarEntry[]): Promise<Uint8Array> {
  return gzip(tar(entries.map((e) => ({ path: `package/${e.path}`, content: e.content }))));
}
