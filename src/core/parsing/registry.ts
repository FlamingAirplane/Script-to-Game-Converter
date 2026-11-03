import type { SourceFormat } from '../isr';
import { fountainParser } from './fountain';
import { inkParser } from './ink';
import { markdownParser } from './markdown';
import { plainTextParser } from './plaintext';
import { tweeParser } from './twee';
import type { Parser } from './types';

// Independent parser implementations, selected by extension first, then by content sniffing.
export const PARSERS: Parser[] = [fountainParser, markdownParser, inkParser, tweeParser, plainTextParser];

export const SUPPORTED_EXTENSIONS = PARSERS.flatMap((p) => p.extensions);

export function parserFor(format: SourceFormat): Parser {
  return PARSERS.find((p) => p.format === format)!;
}

export function detectFormat(fileName: string, text: string): { format: SourceFormat; confidence: number; by: 'extension' | 'content' } {
  const lower = fileName.toLowerCase();
  const byExt = PARSERS.find((p) => p.extensions.some((e) => lower.endsWith(e)));
  if (byExt && byExt.format !== 'txt') return { format: byExt.format, confidence: 1, by: 'extension' };
  // .txt files and unknown extensions: sniff content (a .txt may well contain a Fountain screenplay).
  const scored = PARSERS.map((p) => ({ p, s: p.sniff(text) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (best.s >= 0.6) return { format: best.p.format, confidence: best.s, by: 'content' };
  return { format: 'txt', confidence: byExt ? 1 : 0.5, by: byExt ? 'extension' : 'content' };
}
