import { describe, expect, it } from 'vitest';
import { MAX_REPLAY_FILE_BYTES, REPLAY_FILE_VERSION, readReplayFile, replayFileRefusalText } from './replay-file';
import { SIM_SNAPSHOT_VERSION } from './sim-snapshot';
import { STATE_HASH_VERSION } from './state-hash';

const here = { worldKey: 'w', configHash: 'c', gameVersion: 'v1' };

/** A file the game would write: one wave, one command */
function file(patch: (f: Record<string, unknown>) => void = () => {}): string {
  const f: Record<string, unknown> = {
    format: '3dtd-replay', version: REPLAY_FILE_VERSION, snapshotVersion: SIM_SNAPSHOT_VERSION,
    hashVersion: STATE_HASH_VERSION, worldKey: 'w', configHash: 'c', gameVersion: 'v1', commit: 'x', seed: 1,
    createdAt: '2026-10-02T00:00:00.000Z',
    waves: [{ wave: 1, snapshot: {}, refusal: null, tainted: null, config: {}, startStep: 10, logStart: 0, endStep: 40, hashes: [1, 2] }],
    log: [{ step: 12, playerId: 'local', command: { type: 'command:place-tower' } }],
  };
  patch(f);
  return JSON.stringify(f);
}

describe('readReplayFile', () => {
  it('reads a file the game wrote', () => {
    expect(readReplayFile(file(), here).refusal).toBeNull();
  });

  it('refuses a text far above any replay before parsing it', () => {
    expect(readReplayFile('x'.repeat(MAX_REPLAY_FILE_BYTES + 1), here).refusal).toBe('too-big');
    expect(replayFileRefusalText('too-big')).toContain('too big');
  });

  it('refuses a damaged or hand-made file instead of handing it to the simulation', () => {
    const waves = (f: Record<string, unknown>) => (f['waves'] as Record<string, unknown>[])[0];
    const broken: ((f: Record<string, unknown>) => void)[] = [
      (f) => { waves(f)['logStart'] = 5; },                         // past the log
      (f) => { waves(f)['wave'] = 'one'; },
      (f) => { waves(f)['hashes'] = ['a']; },
      (f) => { waves(f)['config'] = null; },
      (f) => { waves(f)['endStep'] = 3; },                          // before its start
      (f) => { (f['log'] as Record<string, unknown>[])[0]['command'] = 'place'; },
      (f) => { (f['log'] as Record<string, unknown>[])[0]['step'] = -1; },
      (f) => { f['waves'] = [7]; },
    ];
    for (const patch of broken) expect(readReplayFile(file(patch), here).refusal).toBe('damaged');
    expect(replayFileRefusalText('damaged')).toContain('damaged');
  });
});
