/**
 * Playtest 312 and 313 (night 2026-09-14): a tower on a stone plinth. The
 * real TowerManager places and sells it, the real TowerPlinthRenderer puts
 * the plinth into a scene, the real ScreenPicker picks from the tower meshes
 * plus the plinth meshes, as ThreeTilesEngine hands them to it
 * (three-tiles-engine.ts, pickableTowers). The tower model is a stand-in box
 * standing on the foot. The shot comes from the real ProjectileManager.
 *
 * Click and hover both take the picker's answer (InputHandlerService: the
 * click selects the id, the hover shows its range, input-handler-hover.spec.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type Object3D, type WebGLRenderer } from 'three';
import { TowerManager } from '../../../managers/tower.manager';
import { TowerPlinthRenderer } from './tower-plinth.renderer';
import { ScreenPicker } from '../../screen-picker';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import { createTestManagers, createMockResearchStore, TEST_PATH } from '../../../integration/test-helpers';
import type { Tower } from '../../../entities/tower.entity';
import type { ThreeTilesEngine } from '../../index';

/** Local frame of the test: x = lon, z = lat, y = height, in metres. */
const sync = {
  geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat),
};

const RECT = { left: 0, top: 0, width: 800, height: 600 };
const CENTER = { x: 400, y: 300 };
/** The foot (top of the plinth) and the plinth under it */
const FOOT = 7;
const PLINTH = 2.5;

function setup() {
  const scene = new Scene();
  const plinths = new TowerPlinthRenderer(scene, sync);
  // Stand-in tower model: a 2 x 6 x 2 m box on the foot
  const models = new Map<string, Mesh>();
  const towers = {
    create: vi.fn((id: string, _type: string, lat: number, lon: number, footY: number) => {
      const mesh = new Mesh(new BoxGeometry(2, 6, 2), new MeshBasicMaterial());
      mesh.position.set(lon, footY + 3, lat);
      scene.add(mesh);
      models.set(id, mesh);
    }),
    remove: vi.fn((id: string) => {
      const mesh = models.get(id);
      if (mesh) scene.remove(mesh);
      models.delete(id);
    }),
    clear: vi.fn(),
    select: vi.fn(),
    deselect: vi.fn(),
    getAllMeshes: () => [...models].map(([id, mesh]) => ({ id, mesh: mesh as Object3D })),
  };
  const engine = {
    towers,
    plinths,
    towerBadges: { setRank: vi.fn(), remove: vi.fn(), clear: vi.fn() },
    searchlights: { add: vi.fn(), remove: vi.fn(), clear: vi.fn() },
    tentacles: { create: vi.fn(), remove: vi.fn(), clear: vi.fn() },
    effects: { spawnTowerInnerFire: vi.fn(), stopTowerInnerFire: vi.fn(), stopAllTowerFires: vi.fn() },
    sync,
    spatialAudio: { registerSound: vi.fn(), playAt: vi.fn(), playAtGeo: vi.fn(() => Promise.resolve()) },
  };
  const m = createTestManagers();
  const manager = new TowerManager(m.eventBus, createMockResearchStore());
  manager.initialize(engine as unknown as ThreeTilesEngine);

  // Side view at the height of the plinth, the canvas centre on its middle
  const camera = new PerspectiveCamera(40, RECT.width / RECT.height, 1, 1000);
  camera.position.set(0, FOOT - PLINTH / 2, 60);
  camera.lookAt(0, FOOT - PLINTH / 2, 0);
  camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => RECT } } as unknown as WebGLRenderer;
  const sources = { tiles: () => null, devTerrain: () => null };
  // As the engine builds it: the tower meshes, then the plinths
  const picker = new ScreenPicker(camera, renderer, {
    getAllMeshes: () => [...towers.getAllMeshes(), ...plinths.getAllMeshes()],
  }, sources);
  const modelsOnly = new ScreenPicker(camera, renderer, { getAllMeshes: () => towers.getAllMeshes() }, sources);
  const pick = (p: ScreenPicker = picker) => {
    scene.updateMatrixWorld();
    return p.raycastTowers(CENTER.x, CENTER.y);
  };
  return { m, manager, plinths, pick, modelsOnly };
}

describe('A tower on its stone plinth (playtest 312, 313)', () => {
  let s: ReturnType<typeof setup>;
  let tower: Tower;

  beforeEach(() => {
    s = setup();
    tower = s.manager.placeTower({ lat: 0, lon: 0, height: FOOT }, 'cannon', 0, PLINTH)!;
  });

  it('312: a click or hover on the plinth below the model picks the tower on it', () => {
    expect(s.plinths.count).toBe(1);
    expect(s.pick()).toBe(tower.id);
    // The model alone does not reach down there: the plinth mesh answers
    expect(s.pick(s.modelsOnly)).toBeNull();
  });

  it('312: the shot starts at the raised tip, the foot on the plinth plus the shoot height', () => {
    const enemy = s.m.enemyManager.spawn(TEST_PATH, 'zombie');
    s.m.projectileManager.spawn(tower, enemy);

    const { heightOffset, shootHeight } = TOWER_TYPES.cannon;
    const startHeight = s.m.tilesEngine.projectiles.create.mock.calls[0][4];
    expect(startHeight).toBeCloseTo(FOOT + heightOffset + shootHeight, 6);
    expect(startHeight - (FOOT - PLINTH)).toBeCloseTo(PLINTH + heightOffset + shootHeight, 6);
  });

  it('313: selling takes the plinth with the tower; nothing is picked there any more', () => {
    s.manager.sell(tower);
    expect(s.plinths.count).toBe(0);
    expect(s.pick()).toBeNull();
  });
});
