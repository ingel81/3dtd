/**
 * The missile standing in the missile silo, through the real chain: the
 * AbilityManager's events, the VFXService deciding from them
 * (launchSiteLoaded) and the ThreeTowerRenderer showing or hiding the node
 * in every silo model, the standing ones and those built later. Model
 * loading and the rest of the engine are stubs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Group, Object3D, Scene, Vector3 } from 'three';
import { GameEventBus } from '../game-engine/game-event-bus';
import { VFXService } from '../game-engine/vfx.service';
import { AbilityManager, type AbilityWorld } from '../managers/ability.manager';
import { ThreeTowerRenderer, type TowerRenderData } from '../three-engine/renderers/three-tower.renderer';
import { createTowerAim } from '../entities/tower-aim';
import { ABILITIES } from '../configs/abilities.config';
import { MISSILE_LAUNCH_LOOK } from '../configs/visual-effects.config';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { ThreeTilesEngine } from '../three-engine';

const STEP_MS = 1000 / 60;
const NUKE = ABILITIES['nuclear-strike'];
const TARGET = { lat: 48.1, lon: 9.1, height: 0 };

describe('Missile silo: the missile standing in it', () => {
  let bus: GameEventBus;
  let manager: AbilityManager;
  let towers: ThreeTowerRenderer;
  let siloId: string | null;

  /** A silo-like model: the building and its missile */
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => {
      const model = new Group();
      for (const name of ['silo', MISSILE_LAUNCH_LOOK.missile.node]) {
        const node = new Object3D();
        node.name = name;
        model.add(node);
      }
      return model;
    },
  };

  const build = async (id: string): Promise<TowerRenderData> => {
    const data = (await towers.create(id, 'missile-silo', 48.09, 9.08, 12, 0, createTowerAim(TOWER_TYPES['missile-silo'], 0)))!;
    siloId = id;
    manager.buildingChanged('missile-silo');
    return data;
  };
  const missileShown = (data: TowerRenderData) => data.mesh.getObjectByName(MISSILE_LAUNCH_LOOK.missile.node)!.visible;
  const completeWave = () =>
    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: false, closeCall: false, hpLost: 0 });

  beforeEach(() => {
    bus = new GameEventBus();
    siloId = null;
    const world: AbilityWorld = {
      launchSite: () => (siloId ? { towerId: siloId, position: { lat: 48.09, lon: 9.08, height: 12 } } : null),
      snapToRoute: (target) => target,
      enemiesInRadius: (_center, _radius, out) => out,
      strike: () => 0,
      showDamage: () => undefined,
      halt: () => undefined,
      routeSweep: () => null,
    };
    manager = new AbilityManager(bus, world);
    manager.setPhaseProvider(() => 'wave');
    towers = new ThreeTowerRenderer(
      new Scene(),
      { geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat) } as never,
      assetManager as never,
    );
    const engine = {
      towers,
      sync: { geoToLocalSimpleInto: (lat: number, lon: number, height: number, out: Vector3) => out.set(lon, height, lat) },
      abilityMarkers: { showStrike: vi.fn(), removeStrike: vi.fn(), clear: vi.fn() },
      missileLaunches: { launch: vi.fn(), land: vi.fn(), clear: vi.fn() },
      mushroomClouds: { detonate: vi.fn(), clear: vi.fn() },
      frostBursts: { clear: vi.fn() },
      empPulses: { clear: vi.fn() },
      orbitalBeams: { clear: vi.fn() },
      effects: { markScorch: vi.fn() },
    };
    new VFXService(bus, engine as unknown as ThreeTilesEngine);
    bus.emit({
      type: 'research:completed',
      researchId: 'nuclear-strike',
      effects: [{ kind: 'global-perk', perkId: NUKE.perkId, description: '' }],
    });
  });

  it('stands loaded in a new silo, is gone the moment the strike is fired, and is back with the charge', async () => {
    const silo = await build('silo-1');
    expect(missileShown(silo)).toBe(true);

    const used = manager.use('nuclear-strike', TARGET);
    expect(used.ok).toBe(true);
    // In the same call as the command: before any frame is drawn
    expect(missileShown(silo)).toBe(false);

    for (let i = 0; i < Math.ceil(NUKE.warningMs / STEP_MS); i++) manager.update(STEP_MS);
    expect(manager.hasPendingStrikes()).toBe(false);
    expect(missileShown(silo)).toBe(false);

    for (let wave = 1; wave < NUKE.rechargeWaves; wave++) completeWave();
    expect(missileShown(silo)).toBe(false);
    completeWave();
    expect(manager.getStatus('nuclear-strike').charges).toBe(1);
    expect(missileShown(silo)).toBe(true);
  });

  it('builds a silo without its missile while the charge is out, and with it once it is back', async () => {
    await build('silo-1');
    manager.use('nuclear-strike', TARGET);
    towers.remove('silo-1');
    siloId = null;
    manager.buildingChanged('missile-silo');

    const second = await build('silo-2');
    expect(missileShown(second)).toBe(false);
    // The strike lands after its silo was sold, the charge comes back
    for (let i = 0; i < Math.ceil(NUKE.warningMs / STEP_MS); i++) manager.update(STEP_MS);
    for (let wave = 0; wave < NUKE.rechargeWaves; wave++) completeWave();
    expect(missileShown(second)).toBe(true);
  });

  it('stands loaded again after a restart', async () => {
    const silo = await build('silo-1');
    manager.use('nuclear-strike', TARGET);
    expect(missileShown(silo)).toBe(false);
    bus.emit({ type: 'game:reset' });
    expect(missileShown(silo)).toBe(true);
  });
});
