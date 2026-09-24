import { describe, it, expect } from 'vitest';
import { laneSchedule, type SpawnSchedule } from './wave.manager';

const schedule: SpawnSchedule = {
  entries: [
    { enemyType: 'zombie', speed: 1 },
    { enemyType: 'bat', speed: 1, delay: 500, pauseAfter: 2000 },
    { enemyType: 'ooze', speed: 1 },
  ],
  baseDelay: 300,
  delayVariation: 0.2,
  spawnMode: 'random',
};

describe('laneSchedule (COOP_PLAN D13)', () => {
  it('leaves the schedule alone without lanes', () => {
    expect(laneSchedule(schedule, [])).toBe(schedule);
  });

  it('puts every entry on every lane, the copies at once, the gap after the entry as before', () => {
    const laid = laneSchedule(schedule, ['s1', 's2', 's3']);
    expect(laid.entries.map((e) => `${e.enemyType}@${e.spawnPointId}`)).toEqual([
      'zombie@s1', 'zombie@s2', 'zombie@s3',
      'bat@s1', 'bat@s2', 'bat@s3',
      'ooze@s1', 'ooze@s2', 'ooze@s3',
    ]);
    expect(laid.entries.map((e) => e.delay)).toEqual([0, 0, undefined, 0, 0, 500, 0, 0, undefined]);
    expect(laid.entries.map((e) => e.pauseAfter)).toEqual([undefined, undefined, undefined, undefined, undefined, 2000, undefined, undefined, undefined]);
    expect(laid.baseDelay).toBe(300);
    expect(laid.delayVariation).toBe(0.2);
  });

  it('draws a gap from the spawn stream as often as the schedule alone', () => {
    // A gap is drawn after an entry without its own delay (WaveManager.startWave)
    const draws = (s: SpawnSchedule) => s.entries.slice(0, -1).filter((e) => e.delay === undefined).length;
    expect(draws(laneSchedule(schedule, ['s1', 's2']))).toBe(draws(schedule));
  });
});
