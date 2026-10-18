// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string[] => readFileSync(new URL(path, import.meta.url), 'utf8').split(/\r?\n/);

/**
 * The lines of a top-level key (`services:`, `x-hardened:`) or of a service, as compose reads them:
 * comments and blank lines dropped, and the keys `ports` and `networks` with what they hold, which the
 * Unraid file sets its own way (addresses of their own in the LAN, no port on the server)
 */
function block(lines: readonly string[], key: string, indent: number): string[] {
  const start = lines.findIndex((line) => line === `${' '.repeat(indent)}${key}:` || line.startsWith(`${' '.repeat(indent)}${key}: `));
  if (start < 0) return [];
  const out: string[] = [];
  let skipDeeperThan = -1;
  for (let k = start + 1; k < lines.length; k++) {
    const line = lines[k];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const depth = line.length - line.trimStart().length;
    if (depth <= indent) break;
    if (skipDeeperThan >= 0 && depth > skipDeeperThan) continue;
    skipDeeperThan = -1;
    if (/^\s*(ports|networks):/.test(line)) {
      skipDeeperThan = depth;
      continue;
    }
    out.push(line);
  }
  return out;
}

describe('the Unraid compose file', () => {
  const main = read('../docker-compose.yml');
  const unraid = read('../unraid/docker-compose.yml');

  it('runs the same three services as the main file, with the same images, settings and volumes', () => {
    const services = (lines: readonly string[]) => lines.slice(lines.indexOf('services:'));
    for (const service of ['overpass', 'proxy', 'status']) {
      const own = block(services(unraid), service, 2);
      expect(own.length, service).toBeGreaterThan(5);
      expect(own, service).toEqual(block(services(main), service, 2));
    }
    expect(block(unraid, 'x-hardened', 0)).toEqual(block(main, 'x-hardened', 0));
    expect(block(unraid, 'x-unraid', 0)).toEqual(block(main, 'x-unraid', 0));
  });

  it('starts nothing else, publishes no port and declares no profile', () => {
    const services = block(unraid, 'services', 0).filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
    expect(services).toEqual(['overpass', 'proxy', 'status']);
    expect(unraid.some((l) => /^\s*(ports|profiles):/.test(l))).toBe(false);
  });

  it('leaves the clone to its own file, sharing the named volume', () => {
    const clone = read('../unraid/docker-compose.clone.yml');
    expect(block(clone, 'services', 0).filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim())).toEqual(['clone:']);
    expect(block(clone, 'volumes', 0)).toEqual(block(unraid, 'volumes', 0));
  });
});
