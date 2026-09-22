import { describe, it, expect } from 'vitest';

import { TableWaveSource } from './table-source';
import {
  LAST_TABLE_WAVE,
  WAVE_TABLE,
  tableRowForWave,
  validateWaveTable,
  type WaveTable,
} from './wave-table';
import { createEmptySnapshot } from '../../models/game-state-snapshot';

/**
 * The table source and the list it plays.
 *
 * There is no checked-in reference run for this source, and it needs none:
 * the list IS the reference. What a spec has to say instead is that the wave
 * that ships is the row, unchanged — that is asserted below over the whole
 * list rather than against a second file that could drift from it.
 */

const state = createEmptySnapshot();
const random = () => 0.5;
const plan = (wave: number) => new TableWaveSource().plan({ wave, state, random });

describe('the wave list', () => {
  it('is valid', () => {
    expect(validateWaveTable()).toEqual([]);
  });

  it('starts at wave 1 and has no gaps', () => {
    const numbers = WAVE_TABLE.waves.map((row) => row.wave);
    expect(numbers[0]).toBe(1);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('names what is wrong instead of throwing', () => {
    const broken: WaveTable = {
      cycle: { fromWave: 99, hpGrowth: 0 },
      waves: [
        { wave: 2, name: 'starts late', enemies: { zombie: 1 }, hpMult: 1, spawnDelay: 100 },
        { wave: 2, name: 'again', enemies: { dragon_of_doom: 3 }, hpMult: 0, spawnDelay: 100 },
      ],
    };
    const problems = validateWaveTable(broken);

    expect(problems).toContain('wave 2: listed twice');
    expect(problems).toContain('wave 2: unknown enemy type "dragon_of_doom"');
    expect(problems).toContain('wave 2: hpMult 0');
    expect(problems).toContain('cycle.hpGrowth must be positive');
    expect(problems).toContain('the list starts at wave 2, not 1');
    expect(problems).toContain('cycle.fromWave 99 is past the last wave 2');
  });
});

describe('TableWaveSource', () => {
  it('commits at wave end, because it reads nothing at wave start', () => {
    expect(new TableWaveSource().plansAt).toBe('wave-end');
  });

  it('ships every row exactly as it is written down', () => {
    for (const row of WAVE_TABLE.waves) {
      const { config } = plan(row.wave);
      const expected = Object.entries(row.enemies);

      expect(config.templateName, `wave ${row.wave}`).toBe(row.name);
      expect(config.spawnDelay).toBe(row.spawnDelay);
      expect(config.spawnDelayVariation).toBe(row.spawnDelayVariation);
      expect(config.templateStrength).toBe(row.hpMult);
      expect(config.enemies.map((group) => [group.type, group.count])).toEqual(expected);
      expect(config.totalCount).toBe(expected.reduce((sum, [, count]) => sum + count, 0));
      for (const group of config.enemies) expect(group.healthMultiplier).toBe(row.hpMult);
    }
  });

  it('sends the same wave whatever the defense looks like', () => {
    const weak = createEmptySnapshot();
    const strong = createEmptySnapshot();
    strong.defense.totalDPS = 1e6;
    strong.defense.killThroughput = { ground: 1e6, air: 1e6 };

    const source = new TableWaveSource();
    expect(source.plan({ wave: 12, state: strong, random }).config)
      .toEqual(source.plan({ wave: 12, state: weak, random }).config);
  });

  it('draws no randomness at all', () => {
    let draws = 0;
    const counted = () => { draws++; return 0.5; };
    new TableWaveSource().plan({ wave: 7, state, random: counted });
    expect(draws).toBe(0);
  });

  describe('past the last row', () => {
    it('runs the cycle stretch again and grows its HP once per round', () => {
      const first = WAVE_TABLE.cycle.fromWave;
      const stretch = LAST_TABLE_WAVE - first + 1;

      const repeat = tableRowForWave(LAST_TABLE_WAVE + 1)!;
      expect(repeat.row.wave).toBe(first);
      expect(repeat.cycle).toBe(1);
      expect(repeat.hpMult).toBeCloseTo(repeat.row.hpMult * WAVE_TABLE.cycle.hpGrowth, 3);

      const second = tableRowForWave(LAST_TABLE_WAVE + 1 + stretch)!;
      expect(second.row.wave).toBe(first);
      expect(second.cycle).toBe(2);
      expect(second.hpMult).toBeCloseTo(repeat.row.hpMult * WAVE_TABLE.cycle.hpGrowth ** 2, 3);
    });

    it('keeps the counts of the row and only moves the HP', () => {
      const repeat = plan(LAST_TABLE_WAVE + 1);
      const origin = plan(WAVE_TABLE.cycle.fromWave);

      expect(repeat.config.enemies.map((group) => [group.type, group.count]))
        .toEqual(origin.config.enemies.map((group) => [group.type, group.count]));
      expect(repeat.config.templateStrength!).toBeGreaterThan(origin.config.templateStrength!);
    });

    it('says in the explanation that the wave is a repeat', () => {
      const { explanation } = plan(LAST_TABLE_WAVE + 1);
      expect(explanation!.reasons[0]).toContain('runs again, round 1');
    });
  });

  describe('what it tells the rest of the game', () => {
    it('writes its row, its round and its HP into the run log', () => {
      const { log } = plan(LAST_TABLE_WAVE + 1);
      expect(log.survivableCount).toBeNull();
      expect(log.pressureMultiplier).toBeUndefined();
      expect(log.diagnostics).toMatchObject({ tableWave: WAVE_TABLE.cycle.fromWave, tableCycle: 1 });
    });

    it('explains every wave in its own words, without a sizing block', () => {
      const { explanation } = plan(1);
      expect(explanation!.summary).toContain(WAVE_TABLE.waves[0].name);
      expect(explanation!.reasons.some((r) => r.includes('Written down'))).toBe(true);
      // Nothing ramped, capped or corrected anything, so there is no sizing.
      expect(explanation!.sizing).toBeUndefined();
    });

    it('knows every wave ahead, with its exact count', () => {
      const facts = new TableWaveSource()
        .peek({ fromWave: 1, count: 3, defense: { totalDps: 0 } });

      expect(facts.map((f) => f.wave)).toEqual([1, 2, 3]);
      for (const fact of facts) {
        expect(fact.known).toBe(true);
        expect(fact.count!.lo).toBe(fact.count!.hi);
        expect(fact.count!.hi).toBe(fact.count!.max);
      }
      const row = WAVE_TABLE.waves[0];
      expect(facts[0].count!.lo).toBe(Object.values(row.enemies).reduce((a, b) => a + b, 0));
      expect(facts[0].name).toBe(row.name);
    });

    it('marks an air wave and a boss wave from the enemies in the row', () => {
      const air = WAVE_TABLE.waves.find((row) => Object.keys(row.enemies).includes('bat'))!;
      const boss = WAVE_TABLE.waves.find((row) => Object.keys(row.enemies).includes('herbert'))!;
      const source = new TableWaveSource();
      const peek = (wave: number) =>
        source.peek({ fromWave: wave, count: 1, defense: { totalDps: 0 } })[0];

      expect(peek(air.wave).air).toBe(true);
      expect(peek(boss.wave).boss).toBe(true);
      expect(peek(air.wave).boss).toBe(false);
    });
  });
});
