import { describe, it, expect } from 'vitest';
import {
  encodeGameState,
  ENCODED_STATE_SIZE,
  NUM_SCALAR_FEATURES,
} from './game-state-encoder';
import { createEmptySnapshot, GameStateSnapshot } from './models/game-state-snapshot';
import {
  AI_ENEMY_ORDER,
  AI_TOWER_ORDER,
  AI_DAMAGE_TYPE_ORDER,
  AI_ARMOR_ORDER,
  AI_MAX_VALUES,
  AI_EPISODE_LENGTH,
  NUM_DPS_BINS,
} from './ai-schema';

/**
 * Schema test for the Float32 vector emitted by encodeGameState().
 *
 * Why this matters: the ONNX model is trained against one specific feature
 * order. A silent re-order or an off-by-one shifts every downstream feature —
 * the model happily accepts any correctly-sized input and returns garbage.
 *
 * Offsets are DERIVED from `ai-schema.ts` rather than written as literals. The
 * previous version of this file pinned absolute indices, which meant a schema
 * bump broke 17 tests that were all describing the same single change. Deriving
 * them keeps the test meaningful (it still pins order and normalisation) while
 * letting the vocabulary grow.
 */
describe('encodeGameState() schema', () => {
  const T = AI_TOWER_ORDER.length;
  const D = AI_DAMAGE_TYPE_ORDER.length;
  const A = AI_ARMOR_ORDER.length;
  const E = AI_ENEMY_ORDER.length;

  /** Section offsets, in the exact order encodeGameState() writes them. */
  const OFF = (() => {
    let at = 0;
    const take = (n: number) => {
      const start = at;
      at += n;
      return start;
    };
    return {
      player: take(4),
      towerStats: take(2),
      towerCounts: take(T),
      damageHistory: take(5),
      progressHistory: take(5),
      waveSignals: take(5),
      context: take(5),
      dpsByDamageType: take(D),
      armorDistribution: take(A),
      research: take(5),
      reserved: take(1),
      typesHistory: take(E),
      armorHistory: take(A),
      damageHistoryRepeat: take(5),
      towerAvgLevels: take(T),
      capabilities: take(4),
      towerUnlocked: take(T),
      nearMissHistory: take(5),
      effectiveDpsGround: take(A),
      effectiveDpsAir: take(A),
      groundProfile: take(NUM_DPS_BINS),
      airProfile: take(NUM_DPS_BINS),
      end: at,
    };
  })();

  /** Index of a tower/enemy/armor within its canonical order. */
  const tower = (id: string) => AI_TOWER_ORDER.indexOf(id as never);
  const armor = (id: string) => AI_ARMOR_ORDER.indexOf(id as never);

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
      lightning:     { count: 2, avgLevel: 1, totalDamage: 70,  totalDPS: 35 },
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
        lightning: false, 'research-center': true,
      },
    };
    s.defense.effectiveDPSPerArmor = {
      ground: { unarmored: 100, light: 80, heavy: 60, fortified: 40, ethereal: 20 },
      air:    { unarmored: 50,  light: 40, heavy: 30, fortified: 20, ethereal: 10 },
    };
    s.expectedArmorDistribution = {
      unarmored: 0.4, light: 0.2, heavy: 0.2, fortified: 0.1, ethereal: 0.1,
    };
    s.dpsProfile.groundDPS = Array.from({ length: NUM_DPS_BINS }, (_, i) => i / NUM_DPS_BINS);
    s.dpsProfile.airDPS =
      Array.from({ length: NUM_DPS_BINS }, (_, i) => (NUM_DPS_BINS - i) / NUM_DPS_BINS);
    return s;
  }

  it('returns a Float32Array of the schema-declared length', () => {
    const out = encodeGameState(createEmptySnapshot());
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(ENCODED_STATE_SIZE);
  });

  it('the section offsets account for every slot with none left over', () => {
    // If this fails, the encoder writes a section this spec does not know
    // about — every assertion below would be checking the wrong slot.
    expect(OFF.end).toBe(ENCODED_STATE_SIZE);
    expect(OFF.groundProfile).toBe(NUM_SCALAR_FEATURES);
  });

  describe('slot layout (sectional)', () => {
    const out = encodeGameState(snapshotFixture());

    it('player state — credits, livesPercent, wave, gameTime', () => {
      expect(out[OFF.player + 0]).toBeCloseTo(1500 / AI_MAX_VALUES.credits, 5);
      expect(out[OFF.player + 1]).toBeCloseTo(0.5, 5);
      expect(out[OFF.player + 2]).toBeCloseTo(10 / AI_MAX_VALUES.wave, 5);
      expect(out[OFF.player + 3]).toBeCloseTo(120 / AI_MAX_VALUES.gameTime, 5);
    });

    it('tower stats — towerCount, avgTowerLevel', () => {
      expect(out[OFF.towerStats + 0]).toBeCloseTo(8 / AI_MAX_VALUES.towerCount, 5);
      expect(out[OFF.towerStats + 1]).toBeCloseTo(3 / AI_MAX_VALUES.towerLevel, 5);
    });

    it('tower-type counts follow AI_TOWER_ORDER', () => {
      const at = (id: string) => out[OFF.towerCounts + tower(id)];
      expect(at('archer')).toBeCloseTo(0.4, 5);
      expect(at('cannon')).toBeCloseTo(0.1, 5);
      expect(at('magic')).toBeCloseTo(0.1, 5);
      expect(at('dual-gatling')).toBe(0);
      expect(at('rocket')).toBeCloseTo(0.1, 5);
      expect(at('ice')).toBe(0);
      expect(at('fire')).toBeCloseTo(0.1, 5);
      expect(at('tentacle')).toBe(0);
      expect(at('poison')).toBe(0);
      // Lightning became visible to the AI in schema v2.
      expect(at('lightning')).toBeCloseTo(0.2, 5);
    });

    it('history damage — last 5 raw values, oldest first', () => {
      expect(Array.from(out.slice(OFF.damageHistory, OFF.damageHistory + 5)))
        .toEqual([0.1, 0.2, 0, 0.3, 0.05].map((v) => Math.fround(v)));
    });

    it('history progress — last 5 raw values, oldest first', () => {
      const got = Array.from(out.slice(OFF.progressHistory, OFF.progressHistory + 5));
      [0.2, 0.3, 0.4, 0.5, 0.6].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5));
    });

    it('short histories are left-padded so index 0 stays the oldest entry', () => {
      const s = snapshotFixture();
      s.recentHistory.damagePerWave = [0.42];
      const short = encodeGameState(s);
      expect(Array.from(short.slice(OFF.damageHistory, OFF.damageHistory + 5)))
        .toEqual([0, 0, 0, 0, Math.fround(0.42)]);
    });

    it('wave signals — momentum, avgRecent, duration, episodeProgress, variance', () => {
      // momentum = (0.05 - 0.3) * 10 = -2.5, clamped to -1
      expect(out[OFF.waveSignals + 0]).toBeCloseTo(-1, 5);
      expect(out[OFF.waveSignals + 1]).toBeCloseTo(0.13, 5);
      expect(out[OFF.waveSignals + 2]).toBeCloseTo(25 / AI_MAX_VALUES.waveDuration, 5);
      // Episode progress is measured against the training episode length, not
      // the hardcoded 20 waves it used to divide by.
      expect(out[OFF.waveSignals + 3]).toBeCloseTo(10 / AI_EPISODE_LENGTH, 5);
      expect(out[OFF.waveSignals + 4]).toBeGreaterThan(0);
      expect(out[OFF.waveSignals + 4]).toBeLessThanOrEqual(1);
    });

    it('context — wave, trend, skill, lastThreat, winStreak', () => {
      expect(out[OFF.context + 0]).toBeCloseTo(10 / AI_MAX_VALUES.wave, 5);
      expect(Number.isFinite(out[OFF.context + 1])).toBe(true);
      expect(Number.isFinite(out[OFF.context + 2])).toBe(true);
      expect(out[OFF.context + 3]).toBeCloseTo(5 / AI_MAX_VALUES.waveThreat, 5);
      expect(out[OFF.context + 4]).toBeCloseTo(2 / AI_MAX_VALUES.winStreak, 5);
    });

    it('DPS-by-damage-type has one slot per AI_DAMAGE_TYPE_ORDER entry', () => {
      for (let i = 0; i < D; i++) {
        const v = out[OFF.dpsByDamageType + i];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('expected armor distribution follows AI_ARMOR_ORDER', () => {
      const at = (id: string) => out[OFF.armorDistribution + armor(id)];
      expect(at('unarmored')).toBeCloseTo(0.4, 5);
      expect(at('light')).toBeCloseTo(0.2, 5);
      expect(at('heavy')).toBeCloseTo(0.2, 5);
      expect(at('fortified')).toBeCloseTo(0.1, 5);
      expect(at('ethereal')).toBeCloseTo(0.1, 5);
    });

    it('research state — ratio, centerLevel, slot use, airTargeting, maxTier', () => {
      expect(out[OFF.research + 0]).toBeCloseTo(0.2, 5);
      expect(out[OFF.research + 1]).toBeCloseTo(2 / 3, 5);
      expect(out[OFF.research + 2]).toBeCloseTo(1 / 3, 5);
      expect(out[OFF.research + 3]).toBe(1);
      // Tier is normalised against the highest tier the research tree unlocks
      // (5). Dividing by 3 used to push this feature past 1.0 at tier 4.
      expect(out[OFF.research + 4]).toBeCloseTo(2 / AI_MAX_VALUES.upgradeTier, 5);
    });

    it('maxUpgradeTier 5 encodes as exactly 1.0, never above', () => {
      const s = snapshotFixture();
      s.research.maxUpgradeTier = 5;
      const maxed = encodeGameState(s);
      expect(maxed[OFF.research + 4]).toBeCloseTo(1, 5);
    });

    it('reserved slot is zero', () => {
      expect(out[OFF.reserved]).toBe(0);
    });

    it('types-history has one slot per AI_ENEMY_ORDER entry', () => {
      expect(E).toBe(AI_ENEMY_ORDER.length);
      for (let i = 0; i < E; i++) {
        const v = out[OFF.typesHistory + i];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      // 'zombie' appeared in 2 of the last 5 waves in the fixture.
      expect(out[OFF.typesHistory + AI_ENEMY_ORDER.indexOf('zombie')]).toBeCloseTo(2 / 5, 5);
      // The two enemies added in schema v2 are present and simply unused here.
      expect(out[OFF.typesHistory + AI_ENEMY_ORDER.indexOf('stone-golem')]).toBe(0);
      expect(out[OFF.typesHistory + AI_ENEMY_ORDER.indexOf('zombie-v2')]).toBe(0);
    });

    it('armor-history has one slot per armor class', () => {
      for (let i = 0; i < A; i++) {
        const v = out[OFF.armorHistory + i];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('damage-pct history repeats the earlier damage block verbatim', () => {
      for (let i = 0; i < 5; i++) {
        expect(out[OFF.damageHistoryRepeat + i]).toBe(out[OFF.damageHistory + i]);
      }
    });

    it('tower-type avg-levels follow AI_TOWER_ORDER', () => {
      const at = (id: string) => out[OFF.towerAvgLevels + tower(id)];
      expect(at('archer')).toBeCloseTo(2 / 5, 5);
      expect(at('cannon')).toBeCloseTo(3 / 5, 5);
      expect(at('magic')).toBeCloseTo(1 / 5, 5);
      expect(at('dual-gatling')).toBe(0);
      expect(at('rocket')).toBeCloseTo(4 / 5, 5);
      expect(at('fire')).toBeCloseTo(1, 5);
      expect(at('lightning')).toBeCloseTo(1 / 5, 5);
    });

    it('defense capabilities — antiAir, splash, slow, dot', () => {
      expect(out[OFF.capabilities + 0]).toBe(1);
      expect(out[OFF.capabilities + 1]).toBe(1);
      expect(out[OFF.capabilities + 2]).toBe(0);
      expect(out[OFF.capabilities + 3]).toBe(1);
    });

    it('tower-unlock status follows AI_TOWER_ORDER', () => {
      const at = (id: string) => out[OFF.towerUnlocked + tower(id)];
      expect(at('archer')).toBe(1);
      expect(at('cannon')).toBe(1);
      expect(at('rocket')).toBe(1);
      expect(at('magic')).toBe(0);
      expect(at('dual-gatling')).toBe(0);
      expect(at('ice')).toBe(0);
      expect(at('fire')).toBe(0);
      expect(at('tentacle')).toBe(0);
      expect(at('poison')).toBe(0);
      expect(at('lightning')).toBe(0);
    });

    it('near-miss history — last 5 values, oldest first', () => {
      const got = Array.from(out.slice(OFF.nearMissHistory, OFF.nearMissHistory + 5));
      [0, 0.1, 0.2, 0.05, 0].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5));
    });

    it('effective DPS vs armor (ground) normalises by the schema ceiling', () => {
      const max = AI_MAX_VALUES.effectiveDpsPerArmor;
      const at = (id: string) => out[OFF.effectiveDpsGround + armor(id)];
      expect(at('unarmored')).toBeCloseTo(100 / max, 5);
      expect(at('light')).toBeCloseTo(80 / max, 5);
      expect(at('heavy')).toBeCloseTo(60 / max, 5);
      expect(at('fortified')).toBeCloseTo(40 / max, 5);
      expect(at('ethereal')).toBeCloseTo(20 / max, 5);
    });

    it('effective DPS vs armor (air) normalises by the schema ceiling', () => {
      const max = AI_MAX_VALUES.effectiveDpsPerArmor;
      const at = (id: string) => out[OFF.effectiveDpsAir + armor(id)];
      expect(at('unarmored')).toBeCloseTo(50 / max, 5);
      expect(at('light')).toBeCloseTo(40 / max, 5);
      expect(at('heavy')).toBeCloseTo(30 / max, 5);
      expect(at('fortified')).toBeCloseTo(20 / max, 5);
      expect(at('ethereal')).toBeCloseTo(10 / max, 5);
    });

    it('ground DPS profile fills NUM_DPS_BINS slots', () => {
      for (let i = 0; i < NUM_DPS_BINS; i++) {
        expect(out[OFF.groundProfile + i]).toBeCloseTo(i / NUM_DPS_BINS, 5);
      }
    });

    it('air DPS profile fills NUM_DPS_BINS slots', () => {
      for (let i = 0; i < NUM_DPS_BINS; i++) {
        expect(out[OFF.airProfile + i]).toBeCloseTo((NUM_DPS_BINS - i) / NUM_DPS_BINS, 5);
      }
    });
  });

  describe('all outputs are finite and bounded', () => {
    it('every slot of an empty snapshot is finite and in range', () => {
      const out = encodeGameState(createEmptySnapshot());
      for (let i = 0; i < ENCODED_STATE_SIZE; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        // The damage-momentum slot is the one deliberately signed feature.
        const lowerBound = i === OFF.waveSignals ? -1 : 0;
        expect(out[i]).toBeGreaterThanOrEqual(lowerBound);
        expect(out[i]).toBeLessThanOrEqual(1);
      }
    });

    it('a fully-populated snapshot also stays in range', () => {
      const out = encodeGameState(snapshotFixture());
      for (let i = 0; i < ENCODED_STATE_SIZE; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        const lowerBound = i === OFF.waveSignals ? -1 : 0;
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
