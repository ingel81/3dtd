import { describe, it, expect } from 'vitest';
import { buildSaveFile, readSaveFile, saveFileName, saveFileRefusalText, type SaveParts } from './save-file';
import { buildWorldPackage } from '../coop/world-package';
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from './sim-snapshot';

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
    }, HERE),
    sim: { version: SIM_SNAPSHOT_VERSION, towers: [], rng: { seed: 1, streams: {} } } as unknown as SimSnapshot,
    director: { source: 'budget', sourceState: null, planned: null },
    mainRng: { seed: 1, streams: { director: 7 } },
    runLog: null,
    waveSeries: [],
  };
}

const text = (overrides: Record<string, unknown> = {}) => JSON.stringify({ ...buildSaveFile(parts()), ...overrides });

describe('save file (TODO E110)', () => {
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
    expect(readSaveFile(text({ wave: 0 }), HERE).refusal).toBe('damaged');
    expect(saveFileRefusalText('damaged')).toBe('That save is damaged.');
  });

  it('names the download after place and wave', () => {
    expect(saveFileName('Heilbronn, Kiliansplatz', 12))
      .toBe('3dtd-save-heilbronn-kiliansplatz-w12.json.gz');
  });
});
