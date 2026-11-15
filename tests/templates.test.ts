import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as generated from '../src/core/export/templates.generated';

const dir = new URL('../src/core/export/templates/', import.meta.url);

describe('engine code templates', () => {
  it('the generated module matches the template files (run `npm run templates` after editing one)', () => {
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/templates.mjs', import.meta.url)), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('has one constant per file, with the file’s exact text', () => {
    const files = readdirSync(dir).flatMap((engine) => readdirSync(new URL(`${engine}/`, dir)).map((f) => `${engine}/${f}`));
    expect(Object.keys(generated)).toHaveLength(files.length);
    for (const f of files) {
      const name = `${f.split('/')[1].replace(/\.(\w+)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_${f.split('.').pop()!.toUpperCase()}`;
      expect((generated as Record<string, string>)[name], f).toBe(readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n'));
    }
  });
});
