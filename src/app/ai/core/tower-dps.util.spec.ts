import { describe, it, expect, vi } from 'vitest';

// Mock Three.js (same as tower.entity.spec.ts)
vi.mock('three', () => ({
  Vector3: class {
    x = 0; y = 0; z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
  },
  InstancedMesh: class {},
}));

import { computeTowerDPS, armorMultipliersFor } from './tower-dps.util';
import { Tower } from '../../entities/tower.entity';
import { ARMOR_TYPES, DAMAGE_TYPES } from '../../configs/combat/combat.types';
import { DAMAGE_MATRIX } from '../../configs/combat/damage-matrix.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';

const POS = { lat: 10, lon: 20, height: 0 };

// Helper to get a specific projectile's splash multiplier
function splashMult(splashRadius: number): number {
  // SPLASH_NORM = 10, cap = 2.0
  return Math.min(2.0, 1 + splashRadius / 10);
}

describe('computeTowerDPS()', () => {
  // ===================================================================
  // Passive tower → 0
  // ===================================================================
  it('returns 0 for a passive tower (research-center)', () => {
    const tower = new Tower(POS, 'research-center');
    expect(computeTowerDPS(tower)).toBe(0);
  });

  // ===================================================================
  // Projectile towers: damage × fireRate
  // ===================================================================
  it('archer: damage(25) × fireRate(1) = 25, no splash (arrow has no splashRadius)', () => {
    const tower = new Tower(POS, 'archer');
    // arrow has no splashRadius → no splash multiplier
    expect(computeTowerDPS(tower)).toBeCloseTo(25 * 1, 5);
  });

  it('dual-gatling: damage(10) × fireRate(5) = 50, no splash (bullet has no splashRadius)', () => {
    const tower = new Tower(POS, 'dual-gatling');
    expect(computeTowerDPS(tower)).toBeCloseTo(10 * 5, 5);
  });

  it('magic: damage(40) × fireRate(1.5) = 60, no splash (fireball no splashRadius)', () => {
    const tower = new Tower(POS, 'magic');
    // fireball has no splashRadius
    expect(computeTowerDPS(tower)).toBeCloseTo(40 * 1.5, 5);
  });

  it('cannon: damage(55) × fireRate(0.5) × splashMult(cannonball=10m)', () => {
    const tower = new Tower(POS, 'cannon');
    const baseDps = 55 * 0.5; // 27.5
    const splash = PROJECTILE_TYPES['cannonball'].splashRadius!; // 10
    const mult = splashMult(splash); // 1 + 10/10 = 2.0 (capped)
    expect(computeTowerDPS(tower)).toBeCloseTo(baseDps * mult, 5);
  });

  it('ice: damage(5) × fireRate(0.33) × splashMult(ice-shard=8m)', () => {
    const tower = new Tower(POS, 'ice');
    const baseDps = 5 * 0.33;
    const splash = PROJECTILE_TYPES['ice-shard'].splashRadius!; // 8
    const mult = splashMult(splash); // 1 + 8/10 = 1.8
    expect(computeTowerDPS(tower)).toBeCloseTo(baseDps * mult, 4);
  });

  it('rocket: damage(40) × fireRate(0.5) × splashMult(rocket)', () => {
    const tower = new Tower(POS, 'rocket');
    const rocketSplash = PROJECTILE_TYPES['rocket'].splashRadius ?? 0;
    const baseDps = 40 * 0.5; // 20
    const expected = rocketSplash > 0 ? baseDps * splashMult(rocketSplash) : baseDps;
    expect(computeTowerDPS(tower)).toBeCloseTo(expected, 4);
  });

  // ===================================================================
  // Beam tower: damagePerSecond (+ beamWidth splash)
  // ===================================================================
  it('fire (beam): base = damagePerSecond(35) × splashMult(beamWidth=5)', () => {
    const tower = new Tower(POS, 'fire');
    const dps = 35;
    const beamWidth = 5; // from config
    const mult = splashMult(beamWidth); // 1 + 5/10 = 1.5
    expect(computeTowerDPS(tower)).toBeCloseTo(dps * mult, 5);
  });

  it('fire (beam): applying beam-width upgrade scales DPS', () => {
    const tower = new Tower(POS, 'fire');
    const baseDps = computeTowerDPS(tower);
    tower.applyUpgrade('beam-width');
    const upgradedDps = computeTowerDPS(tower);
    // Upgrade multiplies beamWidth → larger splash mult → higher DPS
    expect(upgradedDps).toBeGreaterThan(baseDps);
  });

  it('fire (beam): applying damage upgrade scales DPS', () => {
    const tower = new Tower(POS, 'fire');
    const baseDps = computeTowerDPS(tower);
    tower.applyUpgrade('damage');
    const upgradedDps = computeTowerDPS(tower);
    expect(upgradedDps).toBeGreaterThan(baseDps);
  });

  // ===================================================================
  // Chain tower: geometric series
  // ===================================================================
  it('lightning (chain, maxJumps=2, falloff=0.7): chainMult = 1 + 0.7 + 0.49 = 2.19', () => {
    const tower = new Tower(POS, 'lightning');
    // attackType: chain, damage: 35, fireRate: 0.8, maxJumps: 2, chainFalloff: 0.7
    // chainMult = 1 + 0.7 + 0.7^2 = 2.19
    // lightning projectile: fireball (no splashRadius)
    const chainMult = 1 + 0.7 + 0.7 * 0.7;
    const expected = 35 * 0.8 * chainMult;
    expect(computeTowerDPS(tower)).toBeCloseTo(expected, 4);
  });

  // ===================================================================
  // Poison tower: projectile + DoT addend
  // ===================================================================
  it('poison: base(5 × 1.0) + dotDPS(8) × splashMult(poison-glob)', () => {
    const tower = new Tower(POS, 'poison');
    const projectileSplash = PROJECTILE_TYPES['poison-glob'].splashRadius ?? 0;
    let base = 5 * 1.0; // damage × fireRate
    // chain check: poison is not chain, so no chain mult
    base += GAME_BALANCE.effects.poison.dotDamagePerSecond; // +8
    const mult = projectileSplash > 0 ? splashMult(projectileSplash) : 1;
    expect(computeTowerDPS(tower)).toBeCloseTo(base * mult, 5);
  });

  // ===================================================================
  // Melee tower: damage × fireRate (no projectile splash for melee)
  // ===================================================================
  it('tentacle (melee): damage(30) × fireRate(1.5), arrow has no splash → 45', () => {
    const tower = new Tower(POS, 'tentacle');
    // attackType: melee (not beam, not chain, not passive)
    // falls into the else branch: combat.damage × combat.fireRate
    // projectileType: arrow → no splashRadius
    expect(computeTowerDPS(tower)).toBeCloseTo(30 * 1.5, 5);
  });

  // ===================================================================
  // DPS is always non-negative
  // ===================================================================
  it('all tower types produce non-negative DPS', () => {
    const ids = ['archer', 'cannon', 'magic', 'dual-gatling', 'rocket', 'ice', 'fire', 'tentacle', 'poison', 'lightning', 'research-center'] as const;
    for (const id of ids) {
      const tower = new Tower(POS, id);
      expect(computeTowerDPS(tower)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('armorMultipliersFor()', () => {
  it('returns an object covering all ArmorType keys', () => {
    const result = armorMultipliersFor('physical');
    for (const armor of ARMOR_TYPES) {
      expect(result).toHaveProperty(armor);
    }
  });

  it('returns values matching the DAMAGE_MATRIX for physical damage', () => {
    const result = armorMultipliersFor('physical');
    for (const armor of ARMOR_TYPES) {
      expect(result[armor]).toBe(DAMAGE_MATRIX.physical[armor]);
    }
  });

  it('returns values matching the DAMAGE_MATRIX for all damage types', () => {
    for (const dmgType of DAMAGE_TYPES) {
      const result = armorMultipliersFor(dmgType);
      for (const armor of ARMOR_TYPES) {
        expect(result[armor]).toBe(DAMAGE_MATRIX[dmgType][armor]);
      }
    }
  });

  it('fire vs ethereal = 0.15 (very low — fire nearly useless vs ethereal)', () => {
    const result = armorMultipliersFor('fire');
    expect(result['ethereal']).toBeCloseTo(0.15, 5);
  });

  it('magic vs ethereal = 1.75 (devastating effectiveness)', () => {
    const result = armorMultipliersFor('magic');
    expect(result['ethereal']).toBeCloseTo(1.75, 5);
  });

  it('siege vs fortified = 1.25 (strong vs fortified)', () => {
    const result = armorMultipliersFor('siege');
    expect(result['fortified']).toBeCloseTo(1.25, 5);
  });

  it('physical vs heavy = 0.7 (reduced vs heavy)', () => {
    const result = armorMultipliersFor('physical');
    expect(result['heavy']).toBeCloseTo(0.7, 5);
  });

  it('all multiplier values are positive numbers', () => {
    for (const dmgType of DAMAGE_TYPES) {
      const result = armorMultipliersFor(dmgType);
      for (const armor of ARMOR_TYPES) {
        expect(result[armor]).toBeGreaterThan(0);
      }
    }
  });
});
