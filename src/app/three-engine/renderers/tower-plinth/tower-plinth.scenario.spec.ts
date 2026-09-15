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
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLCoordinateSystem,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { TowerManager } from '../../../managers/tower.manager';
import { TowerPlinthRenderer } from './tower-plinth.renderer';
import { plinthBraces } from './plinth-braces';
import { braceCourse, PLINTH_EMBED_M, type PlinthBrace } from './plinth-geometry';
import { ScreenPicker } from '../../screen-picker';
import { TowerShadowMapper } from '../../tower-shadow-mapper';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import { footprintSampleOffsets } from '../../../utils/tower-footprint';
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
  const pickAt = (x: number, y: number, p: ScreenPicker = picker) => {
    scene.updateMatrixWorld();
    return p.raycastTowers(x, y);
  };
  const pick = (p: ScreenPicker = picker) => pickAt(CENTER.x, CENTER.y, p);
  /** Canvas position of a point in the scene */
  const toScreen = (point: Vector3) => {
    const ndc = point.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * RECT.width, y: ((1 - ndc.y) / 2) * RECT.height };
  };
  return { m, manager, plinths, scene, pick, pickAt, toScreen, modelsOnly };
}

/** The members CubeCamera.update and the TowerShadowMapper touch; `onRender` runs once per face. */
function fakeRenderer(onRender: () => void): WebGLRenderer {
  return {
    coordinateSystem: WebGLCoordinateSystem,
    xr: { enabled: false },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn(),
    render: vi.fn(() => onRender()),
    getClearColor: (target: Color) => target.set(0x87ceeb),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
  } as unknown as WebGLRenderer;
}

/** Whether `obj` gets drawn: it and every ancestor visible. */
function drawn(obj: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
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

describe('A tower on its plinth at a roof edge, braced over the drop (E18)', () => {
  const radius = TOWER_TYPES.cannon.footprintRadius;
  /** The probes of its footprint east of a roof edge 2 m from the tower, the street far below */
  const overhang = footprintSampleOffsets(radius).flatMap(([x], index) => (x > 2 ? [index] : []));
  const braces = plinthBraces(radius, PLINTH, overhang);

  /** A point inside the second course of `brace`, in the scene */
  const braceMiddle = (brace: PlinthBrace) => {
    const { step, height } = braceCourse(brace);
    const reach = brace.topReach - 1.5 * step;
    const y = -PLINTH_EMBED_M - 1.5 * height;
    return new Vector3(
      Math.cos(brace.angle) * reach - Math.sin(brace.angle) * brace.offset,
      FOOT - PLINTH + y,
      Math.sin(brace.angle) * reach + Math.cos(brace.angle) * brace.offset,
    );
  };
  /** The corbel nearest the camera, which looks from +z */
  const front = braces.reduce((a, b) => (braceMiddle(b).z > braceMiddle(a).z ? b : a));

  let s: ReturnType<typeof setup>;
  let tower: Tower;

  beforeEach(() => {
    s = setup();
    tower = s.manager.placeTower({ lat: 0, lon: 0, height: FOOT }, 'cannon', 0, PLINTH, overhang)!;
  });

  it('builds the braces into the plinth below it; a click on one picks the tower', () => {
    expect(braces.length).toBeGreaterThan(0);
    const point = braceMiddle(front);
    // Below the plinth, in the air past the roof edge
    expect(point.y).toBeLessThan(FOOT - PLINTH - PLINTH_EMBED_M - 0.2);
    expect(point.x).toBeGreaterThan(2);

    const { x, y } = s.toScreen(point);
    expect(s.pickAt(x, y)).toBe(tower.id);
    expect(s.pickAt(x, y, s.modelsOnly)).toBeNull();
  });

  it('stays out of the LOS cube like the plinth: only the blocker group is drawn from the tip (Regel 8)', () => {
    const tiles = new Group();
    const tile = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    tiles.add(tile);
    s.scene.add(tiles);
    const plinth = s.plinths.getAllMeshes()[0].mesh;

    let faces = 0;
    const mapper = new TowerShadowMapper(fakeRenderer(() => {
      faces++;
      expect(drawn(tile)).toBe(true);
      expect(drawn(plinth)).toBe(false);
    }), s.scene);
    const tip = new Vector3(0, FOOT + TOWER_TYPES.cannon.heightOffset + TOWER_TYPES.cannon.shootHeight, 0);

    expect(mapper.update(tip, TOWER_TYPES.cannon.range, tiles)).toBe(true);
    expect(faces).toBe(6);
    expect(drawn(plinth)).toBe(true);
    mapper.dispose();
  });

  it('goes with the tower on sale, braces and all, and with every tower when the towers are cleared', () => {
    const { x, y } = s.toScreen(braceMiddle(front));
    s.manager.sell(tower);
    expect(s.plinths.count).toBe(0);
    expect(s.pickAt(x, y)).toBeNull();

    s.manager.placeTower({ lat: 0, lon: 0, height: FOOT }, 'cannon', 0, PLINTH, overhang);
    expect(s.pickAt(x, y)).not.toBeNull();
    s.manager.clear();
    expect(s.plinths.count).toBe(0);
    expect(s.scene.children.some((child) => child.name === 'tower-plinth')).toBe(false);
  });
});
