import { describe, it, expect, beforeEach } from 'vitest';

import { AdaptiveWaveSource } from './adaptive-source';
import { MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS, TEMPLATES } from '../../templates';
import { createEmptySnapshot, type GameStateSnapshot } from '../../models/game-state-snapshot';
import type { WaveResult } from '../../models/wave-result';
import { mulberry32 } from '../../../utils/game-rng';
import { templateObjectForWave } from '../../../configs/campaign.config';
import { PRESSURE_WARMUP_WAVES } from '../../pressure-controller';

/**
 * The adaptive source end to end: from a snapshot to a wave that ships.
 *
 * The rules, the sizing and the loop have their own specs; this one covers
 * what only the source does — the campaign pin, the template history across
 * waves, the boss substitution of the rotation, what it hands the run log,
 * and what it says about the waves ahead.
 */

/** A defense strong enough that the survivability cap has no finite value. */
function overwhelming(wave: number): GameStateSnapshot {
  const snapshot = createEmptySnapshot();
  const dps = { unarmored: 1e6, light: 1e6, heavy: 1e6, fortified: 1e6, ethereal: 1e6 };
  snapshot.waveNumber = wave - 1;
  snapshot.defense.totalDPS = 1e6;
  snapshot.defense.effectiveDPSPerArmor = { ground: dps, air: dps };
  snapshot.defense.gateDpsPerArmor = { ground: dps, air: dps };
  snapshot.defense.killThroughput = { ground: 1e6, air: 1e6 };
  snapshot.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  };
  return snapshot;
}

function waveResult(waveNumber: number, hpLost: number): WaveResult {
  return {
    waveNumber,
    timestamp: 0,
    config: { enemies: [], totalCount: 10, spawnDelay: 500 },
    outcome: { damageToPlayer: hpLost, healthAtWaveStart: 100, enemiesSpawned: 10, playerSurvived: true },
  } as unknown as WaveResult;
}

/** A defense the survivability cap holds back: the cap binds. */
function holding(wave: number): GameStateSnapshot {
  const snapshot = createEmptySnapshot();
  const dps = { unarmored: 60, light: 60, heavy: 60, fortified: 60, ethereal: 60 };
  snapshot.waveNumber = wave - 1;
  snapshot.defense.totalDPS = 400;
  snapshot.defense.effectiveDPSPerArmor = { ground: dps, air: dps };
  snapshot.defense.gateDpsPerArmor = { ground: dps, air: dps };
  snapshot.defense.killThroughput = { ground: 1, air: 1 };
  snapshot.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  };
  return snapshot;
}

describe('AdaptiveWaveSource', () => {
  let source: AdaptiveWaveSource;
  let random: () => number;

  const plan = (wave: number, state = overwhelming(wave)) => source.plan({ wave, state, random });

  beforeEach(() => {
    source = new AdaptiveWaveSource();
    random = mulberry32(20260922);
  });

  it('decides at wave end, so towers built in the pause do not size the coming wave', () => {
    expect(source.plansAt).toBe('wave-end');
  });

  describe('the wave it ships', () => {
    it('is the campaign template for wave 1, with the groups adding up', () => {
      const { wave, config } = plan(1);

      expect(wave).toBe(1);
      expect(config.templateIdx).toBe(0);
      expect(config.templateName).toBe(TEMPLATES[0].name);
      expect(config.enemies.map((e) => e.type)).toEqual(TEMPLATES[0].enemies.map(([type]) => type));
      expect(config.enemies.reduce((sum, e) => sum + e.count, 0)).toBe(config.totalCount);
      for (const group of config.enemies) expect(group.healthMultiplier).toBe(config.templateStrength);
      expect(config.spawnDelay).toBeGreaterThanOrEqual(MIN_SPAWN_DELAY_MS);
    });

    it('plans the wave it was asked for, not the one after the snapshot', () => {
      // A source may be asked at the end of the previous wave, where the
      // snapshot's counter is the wave that just finished.
      const state = overwhelming(7);       // counter says 6
      state.waveNumber = 6;
      const { config } = source.plan({ wave: 12, state, random });

      expect(config.templateName).toBe(templateObjectForWave(12)!.name);
    });

    it('never repeats the template of the wave before, past the campaign', () => {
      const picks: number[] = [];
      for (let wave = 41; wave <= 48; wave++) picks.push(plan(wave).config.templateIdx!);
      for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    });

    it('remembers the last five templates and forgets them on a new run', () => {
      for (let wave = 41; wave <= 48; wave++) plan(wave);
      expect(plan(49).explanation!.reasons[0]).toMatch(/in the last 5 waves/);

      source.reset();
      // W51, not W50: every fifth wave past the campaign is a boss wave, and
      // its first reason is the boss rule rather than the history.
      expect(plan(51).explanation!.reasons[0]).toMatch(/no history yet/);
    });

    it('spreads a compressed wave over the duration cap, not the count it was compressed for (TODO E41)', () => {
      // W16 of the Heilbronn coop run: compressed for thousands, shipped 148, 62 ms apart
      for (let wave = 11; wave <= 60; wave++) {
        for (const state of [overwhelming(wave), holding(wave)]) {
          const { config } = plan(wave, state);
          if (!config.explanation?.sizing?.durationCapped) continue;
          // The delay is whole ms: one more and the wave would run past the cap
          expect(config.totalCount * (config.spawnDelay + 1) > MAX_WAVE_DURATION_MS || config.spawnDelay === MIN_SPAWN_DELAY_MS).toBe(true);
        }
      }
    });

    it('stays inside the duration cap', () => {
      for (let wave = 41; wave <= 50; wave++) {
        const { config } = plan(wave);
        const withinCap = config.totalCount * config.spawnDelay <= MAX_WAVE_DURATION_MS;
        expect(withinCap || config.spawnDelay === MIN_SPAWN_DELAY_MS).toBe(true);
      }
    });
  });

  /**
   * The rotation past the campaign sends bosses no template knows. The
   * substitution belongs here: while the facade did it, "which wave comes
   * next" was decided in two places (docs/WAVE_SOURCE_PLAN.md, section 2).
   */
  describe('the boss rotation', () => {
    it('ships the worm on W35 in place of the boss template', () => {
      const { config } = plan(35);

      expect(config.templateName).toBe('Boss: Skarnax');
      expect(config.enemies).toEqual([{ type: 'worm', count: 1, healthMultiplier: expect.any(Number) }]);
      expect(config.explanation!.reasons[0]).toContain("in place of the director's");
    });

    it('ships the ooze on W45', () => {
      const { config } = plan(45);
      expect(config.templateName).toBe('Boss: Ooze');
    });

    it('leaves W40 to the director\'s own boss template', () => {
      const { config } = plan(40);
      expect(TEMPLATES[config.templateIdx!].bossOnly).toBe(true);
      expect(config.templateName).not.toContain('Boss: Skarnax');
    });

    it('keeps the template of the wave in the history, not the variant', () => {
      // The variant is no template, so the cooldown has to remember what the
      // director picked underneath it.
      plan(35);
      const after = plan(36);
      expect(after.explanation!.reasons.some((r) => r.includes('no history yet'))).toBe(false);
    });
  });

  describe('what the run log gets', () => {
    it('carries the cap of the wave that ships and the loop it was sized with', () => {
      const { log } = plan(1, overwhelming(1));

      expect(log.pressureMultiplier).toBe(1);
      // Overwhelming defense: a cap far above any template, finite since E47
      expect(log.survivableCount).toBeGreaterThan(TEMPLATES[0].countRange[1]);
      // Nothing has finished yet, so the loop has no target to report. A
      // number here would be one nobody regulated against.
      expect(log.targetPressure).toBeUndefined();
    });

    it('hands the kill model behind the cap to the diagnostics (TODO E51)', () => {
      const { log } = plan(12, holding(12));
      expect(log.diagnostics).toMatchObject({
        killsPerSecond: expect.any(Number),
        engagementS: expect.any(Number),
        killable: expect.any(Number),
        leakAllowance: expect.any(Number),
      });
    });

    it('reports the target once waves have finished', () => {
      source.onWaveResult(waveResult(PRESSURE_WARMUP_WAVES + 1, 4));
      expect(plan(41).log.targetPressure).toBeGreaterThan(0);
    });

    it('reports no cap for a boss variant, which nothing sized', () => {
      expect(plan(35).log.survivableCount).toBeNull();
    });
  });

  describe('a finished wave', () => {
    it('does not measure a wave the HQ was cheated in (TODO E44)', () => {
      for (let wave = PRESSURE_WARMUP_WAVES + 1; wave <= PRESSURE_WARMUP_WAVES + 6; wave++) {
        source.onWaveResult(waveResult(wave, 0));
      }
      const before = { ...source.pressure.status, multiplier: source.pressure.pressureMultiplier };
      const cheated = waveResult(PRESSURE_WARMUP_WAVES + 7, 90);
      cheated.outcome.cheated = true;
      source.onWaveResult(cheated);
      expect(source.pressure.pressureMultiplier).toBe(before.multiplier);
      expect(source.pressure.status.samples).toBe(before.samples);
    });

    it('does not open the loop after a boss variant, which no cap sized (TODO E41)', () => {
      // Cheap waves under a binding cap: the loop opens
      for (let wave = 31; wave <= 34; wave++) {
        plan(wave, holding(wave));
        source.onWaveResult(waveResult(wave, 0));
      }
      expect(source.pressure.status.lastStep).toBe('opened');
      const before = source.pressure.pressureMultiplier;
      // W35 ships the worm in place of what the director planned under the cap
      plan(35, holding(35));
      source.onWaveResult(waveResult(35, 0));
      expect(source.pressure.status.lastStep).toBe('held');
      expect(source.pressure.pressureMultiplier).toBe(before);
    });

    it('moves the loop, and a new run clears it', () => {
      for (let i = 0; i < 12; i++) {
        source.onWaveResult(waveResult(PRESSURE_WARMUP_WAVES + 1 + i, 0));
      }
      expect(source.pressure.pressureMultiplier).toBeGreaterThan(1);

      source.reset();
      expect(source.pressure.pressureMultiplier).toBe(1);
      expect(source.pressure.status.samples).toBe(0);
    });
  });

  describe('what it says about the waves ahead', () => {
    const peek = (fromWave: number, count: number) =>
      source.peek({ fromWave, count, defense: { totalDps: 400 } });

    it('knows every campaign wave, with a count range and its armor', () => {
      const [first] = peek(1, 1);

      expect(first).toMatchObject({ wave: 1, name: TEMPLATES[0].name, known: true, boss: false });
      expect(first.count!.lo).toBe(TEMPLATES[0].countRange[0]);
      expect(first.count!.hi).toBeGreaterThanOrEqual(first.count!.lo);
      expect(first.hpByArmor.length).toBeGreaterThan(0);
      expect(first.enemies).toEqual(TEMPLATES[0].enemies);
    });

    it('marks the air wave of the campaign as air', () => {
      expect(peek(7, 1)[0].air).toBe(true);
    });

    it('does not pretend to know a wave it picks at wave start', () => {
      const [w41] = peek(41, 1);

      expect(w41.known).toBe(false);
      expect(w41.count).toBeNull();
      expect(w41.note).toBe('Template picked at wave start');
    });

    it('names the campaign boss a variant takes, as the wave will ship (TODO E41)', () => {
      expect(peek(20, 1)[0]).toMatchObject({ name: 'Boss: Ooze', boss: true });
      expect(peek(30, 1)[0]).toMatchObject({ name: 'Boss: Skarnax', boss: true });
      expect(peek(10, 1)[0].name).toBe(plan(10).config.templateName);
    });

    it('knows the boss waves the rotation owns', () => {
      const [w35] = peek(35, 1);

      expect(w35).toMatchObject({ name: 'Boss: Skarnax', known: true, boss: true });
      expect(w35.enemies).toEqual([['worm', 1]]);
    });

    it('answers as many waves as asked, in order, and changes nothing', () => {
      const first = peek(30, 5);
      expect(first.map((f) => f.wave)).toEqual([30, 31, 32, 33, 34]);
      expect(peek(30, 5)).toEqual(first);
      // The next plan is untouched by the peeks above.
      expect(plan(31).wave).toBe(31);
    });
  });
});
