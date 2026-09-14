import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed, as in boss-intro.service.spec.ts
vi.mock('@angular/cdk/a11y', () => ({ LiveAnnouncer: class LiveAnnouncer {} }));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('../ai/training/training-client.service', () => ({ TrainingClientService: class TrainingClientService {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./keyboard-pan.service', () => ({ KeyboardPanService: class KeyboardPanService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({ IntroCameraFlightService: class IntroCameraFlightService {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));
vi.mock('../store/game.store', () => ({ GameStore: class GameStore {} }));
vi.mock('./debug/debug-facade.service', () => ({ DebugFacadeService: class DebugFacadeService {} }));
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));

import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { BossIntroService } from './boss-intro.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TrainingClientService } from '../ai/training/training-client.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { CameraControlService } from './camera-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { UIStore } from '../store/ui.store';
import { GameStore } from '../store/game.store';
import { DebugFacadeService } from './debug/debug-facade.service';
import { GameEventBus } from '../game-engine/game-event-bus';
import { TerrainQueries } from '../three-engine/terrain-queries';
import type { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { instrumentRaycasts, raycastStats } from '../utils/raycast-stats';
import {
  BOSS_INTRO_TIMING,
  BOSS_SHOT_RAYS,
  bossClearDistance,
  bossIntroCutMs,
  bossIntroReturnMs,
  pointAlongRoute,
  portalShot,
  type ShotPoint,
} from '../utils/boss-intro';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';

/**
 * Night-2 playtest 366 on a real map (2026-09-14): the spawn portal between
 * two houses in a narrow street. The shot along the route looked across the
 * houses after a bend (only the top of the portal above the roofs, Herbert
 * hidden) or over a crown in front of the boss. Replayed on the real
 * BossIntroService against synthetic tiles: boxes and a sphere as tile
 * meshes in a tiles group, the rays from the real TerrainQueries, booked by
 * the real raycast stats. Front faces only, like a single-sided tile material.
 */

/** 1e-5 degrees are one metre in the fake sync (x east, -z north); height 100 is ground 0. */
const waypoint = (north: number, east: number): RouteWaypoint => ({
  lat: north * 1e-5,
  lon: east * 1e-5,
  height: 100,
  // An 8 m corridor at the start: a portal of scale 1
  corridorLeft: 4,
  corridorRight: 4,
});

/** The portal in a narrow street, the route turns east into a side street 16 m on */
const BEND: RouteWaypoint[] = [waypoint(0, 0), waypoint(16, 0), waypoint(16, 200)];
const STRAIGHT: RouteWaypoint[] = [waypoint(0, 0), waypoint(200, 0)];
const local = (route: RouteWaypoint[]): ShotPoint[] => route.map((w) => ({ x: w.lon * 1e5, y: 0, z: -w.lat * 1e5 }));

/** Up to its health bar, as the service frames it */
const heightOf = (type: 'herbert' | 'worm' | 'ooze') => ENEMY_TYPES[type].heightOffset + ENEMY_TYPES[type].healthBarOffset;

/** Axis-aligned house, local corners */
interface House {
  min: ShotPoint;
  max: ShotPoint;
}

function tilesWorld() {
  const group = new Group();
  const activeTiles = new Set<object>();
  const tiles = { group, activeTiles } as unknown as TilesRenderer;
  const terrain = new TerrainQueries({} as EllipsoidSync, { tiles: () => tiles, devTerrain: () => null });
  const material = new MeshBasicMaterial();
  const houses: House[] = [];
  const crowns: { centre: ShotPoint; radius: number }[] = [];

  const add = (geometry: BufferGeometry, x: number, y: number, z: number, rotateX = 0) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotateX;
    const tile = { internal: { depth: 18 }, geometricError: 1, engineData: { scene: mesh } };
    mesh.userData['tile'] = tile;
    group.add(mesh);
    group.updateMatrixWorld(true);
    activeTiles.add(tile);
  };
  add(new PlaneGeometry(1000, 1000), 0, 0, 0, -Math.PI / 2);
  instrumentRaycasts(group);

  return {
    terrain,
    house(minX: number, maxX: number, minZ: number, maxZ: number, top = 12) {
      houses.push({ min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: top, z: maxZ } });
      add(new BoxGeometry(maxX - minX, top, maxZ - minZ), (minX + maxX) / 2, top / 2, (minZ + maxZ) / 2);
    },
    crown(x: number, y: number, z: number, radius: number) {
      crowns.push({ centre: { x, y, z }, radius });
      add(new SphereGeometry(radius, 24, 16), x, y, z);
    },
    /** Inside a house or a crown */
    buried(p: Vector3): boolean {
      return (
        houses.some(
          (h) => p.x > h.min.x && p.x < h.max.x && p.y > h.min.y && p.y < h.max.y && p.z > h.min.z && p.z < h.max.z,
        ) || crowns.some((c) => Math.hypot(p.x - c.centre.x, p.y - c.centre.y, p.z - c.centre.z) < c.radius)
      );
    },
    /** Nothing between the camera and the boss's feet, chest and head, cast both ways */
    sees(eye: Vector3, boss: ShotPoint, height: number): boolean {
      return [0.2, 0.55, 0.95].every((share) => {
        const y = boss.y + share * height;
        return (
          !terrain.raycastLineOfSight(eye.x, eye.y, eye.z, boss.x, y, boss.z) &&
          !terrain.raycastLineOfSight(boss.x, y, boss.z, eye.x, eye.y, eye.z)
        );
      });
    },
  };
}

/** Screenshot 1: houses along the street, the corner house in the bend, a row across the side street */
function junction() {
  const world = tilesWorld();
  world.house(-40, -4, -20, 30);
  world.house(4, 200, -12, 30);
  world.house(-40, 200, -60, -20);
  return world;
}

/** Screenshot 2: houses on both sides, a crown over the street between the camera and the boss */
function treeStreet() {
  const world = tilesWorld();
  world.house(-40, -4, -200, 30);
  world.house(4, 40, -200, 30);
  world.crown(0, 7, -22, 3.5);
  return world;
}

interface Boss {
  enemy: Enemy;
  walked: number;
}

describe('Boss intro shot, night-2 playtest 366 on a narrow street replayed', () => {
  let bus: GameEventBus;
  let camera: PerspectiveCamera;
  let injector: Injector | null;
  let service: BossIntroService;

  const frame = (ms = 16) => service.update(ms);
  const play = (ms: number) => {
    for (let t = 0; t < ms; t += 16) service.update(Math.min(16, ms - t));
  };
  const bossRays = () => raycastStats.rows().find((row) => row.caller === 'bossShot')?.calls ?? 0;

  function boss(type: 'herbert' | 'worm' | 'ooze', route: RouteWaypoint[]): Boss {
    const b: Boss = { enemy: null as unknown as Enemy, walked: 0 };
    b.enemy = {
      typeConfig: ENEMY_TYPES[type],
      active: true,
      alive: true,
      movement: { path: route, getDistanceAlongPath: () => b.walked },
    } as unknown as Enemy;
    return b;
  }

  /** The service over `terrain`; the boss out of its portal, the camera at the start of the hold. */
  function cutTo(terrain: TerrainQueries, ...bosses: Boss[]): { raysPerFrame: number[] } {
    bus = new GameEventBus();
    camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
    camera.position.set(-240, 310, 520);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const engine = {
      getCamera: () => camera,
      getControls: () => ({ enabled: true }),
      getTerrainHeightAtGeo: () => 0,
      terrain,
      sync: {
        getOrigin: () => ({ lat: 0, lon: 0, height: 100 }),
        geoToLocalSimple: (lat: number, lon: number) => new Vector3(lon * 1e5, 0, -lat * 1e5),
      },
    };
    injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: { getEventBus: () => bus, waveNumber: () => 10 } },
        {
          provide: GameStore,
          useValue: { trainingTimescale: signal(1), renderingEnabled: signal(true), paused: signal(false) },
        },
        { provide: UIStore, useValue: { photoMode: signal(false) } },
        { provide: TrainingClientService, useValue: { botEnabled: signal(false), isConnected: signal(false) } },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: CameraControlService, useValue: { stopJump: vi.fn() } },
        { provide: KeyboardPanService, useValue: { clearKeys: vi.fn() } },
        { provide: IntroCameraFlightService, useValue: { active: signal(false) } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: LiveAnnouncer, useValue: { announce: vi.fn() } },
        { provide: DebugFacadeService, useValue: { bossIntroEnabled: signal(true) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
      ],
    });
    service = runInInjectionContext(injector, () => new BossIntroService());

    for (const b of bosses) bus.emit({ type: 'enemy:spawned', enemy: b.enemy, viaPortal: true });
    // The first steps out; any other still waits inside its portal
    bosses[0].walked = 20;
    raycastStats.reset();
    frame();
    expect(service.stage()).toBe('dip-in');
    const raysPerFrame: number[] = [];
    let before = bossRays();
    for (let t = 0; t < bossIntroCutMs(); t += 16) {
      service.update(Math.min(16, bossIntroCutMs() - t));
      raysPerFrame.push(bossRays() - before);
      before = bossRays();
    }
    expect(service.stage()).toBe('hold');
    return { raysPerFrame };
  }

  beforeEach(() => {
    injector = null;
  });

  afterEach(() => (injector as unknown as { destroy(): void } | null)?.destroy());

  const bossOn = (route: RouteWaypoint[]) => pointAlongRoute(local(route), bossClearDistance(1), { x: 0, y: 0, z: 0 });

  for (const type of ['herbert', 'worm', 'ooze'] as const) {
    it(`${type}: out of a portal in a narrow street with a bend, the camera sees it and does not stand in a house`, () => {
      const world = junction();
      // Along the route the camera would look back across the corner house
      const along = portalShot(local(BEND), 60, 1, bossClearDistance(1), heightOf(type))!.position;
      expect(world.sees(new Vector3(along.x, along.y, along.z), bossOn(BEND), heightOf(type))).toBe(false);

      cutTo(world.terrain, boss(type, BEND));
      expect(world.sees(camera.position, bossOn(BEND), heightOf(type))).toBe(true);
      expect(world.buried(camera.position)).toBe(false);
      // Still looking back at the portal, down the street
      const view = camera.getWorldDirection(new Vector3());
      expect(view.z).toBeGreaterThan(0.5);
    });

    it(`${type}: a crown over the street in front of it: the camera sees past it and is not inside it`, () => {
      const world = treeStreet();
      const along = portalShot(local(STRAIGHT), 60, 1, bossClearDistance(1), heightOf(type))!.position;
      expect(world.sees(new Vector3(along.x, along.y, along.z), bossOn(STRAIGHT), heightOf(type))).toBe(false);

      cutTo(world.terrain, boss(type, STRAIGHT));
      expect(world.sees(camera.position, bossOn(STRAIGHT), heightOf(type))).toBe(true);
      expect(world.buried(camera.position)).toBe(false);
    });
  }

  it('an open street keeps the framing the intro had', () => {
    const world = tilesWorld();
    cutTo(world.terrain, boss('herbert', STRAIGHT));
    const shot = portalShot(local(STRAIGHT), 60, 1, bossClearDistance(1), heightOf('herbert'))!;
    expect(camera.position.x).toBeCloseTo(shot.position.x);
    expect(camera.position.y).toBeCloseTo(shot.position.y);
    expect(camera.position.z).toBeCloseTo(shot.position.z);
    const view = camera.getWorldDirection(new Vector3());
    const aim = new Vector3(shot.target.x, shot.target.y, shot.target.z).sub(camera.position).normalize();
    expect(view.angleTo(aim)).toBeLessThan(1e-6);
  });

  it('Herbert and the ooze out together: one intro on Herbert, and he is in clear view', () => {
    const world = junction();
    const herbert = boss('herbert', BEND);
    const ooze = boss('ooze', BEND);
    ooze.walked = 4; // still in its portal
    cutTo(world.terrain, herbert, ooze);
    expect(service.card()).toEqual({ name: 'Herbert & Ooze', wave: 10 });
    expect(world.sees(camera.position, bossOn(BEND), heightOf('herbert'))).toBe(true);
    expect(world.buried(camera.position)).toBe(false);
  });

  it('books its rays as bossShot, spread over the veil and within the budget', () => {
    const world = junction();
    const { raysPerFrame } = cutTo(world.terrain, boss('herbert', BEND));
    const total = bossRays();
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(BOSS_SHOT_RAYS.total);
    for (const rays of raysPerFrame) expect(rays).toBeLessThanOrEqual(BOSS_SHOT_RAYS.perFrame);
    // The camera goes back to the player's view as before
    play(bossIntroReturnMs() - bossIntroCutMs() + BOSS_INTRO_TIMING.revealMs);
    expect(service.active()).toBe(false);
    expect(camera.position.distanceTo(new Vector3(-240, 310, 520))).toBeLessThan(1e-9);
  });
});
