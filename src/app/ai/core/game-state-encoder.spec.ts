import { describe, it, expect } from 'vitest';
import {
  encodeGameState,
  ENCODED_STATE_SIZE,
  NUM_SCALAR_FEATURES,
} from './game-state-encoder';
import { createEmptySnapshot, GameStateSnapshot } from './models/game-state-snapshot';
import { NUM_BINS } from './dps-profile';
import { ARMOR_TYPES, DAMAGE_TYPES } from '../../configs/combat/combat.types';

/**
 * Schema test for the 156-slot Float32 vector emitted by encodeGameState().
 *
 * Why this matters: the ONNX model is trained against a specific feature
 * order. Silent re-ordering or padding here breaks inference at runtime —
 * the model will accept any 156-float input but the predictions will be
 * garbage. These tests pin the schema down to fixed slot indices.
 */
describe('encodeGameState() schema', () => {
  function snapshotFixture(): GameStateSnapshot {
    // Start from the canonical empty snapshot, then seed each scalar with a
    // distinct value so we can identify which slot maps to which input.
    const s = createEmptySnapshot();
    s.player.credits = 1500;
    s.player.lives = 50;
    s.player.maxLives = 100;
    s.player.livesPercent = 0.5;
    s.waveNumber = 10;
    s.gameTimeSeconds = 120;
    s.defense.towerCount = 8;
    s.defense.avgTowerLevel = 3;
    s.defense.capabilities = {
      hasAntiAir: true, hasSplash: true, hasSlow: false, hasDoT: true,
    };
    s.defense.towerDistribution = {
      archer:        { count: 4, avgLevel: 2, totalDamage: 100, totalDPS: 80 },
      cannon:        { count: 1, avgLevel: 3, totalDamage: 50,  totalDPS: 25 },
      magic:         { count: 1, avgLevel: 1, totalDamage: 20,  totalDPS: 10 },
      'dual-gatling':{ count: 0, avgLevel: 0, totalDamage: 0,   totalDPS: 0 },
      rocket:        { count: 1, avgLevel: 4, totalDamage: 200, totalDPS: 90 },
      ice:           { count: 0, avgLevel: 0, totalDamage: 0,   totalDPS: 0 },
      fire:          { count: 1, avgLevel: 5, totalDamage: 120, totalDPS: 60 },
      tentacle:      { count: 0, avgLevel: 0, totalDamage: 0,   totalDPS: 0 },
      poison:        { count: 0, avgLevel: 0, totalDamage: 0,   totalDPS: 0 },
    };
    s.recentHistory.damagePerWave    = [0.1, 0.2, 0.0, 0.3, 0.05];
    s.recentHistory.progressPerWave  = [0.2, 0.3, 0.4, 0.5, 0.6];
    s.recentHistory.nearMissPerWave  = [0.0, 0.1, 0.2, 0.05, 0.0];
    s.recentHistory.enemyTypesUsed   = [
      ['zombie'], ['bat'], ['zombie', 'rat'], ['herbert'], ['ghost'],
    ];
    s.recentHistory.lastWaveThreat   = 5;
    s.recentHistory.avgWaveDuration  = 25;
    s.recentHistory.winStreak        = 2;
    s.research = {
      completedIds: ['a', 'b'],
      completedCount: 2,
      totalCount: 10,
      activeIds: [],
      centerLevel: 2,
      slotsUsed: 1,
      maxSlots: 3,
      airTargetingUnlocked: true,
      maxUpgradeTier: 2,
      towerUnlocked: {
        archer: true, cannon: true, magic: false, 'dual-gatling': false,
        rocket: true, ice: false, fire: false, tentacle: false, poison: false,
        'research-center': true,
      },
    };
    s.defense.effectiveDPSPerArmor = {
      ground: { unarmored: 100, light: 80, heavy: 60, fortified: 40, ethereal: 20 },
      air:    { unarmored: 50,  light: 40, heavy: 30, fortified: 20, ethereal: 10 },
    };
    s.expectedArmorDistribution = {
      unarmored: 0.4, light: 0.2, heavy: 0.2, fortified: 0.1, ethereal: 0.1,
    };
    s.dpsProfile.groundDPS = Array.from({ length: NUM_BINS }, (_, i) => i / NUM_BINS);
    s.dpsProfile.airDPS    = Array.from({ length: NUM_BINS }, (_, i) => (NUM_BINS - i) / NUM_BINS);
    return s;
  }

  it('returns a Float32Array of the documented length', () => {
    const out = encodeGameState(createEmptySnapshot());
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(ENCODED_STATE_SIZE);
    expect(ENCODED_STATE_SIZE).toBe(156);
  });

  it('exposes NUM_SCALAR_FEATURES = 116 (everything before the spatial block)', () => {
    expect(NUM_SCALAR_FEATURES).toBe(116);
  });

  describe('slot layout (sectional)', () => {
    const out = encodeGameState(snapshotFixture());

    it('[0-3] player state — credits, livesPercent, wave, gameTime', () => {
      // credits normalised to a 0-1 range
      expect(out[0]).toBeGreaterThan(0);
      expect(out[0]).toBeLessThanOrEqual(1);
      // livesPercent passed-through
      expect(out[1]).toBeCloseTo(0.5, 5);
      // wave 10 normalised by some MAX_WAVE
      expect(out[2]).toBeGreaterThan(0);
      expect(out[2]).toBeLessThanOrEqual(1);
      // gameTime normalised
      expect(out[3]).toBeGreaterThan(0);
      expect(out[3]).toBeLessThanOrEqual(1);
    });

    it('[4-5] tower stats — towerCount, avgTowerLevel', () => {
      // towerCount 8 normalised by 30 → ~0.267
      expect(out[4]).toBeCloseTo(8 / 30, 5);
      // avgLevel 3 normalised by 5 → 0.6
      expect(out[5]).toBeCloseTo(0.6, 5);
    });

    it('[6-14] tower-type counts in canonical order (9 slots)', () => {
      // Fixture: archer 4, cannon 1, magic 1, dual-gatling 0, rocket 1, ice 0, fire 1, tentacle 0, poison 0
      // Normalisation is /10 inside the encoder.
      expect(out[6]).toBeCloseTo(0.4, 5);   // archer
      expect(out[7]).toBeCloseTo(0.1, 5);   // cannon
      expect(out[8]).toBeCloseTo(0.1, 5);   // magic
      expect(out[9]).toBe(0);               // dual-gatling
      expect(out[10]).toBeCloseTo(0.1, 5);  // rocket
      expect(out[11]).toBe(0);              // ice
      expect(out[12]).toBeCloseTo(0.1, 5);  // fire
      expect(out[13]).toBe(0);              // tentacle
      expect(out[14]).toBe(0);              // poison
    });

    it('[15-19] history damage — last 5 raw values', () => {
      expect(out[15]).toBeCloseTo(0.1, 5);
      expect(out[16]).toBeCloseTo(0.2, 5);
      expect(out[17]).toBe(0);
      expect(out[18]).toBeCloseTo(0.3, 5);
      expect(out[19]).toBeCloseTo(0.05, 5);
    });

    it('[20-24] history progress — last 5 raw values', () => {
      expect(out[20]).toBeCloseTo(0.2, 5);
      expect(out[21]).toBeCloseTo(0.3, 5);
      expect(out[22]).toBeCloseTo(0.4, 5);
      expect(out[23]).toBeCloseTo(0.5, 5);
      expect(out[24]).toBeCloseTo(0.6, 5);
    });

    it('[25-29] wave signals — momentum, avgRecent, duration, episodeProgress, variance', () => {
      // [25] momentum = (0.05 - 0.3) * 10 = -2.5 → clamped to -1
      expect(out[25]).toBeCloseTo(-1, 5);
      // [26] avg of last 5 damages = 0.13
      expect(out[26]).toBeCloseTo(0.13, 5);
      // [27] avgWaveDuration normalised — finite 0-1
      expect(out[27]).toBeGreaterThan(0);
      expect(out[27]).toBeLessThanOrEqual(1);
      // [28] episode progress: wave 10 / 20 = 0.5
      expect(out[28]).toBeCloseTo(0.5, 5);
      // [29] variance is non-negative and capped at 1
      expect(out[29]).toBeGreaterThan(0);
      expect(out[29]).toBeLessThanOrEqual(1);
    });

    it('[30-34] context — wave, trend, skill, lastThreat, winStreak', () => {
      // [30] wave normalised — finite 0-1
      expect(out[30]).toBeGreaterThan(0);
      expect(out[30]).toBeLessThanOrEqual(1);
      // [31] difficulty trend, [32] skill — both finite (allow signed)
      expect(Number.isFinite(out[31])).toBe(true);
      expect(Number.isFinite(out[32])).toBe(true);
      // [33] lastWaveThreat — clamped 0-1
      expect(out[33]).toBeGreaterThanOrEqual(0);
      expect(out[33]).toBeLessThanOrEqual(1);
      // [34] winStreak — clamped 0-1
      expect(out[34]).toBeGreaterThan(0);
      expect(out[34]).toBeLessThanOrEqual(1);
    });

    it('[35-41] DPS-by-damage-type — 7 slots, one per DamageType', () => {
      // Whatever the encoder computes, all 7 should be valid finite numbers.
      expect(DAMAGE_TYPES.length).toBe(7);
      for (let i = 0; i < 7; i++) {
        expect(Number.isFinite(out[35 + i])).toBe(true);
      }
    });

    it('[42-46] expected armor distribution — 5 slots', () => {
      expect(ARMOR_TYPES.length).toBe(5);
      expect(out[42]).toBeCloseTo(0.4, 5);   // unarmored
      expect(out[43]).toBeCloseTo(0.2, 5);   // light
      expect(out[44]).toBeCloseTo(0.2, 5);   // heavy
      expect(out[45]).toBeCloseTo(0.1, 5);   // fortified
      expect(out[46]).toBeCloseTo(0.1, 5);   // ethereal
    });

    it('[47-51] research state — 5 slots', () => {
      // completedRatio 2/10
      expect(out[47]).toBeCloseTo(0.2, 5);
      // centerLevel/3
      expect(out[48]).toBeCloseTo(2 / 3, 5);
      // slotsUsed/maxSlots
      expect(out[49]).toBeCloseTo(1 / 3, 5);
      // airTargetingUnlocked flag
      expect(out[50]).toBe(1);
      // maxUpgradeTier/3
      expect(out[51]).toBeCloseTo(2 / 3, 5);
    });

    it('[52] reserved/padding is zero', () => {
      expect(out[52]).toBe(0);
    });

    it('[53-68] types-history — 16 slots (one per enemy type)', () => {
      // 16 entries; each is fraction of last 5 waves containing that type
      for (let i = 0; i < 16; i++) {
        const v = out[53 + i];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('[69-73] armor-history — 5 slots', () => {
      for (let i = 0; i < 5; i++) {
        const v = out[69 + i];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('[74-78] damage-pct-history (parallel to [15-19])', () => {
      expect(out[74]).toBeCloseTo(0.1, 5);
      expect(out[75]).toBeCloseTo(0.2, 5);
      expect(out[76]).toBe(0);
      expect(out[77]).toBeCloseTo(0.3, 5);
      expect(out[78]).toBeCloseTo(0.05, 5);
    });

    it('[79-87] tower-type avg-levels — 9 slots', () => {
      // archer avg 2 / 5 = 0.4
      expect(out[79]).toBeCloseTo(0.4, 5);
      // cannon 3 / 5 = 0.6
      expect(out[80]).toBeCloseTo(0.6, 5);
      // magic 1 / 5 = 0.2
      expect(out[81]).toBeCloseTo(0.2, 5);
      // dual-gatling 0
      expect(out[82]).toBe(0);
      // rocket 4 / 5
      expect(out[83]).toBeCloseTo(0.8, 5);
      // fire 5 / 5
      expect(out[85]).toBeCloseTo(1.0, 5);
    });

    it('[88-91] defense capabilities — 4 flag slots', () => {
      expect(out[88]).toBe(1);  // hasAntiAir
      expect(out[89]).toBe(1);  // hasSplash
      expect(out[90]).toBe(0);  // hasSlow
      expect(out[91]).toBe(1);  // hasDoT
    });

    it('[92-100] tower-unlock status — 9 flag slots in TOWER_TYPE order', () => {
      // archer/cannon/rocket unlocked; magic/ice/fire/tentacle/poison/dual-gatling locked.
      expect(out[92]).toBe(1);  // archer
      expect(out[93]).toBe(1);  // cannon
      expect(out[94]).toBe(0);  // magic
      expect(out[95]).toBe(0);  // dual-gatling
      expect(out[96]).toBe(1);  // rocket
      expect(out[97]).toBe(0);  // ice
      expect(out[98]).toBe(0);  // fire
      expect(out[99]).toBe(0);  // tentacle
      expect(out[100]).toBe(0); // poison
    });

    it('[101-105] near-miss history (5 slots)', () => {
      expect(out[101]).toBeCloseTo(0, 5);
      expect(out[102]).toBeCloseTo(0.1, 5);
      expect(out[103]).toBeCloseTo(0.2, 5);
      expect(out[104]).toBeCloseTo(0.05, 5);
      expect(out[105]).toBeCloseTo(0, 5);
    });

    it('[106-110] effective DPS vs armor (ground) — 5 slots', () => {
      // Normalisation: divide by 500 (MAX_EFFECTIVE_DPS_PER_ARMOR), clamp 0-1.
      expect(out[106]).toBeCloseTo(100 / 500, 5); // unarmored
      expect(out[107]).toBeCloseTo(80 / 500, 5);  // light
      expect(out[108]).toBeCloseTo(60 / 500, 5);  // heavy
      expect(out[109]).toBeCloseTo(40 / 500, 5);  // fortified
      expect(out[110]).toBeCloseTo(20 / 500, 5);  // ethereal
    });

    it('[111-115] effective DPS vs armor (air) — 5 slots', () => {
      expect(out[111]).toBeCloseTo(50 / 500, 5);
      expect(out[112]).toBeCloseTo(40 / 500, 5);
      expect(out[113]).toBeCloseTo(30 / 500, 5);
      expect(out[114]).toBeCloseTo(20 / 500, 5);
      expect(out[115]).toBeCloseTo(10 / 500, 5);
    });

    it('[116-135] ground DPS profile — 20 bins', () => {
      for (let i = 0; i < NUM_BINS; i++) {
        expect(out[116 + i]).toBeCloseTo(i / NUM_BINS, 5);
      }
    });

    it('[136-155] air DPS profile — 20 bins', () => {
      for (let i = 0; i < NUM_BINS; i++) {
        expect(out[136 + i]).toBeCloseTo((NUM_BINS - i) / NUM_BINS, 5);
      }
    });
  });

  describe('all outputs are finite and bounded', () => {
    it('every slot of an empty snapshot is a finite number in [0,1]', () => {
      const out = encodeGameState(createEmptySnapshot());
      for (let i = 0; i < ENCODED_STATE_SIZE; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        // signed momentum slot can be -1 — handle that exception
        const lowerBound = i === 25 ? -1 : 0;
        expect(out[i]).toBeGreaterThanOrEqual(lowerBound);
        expect(out[i]).toBeLessThanOrEqual(1);
      }
    });

    it('encoding is deterministic for the same input snapshot', () => {
      const fixture = snapshotFixture();
      const a = encodeGameState(fixture);
      const b = encodeGameState(fixture);
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBe(b[i]);
      }
    });
  });
});
