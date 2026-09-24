import { describe, it, expect, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import { WaveDirector } from '../../wave-director';
import { AdaptiveWaveSource } from './adaptive-source';
import { mulberry32 } from '../../../utils/game-rng';
import { StateSnapshotService } from '../../state-snapshot.service';
import { PRESSURE_MIN_SAMPLES, PRESSURE_WARMUP_WAVES, targetPressure } from './pressure-controller';
import { TEMPLATES } from '../../templates';
import { survivableCount } from './wave-sizing';
import { createEmptySnapshot, type GameStateSnapshot } from '../../models/game-state-snapshot';
import type { WaveResult } from '../../models/wave-result';

/**
 * Wiring tests, as opposed to unit tests.
 *
 * The gate controller first shipped with full unit coverage, a correct
 * proportional loop, and no caller: `onWaveCompleted` was never invoked
 * anywhere in the project, so the multiplier stayed at 1.0 for the lifetime
 * of the app and the mechanism was inert. Every unit test passed, because each
 * one drove the controller directly.
 *
 * The first attempt at closing that gap repeated the mistake: it exercised a
 * hand-written fake of the collector, so deleting the real subscription — the
 * exact defect under test — left it green.
 *
 * These construct the REAL WaveDirector against a stubbed collector, so
 * both connections are load-bearing:
 *   1. a finished wave reaches the controller
 *   2. the controller's output actually changes the wave that ships
 */

/** Minimal stand-in for the collector: only what the director actually calls. */
class StubCollector {
  private listeners: ((r: WaveResult) => void)[] = [];
  snapshot: GameStateSnapshot = defenceSnapshot();
  lastConfig: unknown = null;

  onWaveResult(listener: (r: WaveResult) => void): () => void {
    this.listeners.push(listener);
    return () => { /* not exercised: both services share a component injector */ };
  }

  /** Mirrors StateSnapshotService.addToHistory notifying its listeners. */
  emitWaveResult(result: WaveResult): void {
    for (const l of this.listeners) l(result);
  }

  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }

  setCurrentWaveConfig(config: unknown): void {
    this.lastConfig = config;
  }
}

/** A snapshot with enough defense for the fairness cap to be finite and binding. */
function defenceSnapshot(): GameStateSnapshot {
  const s = createEmptySnapshot();
  s.waveNumber = 40;                       // past the campaign pin: a real choice
  s.player.lives = 100;
  s.defense.totalDPS = 400;
  s.defense.towerCount = 8;
  s.defense.effectiveDPSPerArmor = {
    ground: { unarmored: 120, light: 120, heavy: 120, fortified: 120, ethereal: 120 },
    air: { unarmored: 120, light: 120, heavy: 120, fortified: 120, ethereal: 120 },
  } as GameStateSnapshot['defense']['effectiveDPSPerArmor'];
  s.defense.gateDpsPerArmor = s.defense.effectiveDPSPerArmor;
  s.defense.killThroughput = { ground: 3, air: 3 };
  s.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  } as GameStateSnapshot['defense']['capabilities'];
  return s;
}

/**
 * A finished wave that cost `hpLost` of `hpAtStart`.
 *
 * `waveNumber` has to clear the warmup, otherwise the loop ignores it by
 * design.
 */
function waveResult(
  hpLost: number,
  hpAtStart = 100,
  waveNumber = PRESSURE_WARMUP_WAVES + 1,
  enemiesSpawned = 20,
): WaveResult {
  return {
    waveNumber,
    timestamp: 0,
    config: { enemies: [], totalCount: enemiesSpawned, spawnDelay: 500 },
    outcome: {
      damageToPlayer: hpLost,
      healthAtWaveStart: hpAtStart,
      enemiesSpawned,
      playerSurvived: true,
    },
  } as unknown as WaveResult;
}

describe('gate wiring', () => {
  let collector: StubCollector;
  let director: WaveDirector;
  /** The wave the next plan is for: `ensurePlanned` is idempotent per number. */
  let planWave: number;

  const feed = (result: WaveResult, times = PRESSURE_MIN_SAMPLES * 8) => {
    for (let i = 0; i < times; i++) collector.emitWaveResult(result);
  };

  /** The loop of the active source. The director itself has none. */
  const loop = () => (director.source as AdaptiveWaveSource).pressure;
  /**
   * A seeded director stream. Without it the factor jitter and the tie-break
   * draw from `Math.random`, and a test that compares two batches of waves
   * measures the dice instead of the loop.
   */
  const seedRandom = () => {
    const next = mulberry32(20260922);
    director.useRandomSource(() => next);
  };
  /** One more planned wave, past the campaign like the snapshot. */
  const nextWave = async () => (await director.getNextWave(planWave++)).config;

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({
      providers: [{ provide: StateSnapshotService, useValue: collector }],
    });
    director = runInInjectionContext(injector, () => new WaveDirector());
    planWave = collector.snapshot.waveNumber + 1;
    seedRandom();
  });

  it('sizes a wave by the defense at the end of the wave before, not by towers built in the pause', async () => {
    // User, 2026-09-24: towers placed before pressing start made the same
    // wave harder than towers placed after it. Planned at wave end, the pause
    // no longer counts.
    const next = collector.snapshot.waveNumber + 1;
    collector.emitWaveResult(waveResult(3, 100, next - 1));
    const committed = director.committed;
    expect(committed?.wave).toBe(next);

    // The pause: the player builds a lot before starting
    const defense = collector.snapshot.defense;
    defense.totalDPS *= 20;
    defense.towerCount += 30;

    const shipped = await director.getNextWave(next);
    expect(shipped).toBe(committed);
  });

  describe('completed waves reach the gate', () => {
    it('subscribes to the collector on construction', () => {
      // Deleting the subscription in the constructor must fail this.
      expect(loop().pressureMultiplier).toBe(1);
      feed(waveResult(0));                                   // cost nothing
      expect(loop().pressureMultiplier).toBeGreaterThan(1);
    });

    it('closes the budget when the waves cost too much', () => {
      feed(waveResult(0));
      const opened = loop().pressureMultiplier;
      expect(opened).toBeGreaterThan(1);

      feed(waveResult(40));                                  // 40% of HP a wave
      expect(loop().pressureMultiplier).toBeLessThan(opened);
    });

    it('holds inside the band', () => {
      // A wave that costs exactly the target must not move the loop at all.
      const target = targetPressure(PRESSURE_WARMUP_WAVES + 1);
      feed(waveResult(target * 100));
      expect(loop().pressureMultiplier).toBe(1);
      expect(loop().status.lastStep).toBe('held');
    });

    it('ignores the warmup waves', () => {
      // They measure a player without towers, not a defense. Letting them in
      // is what drove the old loop onto its lower stop within two waves.
      for (let w = 1; w <= PRESSURE_WARMUP_WAVES; w++) {
        collector.emitWaveResult(waveResult(70, 100, w));
      }
      expect(loop().pressureMultiplier).toBe(1);
      expect(loop().status.samples).toBe(0);
    });

    it('takes a single brutal wave seriously but not as the whole picture', () => {
      // A campaign-pinned air wave against a ground-only defense leaks hard.
      // The old mean over four waves let it drive the loop onto its stop in
      // two steps. Over eight it moves the loop by a step, no more: the wave
      // really did cost that HP, so ignoring it would be wrong too.
      feed(waveResult(0));
      const opened = loop().pressureMultiplier;
      collector.emitWaveResult(waveResult(60));
      const after = loop().pressureMultiplier;
      expect(after).toBeLessThan(opened);
      expect(after).toBeGreaterThan(opened / 1.5);
    });

    it('ignores waves that carry no HP reading', () => {
      // No HP at wave start is "no sample", not "nothing was lost". Counting
      // it as zero opens the budget on evidence that does not exist.
      feed(waveResult(0, 0));
      expect(loop().pressureMultiplier).toBe(1);
    });

    it('reads a healed player as headroom, not as a weaker defense', () => {
      // The condition for pickups and bought healing: 10 HP lost out of 100
      // and out of 200 are different pressures, and the second must not read
      // as "the wave got cheaper" just because the player has more HP. It
      // reads as exactly that, which is the point — the wave is allowed to
      // cost more in absolute HP once there is more to spend.
      feed(waveResult(4, 100));
      const atFull = loop().pressureMultiplier;

      director.resetForNewGame();
      feed(waveResult(8, 200));
      expect(loop().pressureMultiplier).toBe(atFull);
    });

    it('counts a cheap wave the cap did not size, but does not open on it', () => {
      // Der Messwert zählt, die Stellgröße bewegt sich nicht: Anti-Windup
      // gehört an die Stellgröße, nicht an die Messung.
      //
      // Andersherum ging es schief. Ein Filter, der solche Wellen gar nicht
      // erst zählte, machte bei einer starken Verteidigung 14 von 29 Wellen
      // unsichtbar - genau die billigen. Der Regler hielt den Schnitt für
      // 5,2 % während er bei null lag und fuhr nach einer teuren Welle von
      // ×5,75 auf ×0,62 herunter (docs/DRAMA_CONTROLLER_PLAN.md, Abschnitt 10).
      const gate = loop();
      for (let i = 0; i < PRESSURE_MIN_SAMPLES * 6; i++) {
        gate.recordWave(0, PRESSURE_WARMUP_WAVES + 1 + i, false);
      }
      expect(gate.pressureMultiplier).toBe(1);           // nicht geöffnet
      expect(gate.status.samples).toBeGreaterThan(0);    // aber gesehen
      expect(gate.status.meanPressure).toBe(0);

      // Schließen wirkt auch ohne bindenden Deckel: Es senkt ihn, bis er
      // wieder bindet.
      for (let i = 0; i < PRESSURE_MIN_SAMPLES * 6; i++) {
        gate.recordWave(0.4, PRESSURE_WARMUP_WAVES + 1 + i, false);
      }
      expect(gate.pressureMultiplier).toBeLessThan(1);
    });

    it('clears the gate for a new run', () => {
      feed(waveResult(0));
      expect(loop().pressureMultiplier).toBeGreaterThan(1);
      director.resetForNewGame();
      expect(loop().pressureMultiplier).toBe(1);
      expect(loop().status.samples).toBe(0);
    });
  });

  describe('the gate changes the wave that ships', () => {
    it('a wider budget ships bigger waves', async () => {
      // The other half of the blocker: a correctly-fed controller still does
      // nothing unless its output reaches survivableCount. Dropping the
      // `pressure.pressureMultiplier` argument in buildWaveConfig must fail
      // this.
      //
      // Averaged over many waves rather than compared one to one: the director
      // rotates templates to enforce variety, and templates carry different
      // count ranges, so any single pair can differ by template choice alone.
      const meanCount = async (waves: number) => {
        let total = 0;
        for (let i = 0; i < waves; i++) total += (await nextWave()).totalCount;
        return total / waves;
      };

      const tight = await meanCount(20);

      director.resetForNewGame();
      // Same wave numbers as the first half: the endgame HP multiplier and the
      // boss cadence both ride on the number, and they would otherwise drown
      // out the only thing this measures.
      planWave = collector.snapshot.waveNumber + 1;
      seedRandom();
      feed(waveResult(0), 40);                               // starve the gate
      expect(loop().pressureMultiplier).toBeGreaterThan(2);

      const wide = await meanCount(20);
      expect(wide).toBeGreaterThan(tight);
    });

    it('toughens the enemies and goes past the template ceiling when the cap is idle', async () => {
      // Die beiden Griffe für den Fall, dass die Verteidigung den Deckel
      // sprengt. Im menschlichen Lauf über 66 Wellen stand der Regler ab
      // Welle 26 am oberen Anschlag und die Wellen kosteten trotzdem nichts,
      // weil die Template-Obergrenze band
      // (docs/DRAMA_CONTROLLER_PLAN.md, Abschnitt 10).
      const wave = async () => {
        const c = await nextWave();
        return { count: c.totalCount, hp: c.enemies[0]?.healthMultiplier ?? 1 };
      };

      // Eine Abwehr, gegen die kein Deckel bindet.
      const fast = collector.snapshot.defense;
      const normal = { totalDPS: fast.totalDPS, killThroughput: fast.killThroughput, gateDpsPerArmor: fast.gateDpsPerArmor };
      const huge = { unarmored: 50_000, light: 50_000, heavy: 50_000, fortified: 50_000, ethereal: 50_000 };
      const overpower = () => {
        fast.totalDPS = 100_000;
        fast.killThroughput = { ground: 500, air: 500 };
        fast.gateDpsPerArmor = { ground: huge, air: huge } as typeof fast.gateDpsPerArmor;
      };
      overpower();

      let baseCount = 0;
      let baseHp = 0;
      for (let i = 0; i < 10; i++) {
        const w = await wave();
        baseCount = Math.max(baseCount, w.count);
        baseHp = Math.max(baseHp, w.hp);
      }

      director.resetForNewGame();
      // Same wave numbers as the first half: the endgame HP multiplier and the
      // boss cadence both ride on the number, and they would otherwise drown
      // out the only thing this measures.
      planWave = collector.snapshot.waveNumber + 1;
      seedRandom();
      // Starve the gate against a defense the cap binds on: planned at wave
      // end, every fed wave is planned again right away, and against the
      // overpowering defense the anti-windup would (rightly) keep it shut
      Object.assign(fast, normal);
      feed(waveResult(0), 40);
      expect(loop().pressureMultiplier).toBeGreaterThan(2);
      overpower();

      let openCount = 0;
      let openHp = 0;
      for (let i = 0; i < 10; i++) {
        const w = await wave();
        openCount = Math.max(openCount, w.count);
        openHp = Math.max(openHp, w.hp);
      }
      expect(openCount).toBeGreaterThan(baseCount);
      expect(openHp).toBeGreaterThan(baseHp);
      expect(openCount).toBeLessThanOrEqual(5000);           // COUNT_OVERRIDE_MAX
    });

    it('produces a shippable wave with no history at all', async () => {
      const config = await nextWave();
      expect(config.totalCount).toBeGreaterThan(0);
      expect(config.enemies.length).toBeGreaterThan(0);
      expect(collector.lastConfig).toBe(config);
    });
  });

  describe('survivableCount honours the multiplier', () => {
    // Spawn delay and throughput kept low enough that `1 - budget * delay`
    // stays positive across the range under test — otherwise survivableCount
    // returns null ("unbounded") and the assertions compare nothing. That guard
    // is real behaviour: a wave whose spawn window outlasts the defense's kill
    // rate has no finite cap.
    const capWith = (multiplier: number) => survivableCount(
      TEMPLATES[0], 1, 100,
      { ground: { unarmored: 100 }, air: { unarmored: 100 } },
      { ground: 2, air: 2 },
      () => 'unarmored', () => false, () => 50, () => 5, () => 1, () => 1,
      100, 1, multiplier,
    );

    it('opens and closes with the multiplier', () => {
      const base = capWith(1);
      expect(typeof base).toBe('number');
      expect(capWith(4)!).toBeGreaterThan(base!);
      expect(capWith(0.5)!).toBeLessThanOrEqual(base!);
    });

    it('defaults to neutral when omitted, so existing callers are unchanged', () => {
      const omitted = survivableCount(
        TEMPLATES[0], 1, 100,
        { ground: { unarmored: 100 }, air: { unarmored: 100 } },
        { ground: 2, air: 2 },
        () => 'unarmored', () => false, () => 50, () => 5, () => 1, () => 1,
        100, 1,
      );
      expect(omitted).toBe(capWith(1));
    });

    it('never produces a negative budget from a hostile multiplier', () => {
      const cap = capWith(-5);
      if (cap !== null) expect(cap).toBeGreaterThan(0);
    });

    it('stays finite when the defense outpaces the spawns', () => {
      // Ein sehr kurzer Spawn-Abstand gegen eine schnelle Abwehr: der Nenner
      // der geschlossenen Form wird negativ. Das hieß früher "unbegrenzt",
      // und der Deckel gab die Welle ganz frei — gemessen kamen dann 584
      // Gegner, die 8,6 % der HP kosteten, während jede Welle mit bindendem
      // Deckel gar nichts kostete. Eine Welle hat nur begrenzt Zeit, also hat
      // sie auch eine Obergrenze.
      const cap = survivableCount(
        TEMPLATES[0], 1, 5,
        { ground: { unarmored: 5000 }, air: { unarmored: 5000 } },
        { ground: 200, air: 200 },
        () => 'unarmored', () => false, () => 1, () => 5, () => 1, () => 1,
        100, 1,
      );
      expect(cap).not.toBeNull();
      expect(Number.isFinite(cap!)).toBe(true);
    });

    it('lets a wave through in proportion to the target pressure', () => {
      // The second half of the unification: the same number the loop steers on
      // also sets how much leak the cap prices in. A wave that is allowed to
      // cost twice as much HP is allowed to be bigger.
      const cap = (want: number) => survivableCount(
        TEMPLATES[0], 1, 100,
        { ground: { unarmored: 100 }, air: { unarmored: 100 } },
        { ground: 2, air: 2 },
        () => 'unarmored', () => false, () => 50, () => 5, () => 1, () => 1,
        100, 1, 1, want,
      )!;
      expect(cap(0.12)).toBeGreaterThan(cap(0.06));
    });
  });

  describe('survivableCount counts split children', () => {
    const cap = (hp: number, bodies: number, maxLeaks = 1) => survivableCount(
      TEMPLATES[0], 1, 100,
      { ground: { unarmored: 100 }, air: { unarmored: 100 } },
      { ground: 2, air: 2 },
      () => 'unarmored', () => false, () => hp, () => 5, () => bodies, () => maxLeaks,
      100, 1,
    )!;

    it('with the HP of the whole lineage and a kill per body', () => {
      expect(cap(50 + 2 * 15, 1)).toBeLessThan(cap(50, 1)); // more HP to clear
      expect(cap(50, 3)).toBeLessThan(cap(50, 1)); // more kills to land
    });

    it('and a leak per minion that can reach the base', () => {
      // 100 HP left: a 6 HP budget, six leaks at 1 HP. A skeleton killed
      // just before the base sends both minions on, so it buys three.
      expect(cap(50, 3, 1) - cap(50, 3, 2)).toBe(3);
    });
  });
});
