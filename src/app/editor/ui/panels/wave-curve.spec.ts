import { ENEMY_TYPES, lineageHp } from '../../../configs/enemy-types.config';
import type { WaveTable } from '../../../director/sources/table/wave-table';
import { shortNumber, waveCurve } from './wave-curve';

describe('wave curve (balance aids, TODO E170)', () => {
  const table: WaveTable = {
    cycle: { fromWave: 2, hpGrowth: 2 },
    waves: [
      { wave: 1, name: 'Few', enemies: { zombie: 10 }, hpMult: 1, spawnDelay: 500 },
      { wave: 2, name: 'More', enemies: { zombie: 20, rat: 5 }, hpMult: 1.5, spawnDelay: 200 },
    ],
  };

  it('adds up HP, leak and spawning time per wave, and grows the cycle past the list', () => {
    const [w1, w2, w3] = waveCurve(table, 3);
    expect(w1).toEqual({ wave: 1, name: 'Few', enemies: 10, hp: 10 * lineageHp('zombie'), leak: w1.leak, seconds: 5 });
    expect(w1.leak).toBeGreaterThan(0);
    expect(w2.hp).toBe(Math.round((20 * ENEMY_TYPES['zombie'].baseHp + 5 * lineageHp('rat')) * 1.5));
    expect(w2.seconds).toBe(5);
    // Wave 3 is wave 2 again at twice the HP factor
    expect(w3).toMatchObject({ name: 'More', hp: Math.round((20 * ENEMY_TYPES['zombie'].baseHp + 5 * lineageHp('rat')) * 3), leak: w2.leak });
    expect(waveCurve({ cycle: table.cycle, waves: [] }, 5)).toEqual([]);
  });

  it('writes numbers short', () => {
    expect([shortNumber(950), shortNumber(12_400), shortNumber(1_250), shortNumber(3_100_000), shortNumber(31_000_000)]).toEqual(['950', '12k', '1.3k', '3.1M', '31M']);
  });
});
