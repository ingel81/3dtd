/**
 * Playtest 347, 348, 350, 351 and 404 (docs/archive/REVIEW_SPRINT_2026-09-14.md,
 * tower veterans). Killing blows go through the real DamageApplicationService
 * into the real TowerManager; each "frame" runs syncVeteranBadges, as
 * GameLoopFacadeService does, into a real TowerBadgeRenderer. The upgrade
 * goes through TowerLifecycle.upgrade, the kill cheat through the
 * WaveManager's debug:kill-all. Rendering is not drawn: the badge is read
 * from its instance attributes (chevrons, star, gold).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// DamageApplicationService is providedIn root; constructed by hand here
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, Injectable: () => (target: unknown) => target };
});

import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, type InstancedBufferGeometry, type Object3D } from 'three';
import { createTestManagers, TestManagers, TEST_PATH, TEST_TOWER_POSITION, tickEngine } from '../integration/test-helpers';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import type { CombatVfxService } from '../services/combat/combat-vfx.service';
import { TowerBadgeRenderer } from '../three-engine/renderers/tower-badge/tower-badge.renderer';
import { TowerLifecycle } from './game-state/tower-lifecycle';
import { VETERAN_TOOLTIP, veteranView } from '../components/game-sidebar/tower-panel/tower-stats';
import type { Tower } from '../entities/tower.entity';

const vfx = {
  emitHitBlood: vi.fn(),
  emitDeathBlood: vi.fn(),
  emitBloodEffect: vi.fn(),
} as unknown as CombatVfxService;

describe('Tower veterans, playtest 347 to 351 and 404', () => {
  let m: TestManagers;
  let damage: DamageApplicationService;
  let badges: TowerBadgeRenderer;
  let scene: Scene;
  const models: Record<string, Object3D> = {};

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    scene = new Scene();
    badges = new TowerBadgeRenderer(scene, (id) => models[id] ?? null);
    // The shared engine mock has no tentacle or plinth renderer, TowerManager.clear() needs both
    Object.assign(m.tilesEngine, {
      towerBadges: badges,
      tentacles: { remove: vi.fn(), clear: vi.fn() },
      plinths: { remove: vi.fn(), clear: vi.fn() },
    });
    m.towerManager.initialize(m.engine);
    damage = new DamageApplicationService();
    damage.initialize(m.towerManager, m.enemyManager, m.eventBus);
  });

  afterEach(() => {
    m.enemyManager.clear();
    for (const id of Object.keys(models)) delete models[id];
    vi.restoreAllMocks();
  });

  function archer(): Tower {
    const tower = m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer')!;
    // The tower's model in the scene, 10 m tall: the badge stands on its top
    const mesh = new Mesh(new BoxGeometry(2, 10, 2).translate(0, 5, 0), new MeshBasicMaterial());
    models[tower.id] = mesh;
    return tower;
  }

  /** `n` zombies, each killed by one hit of `tower`, then a frame. */
  function killBy(tower: Tower, n: number): void {
    for (let i = 0; i < n; i++) {
      const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie');
      damage.applyDamage(vfx, enemy, 1e9, 'physical', tower.id, false, true);
    }
    tickEngine(m, 2_000);
    m.towerManager.syncVeteranBadges();
  }

  /** The insignia drawn in a badge slot: [chevrons, star, gold]. */
  const insignia = (slot = 0) => {
    const geometry = (scene.children[0] as Mesh).geometry as InstancedBufferGeometry;
    return Array.from(geometry.getAttribute('aStyle').array.slice(slot * 3 + 0, slot * 3 + 3));
  };

  it('347: a new archer is a recruit, 0 / 10 kills, the tooltip names the ladder, no badge yet', () => {
    const tower = archer();
    m.towerManager.syncVeteranBadges();

    expect(veteranView(tower.combat.kills)).toMatchObject({ level: 0, name: 'Recruit', kills: 0, nextAt: 10 });
    expect(VETERAN_TOOLTIP).toContain('Blooded 10 · Veteran 50 · Elite 150 · Champion 400 · Legend 1000');
    expect(badges.count).toBe(0);
  });

  it('348, 404: at 10 killing blows BLOODED, 10 / 50, one silver chevron; at 50 two', () => {
    const tower = archer();
    killBy(tower, 9);
    expect(tower.combat.kills).toBe(9);
    expect(badges.count).toBe(0);

    killBy(tower, 1);
    expect(veteranView(tower.combat.kills)).toMatchObject({ name: 'Blooded', kills: 10, nextAt: 50, gold: false });
    expect(insignia()).toEqual([1, 0, 0]);

    killBy(tower, 40);
    expect(veteranView(tower.combat.kills)).toMatchObject({ name: 'Veteran', kills: 50, nextAt: 150 });
    expect(insignia()).toEqual([2, 0, 0]);
  });

  it('351: three silver chevrons at 150, three gold at 400 (name and bar gold), a star at 1000', () => {
    const tower = archer();
    killBy(tower, 149);
    expect(insignia()).toEqual([2, 0, 0]);
    killBy(tower, 1);
    expect(veteranView(150)).toMatchObject({ name: 'Elite', gold: false });
    expect(insignia()).toEqual([3, 0, 0]);

    killBy(tower, 250);
    expect(tower.combat.kills).toBe(400);
    expect(veteranView(400)).toMatchObject({ name: 'Champion', gold: true });
    expect(insignia()).toEqual([3, 0, 1]);

    killBy(tower, 600);
    expect(tower.combat.kills).toBe(1000);
    expect(veteranView(1000)).toMatchObject({ name: 'Legend', icon: 'star', gold: true, nextAt: null });
    expect(insignia()).toEqual([0, 1, 1]);
  });

  it('351: the kill cheat kills the wave but gives no tower a kill', () => {
    const tower = archer();
    killBy(tower, 9);
    for (let i = 0; i < 5; i++) m.enemyManager.spawn(TEST_PATH, 'zombie');

    m.eventBus.emit({ type: 'debug:kill-all' });
    tickEngine(m, 2_000);
    m.towerManager.syncVeteranBadges();

    expect(m.enemyManager.getAlive()).toHaveLength(0);
    expect(tower.combat.kills).toBe(9);
    expect(badges.count).toBe(0);
  });

  it('350, 404: an upgrade keeps rank and badge; selling takes the badge at once; photo mode hides; restart clears', () => {
    const tower = archer();
    const other = archer();
    killBy(tower, 10);
    killBy(other, 50);
    expect(badges.count).toBe(2);

    const lifecycle = new TowerLifecycle(
      m.towerManager,
      { getMaxUpgradeTier: () => 5 } as never,
      m.waveManager,
      m.enemyManager,
      {} as never,
      {} as never,
      {} as never,
      { spend: () => true } as never,
      m.eventBus,
      () => m.engine,
      () => false,
    );
    expect(lifecycle.upgrade(tower, 'damage')).toBe(true);
    expect(tower.getUpgradeLevel('damage')).toBe(1);
    m.towerManager.syncVeteranBadges();
    expect(tower.combat.kills).toBe(10);
    expect(veteranView(tower.combat.kills).name).toBe('Blooded');
    expect(insignia(0)).toEqual([1, 0, 0]);

    m.towerManager.sell(tower);
    expect(badges.count).toBe(1);
    expect(insignia(0)).toEqual([0, 0, 0]);

    // Photo mode (PhotoModeService.enter/exit, see photo-mode.service.spec.ts)
    const mesh = scene.children[0] as Mesh;
    badges.setVisible(false);
    expect(mesh.visible).toBe(false);
    badges.setVisible(true);
    expect(mesh.visible).toBe(true);

    // Restart: GameStateManager.reset() clears the TowerManager (game-state.manager.ts:802)
    m.towerManager.clear();
    expect(badges.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });
});
