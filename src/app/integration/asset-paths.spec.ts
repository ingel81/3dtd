import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asset URLs must stay relative.
 *
 * The web build is served from a subdirectory (`3dtd.sgeht.net/play/`) and the
 * desktop build from its own `app://` root, so an absolute `/assets/...` URL
 * resolves to nothing in both. Relative URLs go through `<base href>` and work
 * everywhere, including a checkout someone serves from an arbitrary folder.
 *
 * The failure mode is silent, a 404 for one model or sound in production, long
 * after the build went green, which is why it is guarded here.
 */
const SOURCE_ROOT = 'src';
const EXTENSIONS = ['.ts', '.html', '.scss'];

/** Matches '/assets/…', "/assets/…" and url(/assets/…). */
const ABSOLUTE_ASSET_URL = /['"(]\/assets\//;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return EXTENSIONS.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

describe('asset paths', () => {
  it('never references assets with an absolute URL', () => {
    const offenders = collectSourceFiles(SOURCE_ROOT)
      .filter((path) => !path.endsWith('asset-paths.spec.ts'))
      .flatMap((path) =>
        readFileSync(path, 'utf-8')
          .split('\n')
          .map((line, index) => ({ path, line: index + 1, text: line.trim() }))
          .filter(({ text }) => ABSOLUTE_ASSET_URL.test(text))
      )
      .map(({ path, line, text }) => `${path}:${line} → ${text}`);

    expect(offenders, 'Use "assets/..." instead of "/assets/..."').toEqual([]);
  });
});
