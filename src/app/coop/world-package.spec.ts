import { describe, it, expect } from 'vitest';
import { buildWorldPackage, packageWorldRef, readWorldPackage, type WorldSource } from './world-package';
import { LEGACY_DEV_WORLD_REF } from '../world/world-ref';
import { TEST_WORLD_REF } from '../../test/world-context-fake';

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
  const data = buildWorldPackage(source(), { ...here, world: TEST_WORLD_REF }) as unknown as Record<string, unknown>;
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

  it('carries the world the host plays, and refuses a world of another shape', () => {
    const read = readWorldPackage(text(), here);
    expect(read.world?.world).toEqual(TEST_WORLD_REF);
    expect(readWorldPackage(text((d) => { d['world'] = { kind: 'moon' }; }), here).refusal).toBe('not-a-world');
  });
});

describe('packageWorldRef', () => {
  it('takes the package\'s world, and for one of before the field its origin', () => {
    expect(packageWorldRef({ world: TEST_WORLD_REF, origin: at(48.7, 9.1) }, 'google')).toEqual(TEST_WORLD_REF);
    expect(packageWorldRef({ origin: at(48.7, 9.1) }, 'google')).toEqual({ kind: 'tiles', source: 'google' });
    expect(packageWorldRef({ origin: at(0, 0) }, 'google')).toEqual(LEGACY_DEV_WORLD_REF);
  });
});
