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
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { ABILITY_DEATH_BLOOD_CAP } from '../../configs/visual-effects.config';

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
      heightOffset: isAirUnit ? 15 : 0,
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

  it('poisons primary and splash targets with the DOT scaled by the glob damage', () => {
    const zombie = enemyAt('zombie', 2, false);
    hit('poison', [zombie]);
    // The glob hits for 60: the base DOT times 60 over the tower's base damage
    const dotDps = GAME_BALANCE.effects.poison.dotDamagePerSecond * (60 / TOWER_TYPES.poison.damage);
    expect(applyPoison.mock.calls.map((c) => c[1])).toEqual([dotDps, dotDps]);
    expect(applyPoison.mock.calls[1][0]).toBe(zombie);
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

describe('CombatEffectService hits on a body along the route', () => {
  const impact = { lat: 48.0, lon: 9.0, height: 0 };

  function ooze(id: string, hitDistanceM: number) {
    return {
      id,
      alive: true,
      // Its tip, where a hit must not be measured from
      position: { lat: 48.01, lon: 9.0 },
      typeConfig: { id: 'ooze', isAirUnit: false },
      heightOffset: 0,
      transform: { terrainHeight: 0 },
      body: { setHitGeo: vi.fn(), hitDistanceM, hit: { lat: 0, lon: 0, height: 0 } },
    };
  }

  let applyDamage: ReturnType<typeof vi.fn>;
  let getEnemiesInRadiusGeo: ReturnType<typeof vi.fn>;

  function shoot(primary: ReturnType<typeof ooze>, victims: ReturnType<typeof ooze>[]): void {
    getEnemiesInRadiusGeo = vi.fn(() => victims);
    mockInjections['GlobalRouteGridService'] = { getEnemiesInRadiusGeo };
    const service = new CombatEffectService();
    const projectile = {
      typeConfig: PROJECTILE_TYPES.cannonball,
      damage: 60,
      sourceTowerId: 't-1',
      sourceTowerType: 'cannon',
      targetLost: false,
      position: impact,
      flightHeight: 10.8,
      aimPoint: { ...impact, height: 10.8 },
    };
    (service as unknown as {
      handleProjectileHit: (p: unknown, e: unknown, d: string) => void;
    }).handleProjectileHit(projectile, primary, 'siege');
  }

  beforeEach(() => {
    Object.keys(mockInjections).forEach((k) => delete mockInjections[k]);
    applyDamage = vi.fn(() => null);
    mockInjections['DamageApplicationService'] = { applyDamage };
    mockInjections['StatusEffectService'] = { applySlow: vi.fn(), applyPoison: vi.fn() };
    mockInjections['CombatVfxService'] = { emitIceExplosion: vi.fn(), emitIceDecal: vi.fn() };
    mockInjections['ResearchStore'] = { airTargetingUnlocked: () => false };
  });

  it('puts the hit where the shot lands, on the ground under the aim point', () => {
    const primary = ooze('ooze', 0);
    shoot(primary, []);
    expect(primary.body.setHitGeo).toHaveBeenCalledWith(impact.lat, impact.lon, expect.closeTo(10, 9));
    expect(applyDamage.mock.calls[0][1]).toBe(primary);
  });

  it('detonates the splash at the impact, not at the tip', () => {
    shoot(ooze('ooze', 0), []);
    expect(getEnemiesInRadiusGeo.mock.calls[0][0]).toBe(impact);
    expect(getEnemiesInRadiusGeo.mock.calls[0][2]).toBe('ooze');
  });

  it('falls off by the distance to the nearest point of a body the splash reached', () => {
    const radius = PROJECTILE_TYPES.cannonball.splashRadius!;
    const victim = ooze('other', radius / 2);
    shoot(ooze('ooze', 0), [victim]);
    const splash = applyDamage.mock.calls.find((c) => c[1] === victim)!;
    expect(splash[2]).toBe(30);
  });
});

describe('CombatEffectService ability strike', () => {
  let applyMaxHpFraction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.keys(mockInjections).forEach((k) => delete mockInjections[k]);
    // Everyone dies except the enemy called 'survivor'
    applyMaxHpFraction = vi.fn((_vfx: unknown, enemy: { id: string }) => enemy.id !== 'survivor');
    mockInjections['DamageApplicationService'] = { applyMaxHpFraction };
  });

  it('applies each target its own share and counts the kills', () => {
    const service = new CombatEffectService();
    const targets = [
      { id: 'a', alive: true, typeConfig: { isBoss: false } },
      { id: 'survivor', alive: true, typeConfig: { isBoss: true } },
    ];
    const kills = service.applyAbilityStrike(
      targets as never,
      (enemy) => (enemy.typeConfig.isBoss ? 0.2 : 0.6),
    );
    expect(kills).toBe(1);
    expect(applyMaxHpFraction.mock.calls.map((c) => [(c[1] as { id: string }).id, c[2]])).toEqual([
      ['a', 0.6],
      ['survivor', 0.2],
    ]);
  });

  it('skips targets that are already dead', () => {
    const service = new CombatEffectService();
    service.applyAbilityStrike([{ id: 'gone', alive: false, typeConfig: {} }] as never, () => 0.6);
    expect(applyMaxHpFraction).not.toHaveBeenCalled();
  });

  it('spawns death blood for the first kills only when 200 die at once', () => {
    const service = new CombatEffectService();
    const targets = Array.from({ length: 200 }, (_, i) => ({ id: `z${i}`, alive: true, typeConfig: {} }));
    expect(service.applyAbilityStrike(targets as never, () => 0.6)).toBe(200);
    const bloody = applyMaxHpFraction.mock.calls.filter((c) => c[3] === true).length;
    expect(bloody).toBe(ABILITY_DEATH_BLOOD_CAP);
  });
});
