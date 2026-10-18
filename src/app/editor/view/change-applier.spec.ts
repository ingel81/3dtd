import { describe, expect, it } from 'vitest';
import { ChangeApplier, DRAPE_INTERVAL_MS, ENV_INTERVAL_MS, Throttle, WATER_INTERVAL_MS, type ChangeTarget } from './change-applier';

function setup() {
  let now = 1000;
  const calls: string[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(args.length ? `${name}:${JSON.stringify(args[0])}` : name);
  const target: ChangeTarget = {
    rebuild: log('rebuild'),
    layers: log('layers'),
    heights: log('heights'),
    splat: log('splat'),
    water: log('water'),
    waterBody: log('waterBody'),
    objects: log('objects'),
    paths: log('paths'),
    environment: log('environment'),
    life: log('life'),
    surfaces: log('surfaces'),
    soundChanged: log('sound'),
    groundMoved: log('ground'),
    redrape: log('redrape'),
    markers: log('markers'),
    selection: log('selection'),
  };
  const applier = new ChangeApplier(target, () => now);
  const take = () => calls.splice(0);
  return { applier, take, tick: (ms: number) => (now += ms) };
}

const rect = { i0: 0, j0: 0, i1: 4, j1: 4 };

describe('ChangeApplier', () => {
  it('lays the markers once at the start, then only after a change to them', () => {
    const { applier, take } = setup();
    applier.flush();
    expect(take()).toEqual(['markers']);
    applier.flush();
    expect(take()).toEqual([]);
    applier.selectionChanged();
    applier.flush();
    expect(take()).toEqual(['markers']);
    applier.add({ paths: true });
    applier.flush();
    expect(take()).toEqual(['paths', 'markers']);
  });

  it('merges the changes of a frame and hands each part over once', () => {
    const { applier, take } = setup();
    applier.flush();
    take();
    applier.add({ heights: rect, objects: ['a'] });
    applier.add({ heights: { i0: 2, j0: 2, i1: 8, j1: 6 }, objects: ['b', 'a'] });
    applier.flush();
    expect(take()).toEqual(['heights:{"i0":0,"j0":0,"i1":8,"j1":6}', 'objects:["a","b"]', 'ground', 'selection:["a","b"]']);
    // The overlay on the moved ground follows in a later frame
    applier.flush();
    expect(take()).toEqual(['redrape']);
    applier.flush();
    expect(take()).toEqual([]);
  });

  it('rebuilds slow parts at most once per interval, the last request after it', () => {
    const { applier, take, tick } = setup();
    applier.flush();
    take();
    applier.add({ environment: true });
    applier.flush();
    expect(take()).toEqual(['environment', 'sound']);
    tick(ENV_INTERVAL_MS / 2);
    applier.add({ environment: true });
    applier.flush();
    expect(take()).toEqual(['sound']);
    applier.flush();
    expect(take()).toEqual([]);
    tick(ENV_INTERVAL_MS / 2);
    applier.flush();
    expect(take()).toEqual(['environment']);
    applier.add({ water: true });
    applier.flush();
    applier.add({ water: true });
    applier.flush();
    expect(take().filter((c) => c === 'water')).toEqual(['water']);
    tick(WATER_INTERVAL_MS);
    applier.flush();
    expect(take()).toContain('water');
  });

  it('lays the overlay again on moving ground after the drape interval, not in the frame of the stroke', () => {
    const { applier, take, tick } = setup();
    applier.flush();
    take();
    applier.add({ heights: rect });
    applier.flush();
    expect(take()).toEqual(['heights:' + JSON.stringify(rect), 'ground']);
    applier.flush();
    expect(take()).toEqual(['redrape']);
    applier.add({ heights: rect });
    applier.flush();
    tick(DRAPE_INTERVAL_MS - 1);
    applier.flush();
    expect(take()).not.toContain('redrape');
    tick(1);
    applier.flush();
    expect(take()).toEqual(['redrape']);
  });

  it('drops what waits when the view is rebuilt for a new terrain', () => {
    const { applier, take } = setup();
    applier.flush();
    take();
    applier.add({ terrain: true, heights: rect, objects: 'all' });
    applier.flush();
    // The routes the worker found lie again on the new ground
    expect(take()).toEqual(['rebuild', 'ground', 'markers']);
    applier.flush();
    expect(take()).toEqual(['redrape']);
    applier.add({ objects: ['x'] });
    applier.reset();
    applier.flush();
    expect(take()).toEqual(['markers']);
  });

  it('draws one water body alone when only its mask changed', () => {
    const { applier, take } = setup();
    applier.flush();
    take();
    applier.add({ bodies: [0, 2], bodyRect: rect });
    applier.flush();
    expect(take()).toEqual(['waterBody:0', 'waterBody:2']);
  });
});

describe('Throttle', () => {
  it('runs at once after the interval and once at the end of a burst', () => {
    let now = 0;
    let runs = 0;
    const t = new Throttle(100, () => now, () => runs++);
    t.request();
    t.request();
    expect(runs).toBe(1);
    now = 99;
    t.poll();
    expect(runs).toBe(1);
    now = 100;
    t.poll();
    t.poll();
    expect(runs).toBe(2);
  });
});
