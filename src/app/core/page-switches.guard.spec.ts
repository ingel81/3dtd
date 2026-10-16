import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Every source file of the app, specs left out */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * Only two places read the address (docs/WORLDS_NAVIGATION_PLAN.md, 4.6
 * risk 2): the start order reads a link once (world-start.ts), the
 * switches of development are read where they stay (page-switches.ts). A
 * reader elsewhere would act after a world change as at the page's start.
 */
describe('readers of the address', () => {
  it('reads location.search only in the start order and the page switches', () => {
    const root = join(process.cwd(), 'src', 'app');
    const readers = sources(root)
      .filter((path) => /location\.search\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).split(sep).join('/'))
      .sort();
    expect(readers).toEqual(['core/page-switches.ts', 'world/world-start.ts']);
  });
});
