import { isDevMode } from '@angular/core';
import { Group, type Matrix4, type Object3D, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import type { RootLoadFailure } from '../three-engine/tile-loading-tracker';
import { FLAT_WORLD_ORIGIN, flatLocalToGeo } from '../world/flat-frame';
import type { WorldRef } from '../world/world-ref';
import type {
  StreetStyle,
  WorldAttachContext,
  WorldCapabilities,
  WorldProvider,
  WorldStartLayout,
} from '../world/world-provider';
import { DevStreetProvider } from './dev-street.provider';
import { DevTerrainProvider } from './dev-terrain.provider';
import { DevWorldSurface } from './dev-world-surface';
import type { DevWorldService } from './devworld.service';

/** The procedural offline world: no real place, nothing streams, rolled again in place */
export const DEV_WORLD_CAPABILITIES: WorldCapabilities = {
  realPlace: false,
  streaming: false,
  ecef: false,
  credentials: false,
  regenerate: true,
  destructible: false,
  ownEnvironment: false,
  controls: 'environment',
};

/**
 * Generated streets on steep procedural terrain: lines lifted higher and cut
 * into 2 m pieces to follow the slopes, heights from the plain terrain, no
 * off-street leg carried on (in `gentle` the terrain climbs some 190 % at
 * the HQ, the leg would run into the hill).
 */
export const DEV_WORLD_STREET_STYLE: StreetStyle = {
  overlayLift: 3,
  routeLineLift: 3,
  subdivideM: 2,
  plainGround: true,
  carryOffStreet: false,
};

/** The DevWorld ref of a configuration */
export function devWorldRef(devWorld: DevWorldService): WorldRef {
  const { terrain, seed, buildings, spawnCount } = devWorld.config;
  return { kind: 'devworld', terrain, seed, buildings, spawns: spawnCount };
}

/**
 * DevWorld as a WorldProvider (docs/DEVWORLD.md): the procedural terrain,
 * roads and buildings of DevTerrainProvider in a group at the scene origin,
 * EnvironmentControls over it, the generated street network
 * (DevStreetProvider), HQ at the origin and the generator's spawns.
 * DevWorldService holds the configuration from the URL and the debug panel.
 */
export class DevWorldProvider implements WorldProvider {
  readonly capabilities = DEV_WORLD_CAPABILITIES;
  readonly sync = new EllipsoidSync(FLAT_WORLD_ORIGIN.lat, FLAT_WORLD_ORIGIN.lon, FLAT_WORLD_ORIGIN.height);
  readonly surface: DevWorldSurface;
  readonly streets: DevStreetProvider;
  readonly streetStyle = DEV_WORLD_STREET_STYLE;
  readonly tiles = null;
  readonly destruction = null;

  private readonly terrain: DevTerrainProvider;
  /** Holds the whole DevWorld, a direct child of the scene: the LOS cube renders it as the blockers */
  private group: Group | null = null;
  private attached = false;
  private readonly firstGroundWaiters: (() => void)[] = [];

  constructor(private readonly devWorld: DevWorldService) {
    this.terrain = new DevTerrainProvider(devWorld);
    this.surface = new DevWorldSurface(this.terrain, this.sync);
    this.streets = new DevStreetProvider();
  }

  get ref(): WorldRef {
    return devWorldRef(this.devWorld);
  }

  /**
   * DevWorld uses EnvironmentControls (not GlobeControls): GlobeControls is
   * made for a globe at Earth-radius distances, DevWorld is flat terrain at
   * the local origin, and EnvironmentControls raycast against its geometry.
   */
  async attach(ctx: WorldAttachContext): Promise<void> {
    if (isDevMode()) console.log('[DevWorld] procedural terrain instead of 3D tiles');

    // A plain group at the local origin (no ECEF transformation), unlike the
    // tiles group with its inverse ENU frame
    const group = new Group();
    group.name = 'DevWorldGroup';
    ctx.scene.add(group);
    this.group = group;

    // Terrain directly into the group at local coordinates: Y-up, centred at the origin
    await this.terrain.initialize(group);
    this.streets.setGeneratedStreets(this.terrain.getStreetSegments());

    ctx.cameraRig.setupEnvironmentControls(ctx.scene, group);

    // Loaded at once: nothing streams in DevWorld
    this.attached = true;
    for (const waiter of this.firstGroundWaiters.splice(0)) waiter();
  }

  /** Frames draw from the start, also while the world is generated */
  ready(): boolean {
    return true;
  }

  setOrigin(lat: number, lon: number, height: number): void {
    this.sync.setOrigin(lat, lon, height);
  }

  /** The overlay stands at the terrain's base: nothing moves under it */
  update(_camera: PerspectiveCamera, overlay: Group): void {
    overlay.position.y = 0;
  }

  resize(_camera: PerspectiveCamera, _renderer: WebGLRenderer): void {
    // no resolution to follow
  }

  setDrawSuppressed(): void {
    // no queues to widen
  }

  /**
   * The group with all of DevWorld. The TowerShadowMapper hides every scene
   * child but this one; a nested child like the terrain group would be
   * hidden with the rest.
   */
  losBlockers(): Object3D | null {
    return this.group;
  }

  /** A flat world has no ECEF frame */
  sceneToEcef(_target: Matrix4): Matrix4 | null {
    return null;
  }

  /** Generated here: nothing to credit */
  attribution(): string[] {
    return [];
  }

  onFirstGround(callback: () => void): void {
    if (this.attached) callback();
    else this.firstGroundWaiters.push(callback);
  }

  /** Generated on the device: nothing to refuse, nothing to reach */
  onLoadFailure(_callback: (failure: RootLoadFailure) => void): void {
    // never fails to load
  }

  /**
   * HQ at the origin; spawns: the street generator's first ones, as many as
   * the configuration asks (one by default, matching the real world: bots
   * and measurements play the game that ships, `?devworld&spawns=N` gives a
   * lane per coop player), else the configured fallback spawn.
   */
  /** The intro flies the longest route */
  introTour(): null {
    return null;
  }

  startLayout(): WorldStartLayout {
    const hq = { lat: FLAT_WORLD_ORIGIN.lat, lon: FLAT_WORLD_ORIGIN.lon };
    if (!this.attached) return { hq, spawns: [] };
    const generated = this.terrain.getSpawnPoints().slice(0, this.devWorld.config.spawnCount);
    if (generated.length > 0) {
      return {
        hq,
        spawns: generated.map((spawn) => ({ id: spawn.id, name: spawn.name, ...flatLocalToGeo(spawn.position.x, spawn.position.z) })),
      };
    }
    const spawnConfig = this.devWorld.config.spawn;
    const position = this.devWorld.getSpawnPosition();
    return { hq, spawns: [{ id: `spawn-${spawnConfig}`, name: `Spawn ${spawnConfig}`, ...flatLocalToGeo(position.x, position.z) }] };
  }

  /** DevWorld plays the game's rules (bot runs measure the game that ships) */
  runRules(): null {
    return null;
  }

  /** The game's waves (`?waves=` may pick the source) */
  worldWaves(): null {
    return null;
  }

  /** A new world from the current configuration (debug panel); the streets follow */
  async regenerate(): Promise<void> {
    await this.terrain.regenerate();
    this.streets.setGeneratedStreets(this.terrain.getStreetSegments());
  }

  /**
   * DevWorld owns a generation Web Worker and a set of raycast-only building
   * meshes that live outside the scene graph; nothing else disposes them.
   */
  dispose(): void {
    this.terrain.dispose();
  }
}
