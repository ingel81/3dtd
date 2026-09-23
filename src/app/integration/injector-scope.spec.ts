/**
 * A root service must not inject a service the game component provides.
 *
 * The root injector cannot see the component's providers, so such an inject
 * throws NG0201 on the first real start. Unit tests do not notice: TestBed
 * provides everything at the root. It happened twice with RunLogFacade (the
 * bot client, then the WaveDirector); both are now handed in through
 * `initialize` instead. This reads the sources, so it catches the next one
 * before the browser does.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const APP = resolve('src/app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Class names in the `providers` array of TowerDefenseComponent. */
function componentScoped(): string[] {
  const source = readFileSync(join(APP, 'tower-defense.component.ts'), 'utf8');
  const block = /providers:\s*\[([\s\S]*?)\]/.exec(source);
  if (!block) throw new Error('providers array of TowerDefenseComponent not found');
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter((name) => /^[A-Z]\w*$/.test(name));
}

describe('injector scope', () => {
  const scoped = componentScoped();

  it('finds the component-scoped services', () => {
    expect(scoped).toContain('GameStateManager');
    expect(scoped).toContain('WaveDirector');
  });

  it('no root service injects a component-scoped one', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(APP)) {
      const source = readFileSync(file, 'utf8');
      if (!/@Injectable\(\{\s*providedIn:\s*'root'/.test(source)) continue;
      for (const name of scoped) {
        if (new RegExp(`\\binject\\(\\s*${name}\\b`).test(source)) {
          offenders.push(`${relative(APP, file).replaceAll('\\', '/')} injects ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
