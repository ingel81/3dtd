import { describe, it, expect } from 'vitest';
import { buildSaveFile, readSaveFile, saveFileName, saveFileRefusalText, type SaveParts } from './save-file';
import { buildWorldPackage } from '../coop/world-package';
import { emptySimSnapshot } from '../../test/sim-snapshot-fixture';
import { TEST_WORLD_REF } from '../../test/world-context-fake';

const HERE = { gameVersion: '0.7.0', configHash: 'abc' };

function parts(): SaveParts {
  const hq = { lat: 49.1, lon: 9.2 };
  const spawn = { id: 'spawn-1', name: 'Spawn 1', lat: 49.11, lon: 9.21 };
  return {
    ...HERE,
    commit: 'c0ffee',
    name: 'Heilbronn, wave 12',
    wave: 12,
    place: { name: 'Heilbronn', hq, spawns: [{ lat: spawn.lat, lon: spawn.lon }] },
    world: buildWorldPackage({
      origin: hq,
      hq,
      spawns: [spawn],
      paths: new Map([['spawn-1', [{ lat: spawn.lat, lon: spawn.lon }, hq]]]),
      heights: [[1, 2.5, 1]],
      worldKey: 'w1',
    }, { ...HERE, world: TEST_WORLD_REF }),
    sim: emptySimSnapshot(11),
    director: { source: 'budget', sourceState: null, planned: null },
    mainRng: { seed: 1, streams: { director: 7 } },
    runLog: null,
    waveSeries: [],
  };
}

const text = (overrides: Record<string, unknown> = {}) => JSON.stringify({ ...buildSaveFile(parts()), ...overrides });

describe('save file (TODO E110)', () => {
  it('carries the saved camera views, and reads saves from before them (TODO E20)', () => {
    const views = [null, { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } }];
    expect(readSaveFile(text({ cameraSlots: views }), HERE).file?.cameraSlots).toEqual(views);
    expect(readSaveFile(text(), HERE).file?.cameraSlots).toBeUndefined();
  });

  it('reads back what it wrote, without a note on the same version and balance', () => {
    const read = readSaveFile(text(), HERE);
    expect(read.refusal).toBeNull();
    expect(read.file?.wave).toBe(12);
    expect(read.file?.world.worldKey).toBe('w1');
    expect(read.refusal === null && read.note).toBeNull();
  });

  it('loads another game version or other values with a note', () => {
    const older = readSaveFile(text({ gameVersion: '0.6.0' }), HERE);
    expect(older.refusal === null && older.note).toBe('Saved with version 0.6.0, this is 0.7.0: values may differ.');
    const balance = readSaveFile(text({ configHash: 'zzz' }), HERE);
    expect(balance.refusal === null && balance.note).toBe('Saved with other tower or enemy values: values may differ.');
  });

  it('refuses another format, another snapshot shape and a damaged file', () => {
    expect(readSaveFile('{', HERE).refusal).toBe('not-a-save');
    expect(readSaveFile(JSON.stringify({ format: '3dtd-replay' }), HERE).refusal).toBe('not-a-save');
    expect(readSaveFile(text({ version: 99 }), HERE).refusal).toBe('version');
    expect(readSaveFile(text({ snapshotVersion: 1 }), HERE).refusal).toBe('version');
    expect(readSaveFile(text({ sim: null }), HERE).refusal).toBe('damaged');
    expect(readSaveFile(text({ world: { format: '3dtd-world' } }), HERE).refusal).toBe('damaged');
    expect(readSaveFile(text({ director: { source: 'nope', planned: null } }), HERE).refusal).toBe('damaged');
    expect(readSaveFile(text({ cameraSlots: [{ position: { x: 1 } }] }), HERE).refusal).toBe('damaged');
    expect(readSaveFile(text({ wave: 0 }), HERE).refusal).toBe('damaged');
  });

  it('refuses a snapshot, director or random state restore would stop half way on', () => {
    const sim = emptySimSnapshot(11);
    const broken: Record<string, unknown>[] = [
      { sim: { ...sim, clock: { gameTimeMs: 'later', subStep: 0 } } },
      { sim: { ...sim, research: { ...sim.research, active: [{ researchId: 'x', elapsed: null }] } } },
      { sim: { ...sim, abilities: { states: [{ id: 'nuke' }], nextStrikeId: 1 } } },
      { sim: { ...sim, hero: { ...sim.hero, hired: { lat: 1 } } } },
      { sim: { ...sim, towers: [{ id: 't1', typeId: 'archer', lat: 'x' }] } },
      { sim: { ...sim, rng: { seed: 1, streams: { spawn: 'x' } } } },
      { director: { source: 'budget', sourceState: { pressure: { multiplier: 'big' }, lastCapped: false }, planned: null } },
      { director: { source: 'budget', sourceState: 7, planned: null } },
      { mainRng: { seed: 1, streams: { director: null } } },
    ];
    for (const override of broken) expect(readSaveFile(text(override), HERE).refusal, JSON.stringify(override)).toBe('damaged');
    const pressure = { smoothed: null, samples: 0, multiplier: 1, lastStep: 'warming-up', lastTarget: null, lastPressure: null, lastChange: 1 };
    expect(readSaveFile(text({ director: { source: 'budget', sourceState: { pressure, lastCapped: false }, planned: null } }), HERE).refusal).toBeNull();
    expect(saveFileRefusalText('damaged')).toBe('That save is damaged.');
  });

  it('refuses a save with an unreleased tower or path in a production build, and names it (configs/release.ts)', () => {
    const sim = emptySimSnapshot(11);
    const tower = (typeId: string, pathId: string | null) => ({
      id: 't1', typeId, lat: 49.1, lon: 9.2, height: 0, customRotation: 0, plinthHeight: 0, plinthOverhang: [], upgrades: [],
      losMask: null, state: { cooldownMs: 0, kills: 0, damageDealt: 0, pathId },
    });
    const withTower = (typeId: string, pathId: string | null = null) => text({ sim: { ...sim, towers: [tower(typeId, pathId)] } });
    const bastion = readSaveFile(withTower('bastion'), HERE, true);
    expect(bastion.refusal).toBe('unreleased');
    expect(bastion.refusal !== null && saveFileRefusalText(bastion.refusal, bastion.detail))
      .toBe('That save uses Iron Bastion, which this version of the game does not have yet.');
    expect(readSaveFile(withTower('archer', 'incendiary'), HERE, true).refusal).toBe('unreleased');
    expect(readSaveFile(withTower('archer', 'scout'), HERE, true).refusal).toBeNull();
    // A dev build loads it
    expect(readSaveFile(withTower('bastion'), HERE, false).refusal).toBeNull();
  });

  it('names the download after place and wave', () => {
    expect(saveFileName('Heilbronn, Kiliansplatz', 12))
      .toBe('3dtd-save-heilbronn-kiliansplatz-w12.json.gz');
  });
});
