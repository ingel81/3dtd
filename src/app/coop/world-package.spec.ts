import { describe, it, expect } from 'vitest';
import { buildWorldPackage, readWorldPackage, type WorldSource } from './world-package';

const here = { gameVersion: '0.5.1', configHash: 'abc' };
const at = (lat: number, lon: number) => ({ lat, lon, height: 0 });

function source(): WorldSource {
  const route = [at(48.775, 9.18), at(48.776, 9.181)];
  return {
    origin: at(48.775, 9.18),
    hq: at(48.776, 9.181),
    spawns: [{ id: 'spawn-1', name: 'Spawn 1', ...route[0] }],
    paths: new Map([['spawn-1', route]]),
    heights: [[1, 240.5, 1], [2, 241, 2]],
    worldKey: 'key',
  } as unknown as WorldSource;
}

/** The package as text, `change` applied to its data first */
const text = (change: (data: Record<string, unknown>) => void = () => undefined) => {
  const data = buildWorldPackage(source(), here) as unknown as Record<string, unknown>;
  change(data);
  return JSON.stringify(data);
};

describe('readWorldPackage', () => {
  it('takes a package the host built', () => {
    expect(readWorldPackage(text(), here).refusal).toBeNull();
  });

  it('refuses places off the earth, broken routes and height rows of another shape', () => {
    const broken: ((d: Record<string, unknown>) => void)[] = [
      (d) => { (d['hq'] as Record<string, unknown>)['lat'] = 'x'; },
      (d) => { (d['origin'] as Record<string, unknown>)['lon'] = 500; },
      (d) => { (d['paths'] as unknown[][])[0][1] = [{ lat: 1 }]; },
      (d) => { (d['paths'] as unknown[]).push('spawn-2'); },
      (d) => { (d['heights'] as unknown[]).push([3, 1]); },
      (d) => { (d['spawns'] as unknown[]).push({ lat: 1, lon: 1 }); },
    ];
    // NaN goes through JSON as null
    for (const change of broken) expect(readWorldPackage(text(change), here).refusal).toBe('not-a-world');
  });
});
