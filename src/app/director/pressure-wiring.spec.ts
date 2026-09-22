import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injector, runInInjectionContext } from '@angular/core';

import { WaveDirector } from './wave-director';
import { StateSnapshotService } from './state-snapshot.service';
import { PRESSURE_MIN_SAMPLES, PRESSURE_WARMUP_WAVES, targetPressure } from './pressure-controller';
import { survivableCount, TEMPLATES } from './templates';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveResult } from './models/wave-result';

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

  const feed = (result: WaveResult, times = PRESSURE_MIN_SAMPLES * 8) => {
    for (let i = 0; i < times; i++) collector.emitWaveResult(result);
  };

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({
      providers: [{ provide: StateSnapshotService, useValue: collector }],
    });
    director = runInInjectionContext(injector, () => new WaveDirector());
  });

  describe('completed waves reach the gate', () => {
    it('subscribes to the collector on construction', () => {
      // Deleting the subscription in the constructor must fail this.
      expect(director.pressure.pressureMultiplier).toBe(1);
      feed(waveResult(0));                                   // cost nothing
      expect(director.pressure.pressureMultiplier).toBeGreaterThan(1);
    });

    it('closes the budget when the waves cost too much', () => {
      feed(waveResult(0));
      const opened = director.pressure.pressureMultiplier;
      expect(opened).toBeGreaterThan(1);

      feed(waveResult(40));                                  // 40% of HP a wave
      expect(director.pressure.pressureMultiplier).toBeLessThan(opened);
    });

    it('holds inside the band', () => {
      // A wave that costs exactly the target must not move the loop at all.
      const target = targetPressure(PRESSURE_WARMUP_WAVES + 1);
      feed(waveResult(target * 100));
      expect(director.pressure.pressureMultiplier).toBe(1);
      expect(director.pressure.status.lastStep).toBe('held');
    });

    it('ignores the warmup waves', () => {
      // They measure a player without towers, not a defense. Letting them in
      // is what drove the old loop onto its lower stop within two waves.
      for (let w = 1; w <= PRESSURE_WARMUP_WAVES; w++) {
        collector.emitWaveResult(waveResult(70, 100, w));
      }
      expect(director.pressure.pressureMultiplier).toBe(1);
      expect(director.pressure.status.samples).toBe(0);
    });

    it('takes a single brutal wave seriously but not as the whole picture', () => {
      // A campaign-pinned air wave against a ground-only defense leaks hard.
      // The old mean over four waves let it drive the loop onto its stop in
      // two steps. Over eight it moves the loop by a step, no more: the wave
      // really did cost that HP, so ignoring it would be wrong too.
      feed(waveResult(0));
      const opened = director.pressure.pressureMultiplier;
      collector.emitWaveResult(waveResult(60));
      const after = director.pressure.pressureMultiplier;
      expect(after).toBeLessThan(opened);
      expect(after).toBeGreaterThan(opened / 1.5);
    });

    it('ignores waves that carry no HP reading', () => {
      // No HP at wave start is "no sample", not "nothing was lost". Counting
      // it as zero opens the budget on evidence that does not exist.
      feed(waveResult(0, 0));
      expect(director.pressure.pressureMultiplier).toBe(1);
    });

    it('reads a healed player as headroom, not as a weaker defense', () => {
      // The condition for pickups and bought healing: 10 HP lost out of 100
      // and out of 200 are different pressures, and the second must not read
      // as "the wave got cheaper" just because the player has more HP. It
      // reads as exactly that, which is the point — the wave is allowed to
      // cost more in absolute HP once there is more to spend.
      feed(waveResult(4, 100));
      const atFull = director.pressure.pressureMultiplier;

      director.resetForNewGame();
      feed(waveResult(8, 200));
      expect(director.pressure.pressureMultiplier).toBe(atFull);
    });

    it('ignores a cheap wave the cap did not size, and never opens on one', () => {
      // Anti-Windup, beide Hälften. Bindet der Deckel nicht, kam die Welle
      // aus der Template-Spanne: Der Multiplikator hat sie nicht freigegeben,
      // also sagt ihr niedriger Preis nichts darüber, ob er zu niedrig steht.
      // Sie zu zählen war gemessen der Grund, warum der Regler die toten
      // Wellen nicht auffüllte; auf sie zu öffnen hieße, gegen eine Sättigung
      // zu integrieren.
      const loop = director.pressure;
      for (let i = 0; i < PRESSURE_MIN_SAMPLES * 6; i++) {
        loop.recordWave(0, PRESSURE_WARMUP_WAVES + 1 + i, false);
      }
      expect(loop.pressureMultiplier).toBe(1);
      expect(loop.status.samples).toBe(0);

      // Eine teure zählt dagegen auch ohne bindenden Deckel: Sonst stürbe der
      // Lauf an Wellen, die der Regler nie zu sehen bekommt, und Schließen
      // wirkt auch hier, weil es den Deckel senkt, bis er wieder bindet.
      for (let i = 0; i < PRESSURE_MIN_SAMPLES * 6; i++) {
        loop.recordWave(0.4, PRESSURE_WARMUP_WAVES + 1 + i, false);
      }
      expect(loop.pressureMultiplier).toBeLessThan(1);
    });

    it('clears the gate for a new run', () => {
      feed(waveResult(0));
      expect(director.pressure.pressureMultiplier).toBeGreaterThan(1);
      director.resetForNewGame();
      expect(director.pressure.pressureMultiplier).toBe(1);
      expect(director.pressure.status.samples).toBe(0);
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
        for (let i = 0; i < waves; i++) total += (await director.getNextWave()).totalCount;
        return total / waves;
      };

      const tight = await meanCount(20);

      director.resetForNewGame();
      feed(waveResult(0), 40);                               // starve the gate
      expect(director.pressure.pressureMultiplier).toBeGreaterThan(2);

      const wide = await meanCount(20);
      expect(wide).toBeGreaterThan(tight);
    });

    it('leaves the enemy toughness alone, even when the count is maxed out', () => {
      // Gemessen über drei Runden und 480 Läufe: Den HP-Multiplikator an den
      // Regler zu hängen, kostete elf Wellen Runlänge und brachte eine Welle
      // weniger Durststrecke. Zähigkeit und Anzahl multiplizieren sich, und
      // ein Regler mit einem einzigen Skalar trifft beides nicht
      // (docs/DRAMA_CONTROLLER_PLAN.md, Runden 15 bis 17).
      //
      // Der Test steht hier, damit der naheliegende Griff nicht ein zweites
      // Mal eingebaut wird, ohne die Messung zu kennen.
      const src = readFileSync(resolve(__dirname, 'wave-config-builder.ts'), 'utf8');
      expect(src).not.toMatch(/hpMult\s*=\s*hpMultFor/);
    });

    it('produces a shippable wave with no history at all', async () => {
      const config = await director.getNextWave();
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
