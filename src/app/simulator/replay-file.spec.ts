import { describe, expect, it } from 'vitest';
import {
  MAX_REPLAY_FILE_BYTES, REPLAY_FILE_VERSION, readReplayFile, replayFileRefusalText, serializeReplayFile, type ReplayFile,
  replayFileBlob, replayFileName, replayFileText,
} from './replay-file';
import type { WaveRecord } from './sim-recorder';
import { SIM_SNAPSHOT_VERSION } from './sim-snapshot';
import { STATE_HASH_VERSION } from './state-hash';

const here = { worldKey: 'w', configHash: 'c', gameVersion: 'v1' };

/** A file the game would write: one wave, one command */
function file(patch: (f: Record<string, unknown>) => void = () => undefined): string {
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

describe('serializeReplayFile', () => {
  const mask = { range: 40, ground: true, air: false, bits: 'AAEC' };
  const other = { range: 60, ground: true, air: true, bits: 'AAEC' };
  function played(): ReplayFile {
    const parsed = JSON.parse(file()) as ReplayFile;
    const snapshot = (towers: unknown[]) => ({ towers }) as unknown as WaveRecord['snapshot'];
    parsed.waves = [
      { ...parsed.waves[0], snapshot: snapshot([{ id: 't1', losMask: mask }, { id: 't2', losMask: null }]) },
      { ...parsed.waves[0], wave: 2, snapshot: snapshot([{ id: 't1', losMask: { ...mask } }, { id: 't3', losMask: other }]) },
    ];
    parsed.log = [
      { step: 12, playerId: 'local', command: { type: 'los:resolved', towerId: 't1', reason: 'placed', mask: { ...mask } } },
      { step: 13, playerId: 'local', command: { type: 'command:place-tower' } },
    ] as unknown as ReplayFile['log'];
    return parsed;
  }

  it('keeps each line of sight once and reads the file back as it was', () => {
    const source = played();
    const text = serializeReplayFile(source);
    expect((JSON.parse(text) as { masks: unknown[] }).masks).toEqual([mask, other]);
    const read = readReplayFile(text, here);
    expect(read.refusal).toBeNull();
    expect(read.file!.waves).toEqual(source.waves);
    expect(read.file!.log).toEqual(source.log);
    expect(read.file!.masks).toBeUndefined();
  });

  it('leaves what it was given untouched', () => {
    const source = played();
    const before = JSON.stringify(source);
    serializeReplayFile(source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('refuses an index that points nowhere', () => {
    const data = JSON.parse(serializeReplayFile(played())) as { masks: unknown[] };
    data.masks = data.masks.slice(0, 1);
    expect(readReplayFile(JSON.stringify(data), here).refusal).toBe('damaged');
  });

  it('still reads a file of version 2 with its masks in place', () => {
    const old = { ...played(), version: 2 };
    const read = readReplayFile(JSON.stringify(old), here);
    expect(read.refusal).toBeNull();
    expect(read.file!.log).toEqual(old.log);
  });
});

describe('replay file on disk', () => {
  it('saves gzipped and reads it back, and still reads a plain file', async () => {
    const text = file();
    const blob = await replayFileBlob(text);
    expect(blob.size).toBeLessThan(text.length);
    expect(await replayFileText(blob)).toBe(text);
    expect(await replayFileText(new Blob([text]))).toBe(text);
  });

  it('stops unpacking a file that grows past the cap', async () => {
    const blob = await replayFileBlob('0'.repeat(200_000));
    expect(await replayFileText(blob, 100_000)).toBe('too-big');
  });

  it('calls broken gzip no replay', async () => {
    const whole = new Uint8Array(await (await replayFileBlob(file())).arrayBuffer());
    expect(await replayFileText(new Blob([whole.slice(0, 20)]))).toBe('not-a-replay');
  });

  it('names the download .json.gz', () => {
    expect(replayFileName({ waves: [{ wave: 3 }, { wave: 9 }] } as ReplayFile, 'Kirchgasse')).toBe('3dtd-replay-kirchgasse-w3-w9.json.gz');
  });
});
