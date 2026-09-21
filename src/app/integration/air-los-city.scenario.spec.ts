/**
 * What the line of sight costs an air defense, measured in a city.
 *
 * `air-cap-estimate.scenario.spec.ts` settles the cap's arithmetic on flat
 * ground with the line of sight stubbed clear: there both waves die whole.
 * This one puts a defense of the same shape into a street grid with
 * buildings and lets the real air-LOS pipeline decide what each tower sees:
 * `GlobalRouteGrid.registerTower` -> `resolveTowerLos` -> `isCubeVisible`
 * against the tower's cube, and the combat reading `cell.towerVisibility`
 * and `cell.airVisibility` per enemy (`buildLosCheck`).
 *
 * Only the six cube faces are not the GPU's. They are ray cast on the CPU
 * against the same blocks, texel centre by texel centre, through the inverse
 * of the mapping `sampleCubeAtPoint` uses, and packed with the byte layout
 * of three's `packDepthToRGBA`. Faces fill on demand, since a resolve reads
 * a few hundred of the 1.5 million texels. The near plane of the cube camera
 * and the `FrontSide` of the distance material are kept: geometry nearer
 * than 0.1 m and a tip inside a block write nothing, as the real render does
 * (docs/LOS_PIPELINE.md, rules 5 to 8).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) mockServices[name] = withAutoStubs({});
      return mockServices[name];
    },
  };
});

import { Vector3, type WebGLCubeRenderTarget } from 'three';
import { createMockTilesEngine, withAutoStubs, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { GameObject } from '../core/game-object';
import { analyzeDefense } from '../director/defense-analyzer';
import { survivableCount, TEMPLATES } from '../director/templates';
import { ENEMY_TYPES, type EnemyTypeId } from '../configs/enemy-types.config';
import { TOWER_TYPES, type TowerTypeId } from '../configs/tower-types.config';
import { LOS_VIZ_CONFIG, losCubeFarDistance } from '../configs/los-viz.config';
import { isCubeVisible, type LosResolveContext } from '../utils/gpu-cube-resolve';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

const ORIGIN = { lat: TEST_SPAWN_POINTS[0].lat, lon: TEST_SPAWN_POINTS[0].lon, height: 300 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/** Local x, z of the flat frame to geo, the inverse of `flatSync`. */
function localToGeo(x: number, z: number): GeoPosition {
  return {
    lat: ORIGIN.lat - z / METERS_PER_DEGREE_LAT,
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
    height: ORIGIN.height,
  };
}

/** Geo to local on a flat frame around the origin, as the engine's sync near it. */
const flatSync = {
  getOrigin: () => ({ ...ORIGIN }),
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
};

// -- The city ---------------------------------------------------------

/** A building: a solid block from the ground up, as photogrammetry hands them over. */
interface Block {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

/** Street pitch: 64 m of block, 16 m of street. */
const BLOCK_PITCH = 80;
const STREET_HALF_WIDTH = 8;

/** Heights the blocks take, spread around the 15 m the air sample sits at. */
const BLOCK_TOPS = [9, 14, 22, 31, 42, 11, 26, 18];

/** Blocks between the streets at x = 0, 80, 160 and z = 0, -80, -160, -240. */
const BLOCKS: Block[] = (() => {
  const out: Block[] = [];
  for (let i = -1; i <= 2; i++) {
    for (let j = -1; j <= 3; j++) {
      const x0 = BLOCK_PITCH * i + STREET_HALF_WIDTH;
      const z0 = -BLOCK_PITCH * j - BLOCK_PITCH + STREET_HALF_WIDTH;
      out.push({
        x0,
        x1: x0 + BLOCK_PITCH - 2 * STREET_HALF_WIDTH,
        z0,
        z1: z0 + BLOCK_PITCH - 2 * STREET_HALF_WIDTH,
        top: BLOCK_TOPS[((i + 1) * 5 + (j + 1)) % BLOCK_TOPS.length],
      });
    }
  }
  return out;
})();

/** The route: a staircase through the grid, 400 m, four right-angle corners. */
const LEGS: [number, number][] = [[0, 0], [0, -80], [80, -80], [80, -160], [160, -160], [160, -240]];
const ROUTE_STEP_M = 10;

const ROUTE: RouteWaypoint[] = (() => {
  const pts: { x: number; z: number }[] = [];
  for (let s = 0; s < LEGS.length - 1; s++) {
    const [ax, az] = LEGS[s];
    const [bx, bz] = LEGS[s + 1];
    const n = Math.round(Math.hypot(bx - ax, bz - az) / ROUTE_STEP_M);
    for (let k = 0; k < n; k++) pts.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
  }
  pts.push({ x: LEGS[LEGS.length - 1][0], z: LEGS[LEGS.length - 1][1] });
  return pts.map(({ x, z }) => ({ ...localToGeo(x, z), corridorLeft: 3, corridorRight: 3 }));
})();

const BASE: GeoPosition = ROUTE[ROUTE.length - 1];

// -- A tower cube, rendered on the CPU --------------------------------

/** `CubeCamera(0.1, ...)` in TowerShadowMapper: nearer geometry is clipped away. */
const CUBE_NEAR_M = 0.1;

/** Entry distance of the ray into the block, or Infinity. Slab test, `dir` normalized. */
function blockEntry(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: Block,
): number {
  let t0 = -Infinity;
  let t1 = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    const a = (lo - o) / d;
    const c = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
    return true;
  };
  if (!slab(ox, dx, b.x0, b.x1)) return Infinity;
  if (!slab(oy, dy, 0, b.top)) return Infinity;
  if (!slab(oz, dz, b.z0, b.z1)) return Infinity;
  if (t1 < t0) return Infinity;
  // Front faces only (the distance material is FrontSide) and nothing in
  // front of the near plane: a tip inside a block sees none of it.
  return t0 > CUBE_NEAR_M ? t0 : Infinity;
}

/** Nearest block face along the ray, or Infinity where nothing is hit. */
function nearestBlock(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  let best = Infinity;
  for (const b of BLOCKS) {
    const t = blockEntry(ox, oy, oz, dx, dy, dz, b);
    if (t < best) best = t;
  }
  return best;
}

/** Is the segment from the tip to the point clear of every block? The CPU fallback of the combat. */
function segmentClear(tipX: number, tipY: number, tipZ: number, x: number, y: number, z: number): boolean {
  const dx = x - tipX;
  const dy = y - tipY;
  const dz = z - tipZ;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  return nearestBlock(tipX, tipY, tipZ, dx / len, dy / len, dz / len) >= len - LOS_VIZ_CONFIG.visibilityBiasMeters;
}

/**
 * Direction of the centre of texel (px, py) on `face`, the inverse of the
 * face and (s, t) arithmetic in `sampleCubeAtPoint`. Not normalized.
 */
function texelDirection(face: number, px: number, py: number, size: number, out: Vector3): void {
  const s = ((px + 0.5) / size) * 2 - 1;
  const t = ((py + 0.5) / size) * 2 - 1;
  switch (face) {
    case 0: out.set(1, -t, -s); break;
    case 1: out.set(-1, -t, s); break;
    case 2: out.set(s, 1, t); break;
    case 3: out.set(s, -1, -t); break;
    case 4: out.set(s, -t, 1); break;
    default: out.set(-s, -t, -1); break;
  }
}

/** three's `packDepthToRGBA` for a value in (0, 1), written as the four bytes readPixels returns. */
function packDepth(v: number, buf: Uint8Array, o: number): void {
  let vuf = Math.floor(v * 16777216);
  const af = v * 16777216 - vuf;
  let next = Math.floor(vuf / 256);
  const bf = vuf / 256 - next;
  vuf = next;
  next = Math.floor(vuf / 256);
  const gf = vuf / 256 - next;
  const byte = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
  buf[o] = byte(next / 255);
  buf[o + 1] = byte((gf * 256) / 255);
  buf[o + 2] = byte((bf * 256) / 255);
  buf[o + 3] = byte(af);
}

/**
 * One cube face whose texels are ray cast the first time they are read.
 * A resolve asks for a few hundred of the 262144 texels of a 512 face; the
 * values are the ones a full render would leave there.
 */
function lazyFace(face: number, size: number, tipX: number, tipY: number, tipZ: number, far: number): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  const filled = new Uint8Array(size * size);
  const dir = new Vector3();
  return new Proxy(buf, {
    get(target, prop, receiver) {
      const o = typeof prop === 'string' ? Number(prop) : NaN;
      if (!Number.isInteger(o) || o < 0 || o >= target.length) return Reflect.get(target, prop, receiver);
      const texel = o >> 2;
      if (!filled[texel]) {
        filled[texel] = 1;
        texelDirection(face, texel % size, Math.floor(texel / size), size, dir);
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        const dist = nearestBlock(tipX, tipY, tipZ, dir.x / len, dir.y / len, dir.z / len);
        // Nothing hit, or a hit past the far plane: the cleared colour stays,
        // and `unpackTexel` reads it back as the far distance.
        if (dist < far) packDepth(dist / far, target, texel * 4);
      }
      return target[o];
    },
  });
}

/** The context `registerTower` resolves against, for a tip in this city. */
function createCubeContext(tipX: number, tipY: number, tipZ: number, far: number): LosResolveContext {
  const size = LOS_VIZ_CONFIG.cubeSize;
  const faces = Array.from({ length: 6 }, (_, face) => lazyFace(face, size, tipX, tipY, tipZ, far));
  return {
    cube: { width: size } as WebGLCubeRenderTarget,
    referencePos: new Vector3(tipX, tipY, tipZ),
    farDistance: far,
    faces,
    visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
    emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
  };
}

// -- The game ---------------------------------------------------------

/**
 * The shape the measurement found in the wild: many towers, few that shoot
 * up. Two archers (air-capable, range 30) near the spawn, four poison towers
 * (ground only, range 55) along the rest of the route, each 5 m off the
 * centre line and inside its street.
 */
const DEFENSE: { type: TowerTypeId; x: number; z: number }[] = [
  { type: 'archer', x: 5, z: -20 },
  { type: 'archer', x: 5, z: -30 },
  { type: 'poison', x: 60, z: -75 },
  { type: 'poison', x: 85, z: -120 },
  { type: 'poison', x: 100, z: -155 },
  { type: 'poison', x: 165, z: -170 },
];

/** How much headroom the cap promised in the field cases that went wrong. */
const FIELD_HEADROOM = 1.6;

/** Longest a wave may take here, in 16 ms frames. */
const MAX_FRAMES = 240_000 / 16;

/** Tips of the placed towers, for the CPU fallback of the combat. */
const towerTips = new Map<string, { x: number; y: number; z: number }>();

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'oozes']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync });
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['towers']['isTurretAligned'] = () => true;
  // The CPU fallback of buildLosCheck, against the same blocks.
  engine['towers']['hasLineOfSight'] = (id: string, x: number, y: number, z: number) => {
    const tip = towerTips.get(id);
    return tip ? segmentClear(tip.x, tip.y, tip.z, x, y, z) : true;
  };
  engine['towers']['get'] = () => undefined;
  engine['hero'] = withAutoStubs({});
  engine['flameBeams'] = withAutoStubs({});
  engine['tentacles'] = withAutoStubs({});
  engine['bloodMoon'] = withAutoStubs({});
  engine['spatialAudio']['playAtGeo'] = () => Promise.resolve();
  engine['spatialAudio']['getListener'] = () => ({
    context: { state: 'running', resume: () => Promise.resolve() },
    getWorldPosition: (target: Vector3) => target.set(0, 0, 0),
  });
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

interface Game {
  gsm: GameStateManager;
  grid: GlobalRouteGridService;
  towers: Tower[];
  frame: () => void;
}

function createGrid(): GlobalRouteGridService {
  const grid = new GlobalRouteGridService();
  grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, flatSync as never);
  grid.generateFromRoutes([ROUTE]);
  return grid;
}

function createGame(defense: { type: TowerTypeId; x: number; z: number }[] = DEFENSE): Game {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();
  towerTips.clear();

  const grid = createGrid();
  const paths = new Map<string, GeoPosition[]>([['spawn-1', ROUTE]]);

  mockServices['GlobalRouteGridService'] = grid;
  mockServices['SpatialGridService'] = new SpatialGridService();
  mockServices['ResearchStore'] = withAutoStubs({ airTargetingUnlocked: () => false });
  mockServices['PathAndRouteService'] = withAutoStubs({ getCachedPaths: () => paths });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();
  mockServices['TowerCombatService'] = new TowerCombatService();

  const gsm = new GameStateManager();
  gsm.initialize(createEngine(), BASE, TEST_SPAWN_POINTS, paths);

  const towers = defense.map(({ type, x, z }) => {
    const config = TOWER_TYPES[type];
    const tower = gsm.towerManager.placeTower(localToGeo(x, z), type, 0)!;
    const tipY = config.heightOffset + config.shootHeight;
    towerTips.set(tower.id, { x, y: tipY, z });
    // The real registration path: cells in range, resolved against the cube.
    tower.visibleCells = grid.registerTower(
      tower.id, x, z, config.range,
      createCubeContext(x, tipY, z, config.range),
      config.canTargetGround ?? true,
      config.canTargetAir ?? false,
    );
    tower.losReady = true;
    return tower;
  });

  let now = 1000;
  return { gsm, grid, towers, frame: () => { now += 16; gsm.update(now); } };
}

/** What `survivableCount` promises this defense against `templateId`. */
function predict(towers: Tower[], templateId: string, spawnDelayMs: number): number | null {
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const defense = analyzeDefense(towers, false, null);
  return survivableCount(
    template,
    1,
    spawnDelayMs,
    defense.gateDpsPerArmor,
    defense.killThroughput,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseHp ?? 1,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
    () => 1,
    () => 1,
    100,
    1,
    1,
  );
}

/** Send `count` enemies of `type` down the route and run the wave out. */
function fight(game: Game, type: EnemyTypeId, count: number): { killed: number; leaked: number } {
  let killed = 0;
  let leaked = 0;
  const bus = game.gsm.getEventBus();
  bus.on('enemy:died', () => { killed++; });
  bus.on('enemy:reached-base', () => { leaked++; });

  const speed = ENEMY_TYPES[type].baseSpeed;
  game.gsm.beginWave();
  for (let i = 0; i < count; i++) game.gsm.enemyManager.spawn(ROUTE, type, speed);
  for (let f = 0; f < MAX_FRAMES && game.gsm.waveManager.phase() === 'wave'; f++) game.frame();

  return { killed, leaked };
}

// -- The measurements -------------------------------------------------

interface Census {
  cells: number;
  ground: number;
  air: number;
  groundOnly: number;
  airOnly: number;
}

/**
 * Ground and air visibility of every route cell in range, for a tower of
 * `type` at each of `spots`. One grid per spot, so no answers are shared.
 */
function census(type: TowerTypeId, spots: { x: number; z: number }[], far?: number): Census {
  const config = TOWER_TYPES[type];
  const tipY = config.heightOffset + config.shootHeight;
  const cubeFar = far ?? config.range;
  const out: Census = { cells: 0, ground: 0, air: 0, groundOnly: 0, airOnly: 0 };
  for (const [i, spot] of spots.entries()) {
    const grid = createGrid();
    const id = `census-${i}`;
    grid.registerTower(id, spot.x, spot.z, config.range, createCubeContext(spot.x, tipY, spot.z, cubeFar), true, true);
    for (const cell of grid.getCellsInRange(spot.x, spot.z, config.range)) {
      const ground = cell.towerVisibility.get(id);
      const air = cell.airVisibility.get(id);
      if (ground === undefined || air === undefined) continue;
      out.cells++;
      if (ground) out.ground++;
      if (air) out.air++;
      if (ground && !air) out.groundOnly++;
      if (air && !ground) out.airOnly++;
    }
  }
  return out;
}

/** Share of the cells in range a tower of `type` sees at the air sample, per spot. */
function airVisibleShare(type: TowerTypeId, spots: { x: number; z: number }[], far?: number): number[] {
  return spots.map((spot) => {
    const c = census(type, [spot], far);
    return c.cells === 0 ? 1 : c.air / c.cells;
  });
}

/** Spots 5 m off the centre line, on both sides, every `everyNth` route point. */
function spotsAlongRoute(everyNth: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 1; i < ROUTE.length - 1; i += everyNth) {
    const here = flatSync.geoToLocalSimple(ROUTE[i].lat, ROUTE[i].lon, ORIGIN.height);
    const next = flatSync.geoToLocalSimple(ROUTE[i + 1].lat, ROUTE[i + 1].lon, ORIGIN.height);
    const dx = next.x - here.x;
    const dz = next.z - here.z;
    const len = Math.hypot(dx, dz) || 1;
    // 5 m to the left and to the right of the direction of travel
    for (const side of [1, -1]) {
      out.push({ x: here.x + (side * 5 * -dz) / len, z: here.z + (side * 5 * dx) / len });
    }
  }
  return out;
}

describe('the line of sight of an air defense in a city', () => {
  afterEach(() => vi.restoreAllMocks());

  it('leaves the air sample at least as visible as the ground sample', () => {
    const spots = spotsAlongRoute(4);
    for (const type of ['archer', 'poison'] as const) {
      const range = TOWER_TYPES[type].range;
      const reaching = losCubeFarDistance(range);
      const c = census(type, spots, reaching);
      console.log(
        `${type} (${range} m, Cube-far ${reaching.toFixed(1)}): ${c.cells} Zellen, ` +
        `Boden sichtbar ${c.ground} (${((c.ground / c.cells) * 100).toFixed(1)} %), ` +
        `Luft sichtbar ${c.air} (${((c.air / c.cells) * 100).toFixed(1)} %), ` +
        `nur Boden ${c.groundOnly}, nur Luft ${c.airOnly}`,
      );
      // The air sample sits 13.5 m above the ground sample, so the ray to it
      // runs above the ray to the ground everywhere between tip and cell. Over
      // blockers that stand on the ground it can only gain cells.
      expect(c.groundOnly).toBe(0);
      expect(c.airOnly).toBeGreaterThan(0);
    }
  });

  it('lost the outer ring to air targets while the cube stopped at the range', () => {
    const spots = spotsAlongRoute(4);
    for (const type of ['archer', 'poison'] as const) {
      const c = census(type, spots);
      console.log(
        `${type} (Cube-far = Reichweite ${TOWER_TYPES[type].range} m): ` +
        `Boden sichtbar ${c.ground}, Luft sichtbar ${c.air}, nur Boden ${c.groundOnly}, nur Luft ${c.airOnly}`,
      );
      expect(c.groundOnly).toBeGreaterThan(0);
    }
  });

  it('kills the same share of a ground wave and an air wave as on open ground', () => {
    const ground = createGame();
    const groundCap = predict(ground.towers, 'rat_tide', 0);
    const groundCount = Math.max(1, Math.round(groundCap! / FIELD_HEADROOM));
    const groundResult = fight(ground, 'rat', groundCount);
    console.log(`Boden: Deckel ${groundCap}, geschickt ${groundCount}, getoetet ${groundResult.killed}, durch ${groundResult.leaked}`);

    const air = createGame();
    const airCap = predict(air.towers, 'bat_swarm', 0);
    const airCount = Math.max(1, Math.round(airCap! / FIELD_HEADROOM));
    const airResult = fight(air, 'bat', airCount);
    console.log(`Luft:  Deckel ${airCap}, geschickt ${airCount}, getoetet ${airResult.killed}, durch ${airResult.leaked}`);

    expect(groundResult.killed / groundCount).toBeGreaterThan(0.9);
    expect(airResult.killed / airCount).toBeGreaterThan(0.9);
  });

  it('kills the air wave even with both anti-air towers at the worst spots for their sight', () => {
    // Upper bound of what the line of sight can cost an air defense on this
    // route: the two archers stand where they see the least of the cells in
    // their range, the four ground towers stay where they were.
    const spots = spotsAlongRoute(1);
    const shares = airVisibleShare('archer', spots);
    const worst = shares
      .map((share, i) => ({ share, spot: spots[i] }))
      .sort((a, b) => a.share - b.share)
      .slice(0, 2);
    console.log(
      `Schlechteste Archer-Plaetze: ${worst
        .map((w) => `(${w.spot.x.toFixed(0)}, ${w.spot.z.toFixed(0)}) ${(w.share * 100).toFixed(0)} % sichtbar`)
        .join(', ')}`,
    );

    const game = createGame([
      ...worst.map(({ spot }) => ({ type: 'archer' as TowerTypeId, x: spot.x, z: spot.z })),
      ...DEFENSE.filter((d) => d.type !== 'archer'),
    ]);
    const cap = predict(game.towers, 'bat_swarm', 0);
    const count = Math.max(1, Math.round(cap! / FIELD_HEADROOM));
    const { killed, leaked } = fight(game, 'bat', count);
    console.log(`Luft (blind): Deckel ${cap}, geschickt ${count}, getoetet ${killed}, durch ${leaked}`);

    expect(killed / count).toBeGreaterThan(0.9);
  });
});

describe('the far distance a tower cube is rendered with', () => {
  /** A cube nothing was drawn into: every texel holds the cleared colour. */
  function emptyCube(tipY: number, far: number): LosResolveContext {
    const size = 8;
    return {
      cube: { width: size } as WebGLCubeRenderTarget,
      referencePos: new Vector3(0, tipY, 0),
      farDistance: far,
      faces: Array.from({ length: 6 }, () => new Uint8Array(size * size * 4)),
      visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
      emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
    };
  }

  /**
   * Every air-capable tower, at the edge of its range, over open ground: the
   * range is horizontal (`Tower.findTarget`), the air probe sits
   * `airSampleYOffset` above the cell, and an empty texel decodes to `far`.
   * With `far = range` the probe lay outside its own cube and the cell read
   * as blocked with nothing in the way.
   */
  const AIR_TOWERS: { type: TowerTypeId; tip: number }[] = [
    { type: 'archer', tip: 5.55 },
    { type: 'rocket', tip: 4.3 },
    { type: 'ice', tip: 3.5 },
    { type: 'lightning', tip: 9.65 },
    { type: 'chaos', tip: 5.8 },
  ];

  for (const { type, tip } of AIR_TOWERS) {
    it(`sees the air sample at the edge of a ${type}'s range`, () => {
      const range = TOWER_TYPES[type].range;
      const ctx = emptyCube(tip, losCubeFarDistance(range));
      const air = LOS_VIZ_CONFIG.airSampleYOffset;
      expect(isCubeVisible(0, tip, 0, range, air, 0, ctx)).toBe(true);
      expect(isCubeVisible(0, tip, 0, range, LOS_VIZ_CONFIG.groundSampleYOffset, 0, ctx)).toBe(true);

      // What it did with far = range: the ring the air probe lost.
      const tight = emptyCube(tip, range);
      const lost = range - Math.sqrt(
        Math.max(0, (range - LOS_VIZ_CONFIG.visibilityBiasMeters) ** 2 - (air - tip) ** 2),
      );
      expect(isCubeVisible(0, tip, 0, range, air, 0, tight)).toBe(false);
      console.log(`${type}: Reichweite ${range} m, ohne Zuschlag fehlten die aeusseren ${lost.toFixed(1)} m in der Luft`);
    });
  }
});
