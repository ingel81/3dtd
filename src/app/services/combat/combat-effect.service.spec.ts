import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Angular DI: inject() liefert pro Service-Name einen Stub aus mockInjections.
const mockInjections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => mockInjections[token?.name ?? ''] ?? {},
  };
});

import { CombatEffectService } from './combat-effect.service';
import { PROJECTILE_TYPES, ProjectileTypeId } from '../../configs/projectile-types.config';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/**
 * Coverage: Splash trifft nur Ziele, die der Quell-Tower anvisieren darf.
 */
describe('CombatEffectService splash', () => {
  const origin = { lat: 48.0, lon: 9.0, height: 0 };

  function enemyAt(id: string, metersNorth: number, isAirUnit: boolean) {
    return {
      id,
      alive: true,
      position: { lat: origin.lat + metersNorth / METERS_PER_DEGREE_LAT, lon: origin.lon },
      typeConfig: { id, isAirUnit, heightOffset: isAirUnit ? 15 : 0 },
      transform: { terrainHeight: 0 },
    };
  }

  let applyDamage: ReturnType<typeof vi.fn>;
  let applySlow: ReturnType<typeof vi.fn>;
  let applyPoison: ReturnType<typeof vi.fn>;
  let airTargetingUnlocked = false;

  function hit(
    towerType: TowerTypeId,
    splashVictims: ReturnType<typeof enemyAt>[],
  ): string[] {
    mockInjections['GlobalRouteGridService'] = { getEnemiesInRadiusGeo: () => splashVictims };
    const service = new CombatEffectService();
    const primary = enemyAt('primary', 0, false);
    const projectileType = TOWER_TYPES[towerType].projectileType as ProjectileTypeId;
    const projectile = {
      typeConfig: PROJECTILE_TYPES[projectileType],
      damage: 60,
      sourceTowerId: 't-1',
      sourceTowerType: towerType,
      targetLost: false,
      position: origin,
    };
    (service as unknown as {
      handleProjectileHit: (p: unknown, e: unknown, d: string) => void;
    }).handleProjectileHit(projectile, primary, TOWER_TYPES[towerType].damageType);
    return applyDamage.mock.calls.map((c) => (c[1] as { id: string }).id);
  }

  beforeEach(() => {
    Object.keys(mockInjections).forEach((k) => delete mockInjections[k]);
    applyDamage = vi.fn(() => null);
    applySlow = vi.fn();
    applyPoison = vi.fn();
    airTargetingUnlocked = false;
    mockInjections['DamageApplicationService'] = { applyDamage };
    mockInjections['StatusEffectService'] = { applySlow, applyPoison };
    mockInjections['CombatVfxService'] = {
      emitExplosion: vi.fn(),
      emitIceExplosion: vi.fn(),
      emitIceDecal: vi.fn(),
    };
    mockInjections['ResearchStore'] = { airTargetingUnlocked: () => airTargetingUnlocked };
  });

  it('cannon splash spares flyers the cannon cannot target', () => {
    expect(TOWER_TYPES.cannon.canTargetAir ?? false).toBe(false);
    const ids = hit('cannon', [enemyAt('zombie', 2, false), enemyAt('bat', 2, true)]);
    expect(ids).toContain('primary');
    expect(ids).toContain('zombie');
    expect(ids).not.toContain('bat');
  });

  it('poison splash neither damages nor poisons flyers', () => {
    const bat = enemyAt('bat', 2, true);
    const ids = hit('poison', [enemyAt('zombie', 2, false), bat]);
    expect(ids).toContain('zombie');
    expect(ids).not.toContain('bat');
    expect(applyPoison.mock.calls.some((c) => c[0] === bat)).toBe(false);
  });

  it('cannon splash stops at the 8 nearest victims', () => {
    const cap = PROJECTILE_TYPES.cannonball.splashMaxTargets!;
    // Absichtlich ungeordnet: gewählt wird nach Abstand, nicht nach Grid-Reihenfolge.
    const meters = [5.5, 0.5, 4.5, 1, 5, 1.5, 2, 3, 2.5, 3.5];
    const victims = meters.map((m) => enemyAt(`z${m}`, m, false));
    const ids = hit('cannon', victims);

    const nearest = [...meters].sort((a, b) => a - b).slice(0, cap).map((m) => `z${m}`);
    expect(ids.filter((id) => id !== 'primary').sort()).toEqual(nearest.sort());
    expect(ids).not.toContain('z5.5');
    expect(ids).not.toContain('z5');
  });

  it('ice splash still reaches flyers, ice targets air', () => {
    const bat = enemyAt('bat', 2, true);
    const ids = hit('ice', [enemyAt('zombie', 2, false), bat]);
    expect(ids).toContain('zombie');
    expect(ids).toContain('bat');
    expect(applySlow.mock.calls.some((c) => c[0] === bat)).toBe(true);
  });
});
