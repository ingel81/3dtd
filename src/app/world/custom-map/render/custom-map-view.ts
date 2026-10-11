import { Group, Ray, Vector3, type Camera, type Object3D, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { CustomMapDocument, MapEnvironment, MapObject } from '../map-document';
import { HeightField } from './height-field';
import type { MapAssetLibrary } from './map-asset-library';
import { mapToScene, sceneToMap } from './map-coords';
import { CustomMapEnvironment } from './environment/map-environment';
import { EffectLayer } from './effects/effect-layer';
import { CoverMap } from './environment/cover-map';
import { MapObjectLayer, type ObjectHit } from './objects/object-layer';
import { BridgeLayer } from './paths/path-bridges';
import { MapTerrainLayer } from './terrain/map-terrain';
import { RiverSurface } from './water/river-surface';
import { WaterSurface } from './water/water-surface';
import type { GridRect } from './terrain/terrain-chunks';

/**
 * CustomMapView: draws a custom map document. The editor and the game use
 * the same view (docs/CUSTOM_MAPS.md).
 *
 * ```ts
 * const view = new CustomMapView(doc, MapAssetLibrary.shared(), { anisotropy });
 * view.attach(scene);                     // group + losBlockers as direct scene children
 * view.environment.apply(scene, renderer); // sky, environment light, sun with shadows, fog
 * await view.ready;                        // ground materials and models are in
 * view.update(dt, camera, focus?);         // every frame: LOD, wind, water, culling, shadow box
 * view.heightAt(x, y);                     // map space, metres
 * view.raycast(ray); view.raycastObjects(ray);
 * ```
 *
 * Frame: see map-coords.ts (scene x = -map x, scene z = map y, y up). The
 * group sits at the scene origin; it may be moved but not rotated, and the
 * map space queries (`heightAt`) do not follow a move.
 *
 * Editor updates: change the document in place, then call the matching
 * update with the changed rectangle in map metres (`updateHeights`,
 * `updateSplat`), or the whole part (`updateLayers`, `updateWater`,
 * `setObjects`, `updateObject`, `updatePaths`, `setEnvironment`).
 *
 * Line of sight: `losBlockers` holds the terrain and the objects that block
 * sight; it is the group a world provider hands to the LOS cube. Everything
 * else in `group` (water, decoration, bridges, the apron) is outside it and
 * marked `userData.losTransparent`. The LOS cube hides every direct scene
 * child except its group, so `losBlockers` must be a direct child of the
 * scene: `attach(scene)` adds `group` and lifts `losBlockers` beside it
 * (same transform, the group sits at the origin).
 */

/** Beyond this camera distance to its focus the grass blades are not drawn */
const GRASS_MAX_VIEW_DISTANCE = 140;

/** Rectangle in map metres */
export interface MapRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapRayHit {
  /** Scene position of the hit */
  point: Vector3;
  distance: number;
  /** Map position and surface height */
  x: number;
  y: number;
  height: number;
}

export interface CustomMapViewOptions {
  /** Anisotropic filtering of the ground textures (renderer.capabilities.getMaxAnisotropy()) */
  anisotropy?: number;
  /** Grass blades near the camera (default on) */
  grass?: boolean;
  /** The renderer the map is drawn with: bakes impostors for far trees (without it they keep their model) */
  renderer?: WebGLRenderer;
}

export class CustomMapView {
  /** All render content of the map */
  readonly group = new Group();
  /** Terrain and sight-blocking objects, the LOS cube's group */
  readonly losBlockers = new Group();
  readonly heights: HeightField;
  readonly ready: Promise<void>;
  /** Sky, lights and fog; the owner applies it to its scene (`environment.apply(scene, renderer)`) */
  readonly environment: CustomMapEnvironment;

  private readonly terrain: MapTerrainLayer;
  /** Main water body first (null without one), then the further bodies */
  private readonly waters: (WaterSurface | null)[] = [];
  private rivers: RiverSurface[] = [];
  private readonly objects: MapObjectLayer;
  private readonly bridges: BridgeLayer;
  private readonly effects: EffectLayer;
  /** Terrain and roof tops for the weather; rebuilt lazily (coverDirty) */
  private readonly cover: CoverMap;
  private coverDirty = true;
  private coverAge = 0;
  private readonly camPos = new Vector3();
  private readonly hitPoint = new Vector3();
  private readonly mapPoint = { x: 0, y: 0 };
  private readonly focusPoint = new Vector3();
  private readonly worldFocus = new Vector3();
  private readonly grassCenter = new Vector3();
  /** Object and terrain versions the sun's shadow map was last rendered for */
  private shadowVersion = -1;
  private readonly viewRay = new Ray();
  private disposed = false;

  constructor(
    readonly doc: CustomMapDocument,
    readonly assets: MapAssetLibrary,
    private readonly options: CustomMapViewOptions = {},
  ) {
    const t = doc.terrain;
    this.heights = new HeightField(t.grid, t.width, t.depth);
    this.group.name = 'custom-map';
    this.losBlockers.name = 'custom-map-los-blockers';
    this.group.add(this.losBlockers);

    this.terrain = new MapTerrainLayer(t, this.heights);
    this.losBlockers.add(this.terrain.chunks.group);
    this.group.add(this.terrain.apron);
    if (options.grass !== false) this.group.add(this.terrain.grass.mesh);

    this.environment = new CustomMapEnvironment(doc.environment);
    this.cover = new CoverMap(this.heights);
    this.environment.weather.setCover(this.cover);
    this.terrain.grass.setCover(this.cover);
    this.environment.setFogBase(lowGround(t.grid.heights, t.water?.level));
    this.updateWater();
    this.objects = new MapObjectLayer(this.heights, assets, this.losBlockers, {
      renderer: options.renderer,
      waterLevelAt: (x, y) => this.waterLevelAt(x, y),
    });
    this.group.add(this.objects.group);
    this.bridges = new BridgeLayer(this.heights, assets);
    this.group.add(this.bridges.group);
    this.effects = new EffectLayer(this.heights);
    this.group.add(this.effects.group);
    this.effects.setLavaLights(this.lavaLightPoints());
    this.ready = this.load();
    // Ground material, objects and bridges are in: the shadow map shows them
    void this.ready.then(() => this.environment.invalidateShadows(), () => undefined);
  }

  /**
   * Adds the map to a scene: `group`, and `losBlockers` as a direct child of
   * the scene (the LOS cube renders only one direct child). Without it,
   * `scene.add(view.group)` draws the same but the LOS cube would hide the
   * blockers with the group.
   */
  attach(scene: Object3D): void {
    scene.add(this.group);
    scene.add(this.losBlockers);
    // Measurement hook: a page that set `__mapProbe` before loading (Playwright init script) gets the view
    const g = globalThis as { __mapProbe?: unknown };
    if (g.__mapProbe) g.__mapProbe = this;
  }

  /**
   * Compiles every shader the map needs once its assets are in, off the
   * main thread where the driver allows (KHR_parallel_shader_compile), so
   * the first frames do not stall on compiles. Hidden levels, cells and
   * effects count too (three's compile walks hidden objects). `target` is
   * what the frames draw into: a game with bloom or grading draws into a
   * linear post-processing target, and programs built for the screen would
   * all link again in its first frame (output colour space and tone mapping
   * are part of a program). Resolves with the number of programs it built.
   */
  async warmUp(renderer: WebGLRenderer, scene: Object3D, camera: Camera, target: WebGLRenderTarget | null = null): Promise<number> {
    await Promise.all([this.ready, this.environment.envReady]);
    if (this.disposed) return 0;
    const before = renderer.info.programs?.length ?? 0;
    const previous = renderer.getRenderTarget();
    let compiled: Promise<unknown>;
    try {
      // compileAsync builds the programs before it returns its promise: the target only around the call
      renderer.setRenderTarget(target);
      compiled = renderer.compileAsync(scene, camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    await compiled;
    if (this.disposed) return 0;
    // compileAsync leaves out the shadow pass: its depth programs (instanced, alpha-tested cards,
    // per material) compiled on the first frame a caster entered the sun's box, a stall of seconds.
    // One frame with a cell of every asset casting compiles them now, during loading, into the same target
    if (renderer.shadowMap.enabled) {
      this.objects.showAllForWarmUp(true);
      const wasAuto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = true;
      renderer.shadowMap.needsUpdate = true;
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previous);
        renderer.shadowMap.autoUpdate = wasAuto;
        this.objects.showAllForWarmUp(false);
        // The warm-up frame drew every cell into the shadow map: the next frame draws the real one
        this.environment.invalidateShadows();
      }
    }
    return (renderer.info.programs?.length ?? 0) - before;
  }

  /**
   * Compiles the programs of assets that are not on the map yet (a biome's
   * palette, a template's objects), off the main thread where the driver
   * allows, so placing the first one does not stall on a synchronous link.
   * Bakes their impostors as well. `scene` gives the lights and fog the
   * programs are built for. Resolves with the number of programs built.
   * The sun's shadow depth programs are not part of it.
   */
  async warmUpAssets(renderer: WebGLRenderer, scene: Scene, camera: Camera, assetIds: string[]): Promise<number> {
    const meshes = await this.objects.warmUpMeshes(assetIds);
    if (this.disposed) return 0;
    const group = new Group();
    for (const m of meshes) group.add(m);
    const before = renderer.info.programs?.length ?? 0;
    try {
      await renderer.compileAsync(group, camera, scene);
    } finally {
      for (const m of meshes) m.dispose();
    }
    return (renderer.info.programs?.length ?? 0) - before;
  }

  /**
   * Shows or hides everything in the air: weather and ambient particles
   * (rain, snow, embers, ash, dust), object effects and light glows. For
   * renders that are not the player's view, like a top-down minimap, where the
   * particle box around the focus would show as a square.
   */
  setParticlesVisible(visible: boolean): void {
    this.environment.weather.mesh.visible = visible && this.environment.weather.active;
    this.effects.group.visible = visible;
  }

  /**
   * The highest water surface over the terrain at map point (x, y), null on
   * dry ground: the main water, further bodies (by their masks) and rivers
   */
  waterLevelAt(x: number, y: number): number | null {
    const t = this.doc.terrain;
    const f = this.heights;
    const ground = f.heightAt(x, y);
    const i = Math.round((x - f.originX) / f.cellSize);
    const j = Math.round((y - f.originY) / f.cellSize);
    let best: number | null = null;
    if (i >= 0 && j >= 0 && i < f.columns && j < f.rows) {
      const k = j * f.columns + i;
      for (const body of [t.water, ...(t.waterBodies ?? [])]) {
        if (body && body.mask[k] && body.level > ground && (best === null || body.level > best)) best = body.level;
      }
    }
    for (const r of t.rivers ?? []) {
      for (let s = 0; s < r.points.length - 1; s++) {
        const a = r.points[s];
        const b = r.points[s + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const half = (a.width + (b.width - a.width) * u) / 2;
        if (Math.hypot(x - a.x - dx * u, y - a.y - dy * u) > half) continue;
        const level = a.height + (b.height - a.height) * u;
        if (level > ground && (best === null || level > best)) best = level;
      }
    }
    return best;
  }

  /** Surface height at map point (x, y), the surface the finest terrain level shows */
  heightAt(x: number, y: number): number {
    return this.heights.heightAt(x, y);
  }

  /** First terrain hit of a scene-space ray, or null */
  raycast(ray: Ray): MapRayHit | null {
    const distance = this.heights.raycast(ray, this.hitPoint);
    if (distance === null) return null;
    const p = sceneToMap(this.hitPoint, this.mapPoint);
    return { point: this.hitPoint.clone(), distance, x: p.x, y: p.y, height: this.hitPoint.y };
  }

  /**
   * Per frame: terrain levels by camera distance, and the sun's shadow box
   * around `focus` (scene space; default: where the camera looks at the ground).
   */
  update(dtSeconds: number, camera: Camera, focus?: Vector3): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.updateFrame(dtSeconds, camera, focus);
    const ms = performance.now() - t0;
    this.stats.updateMs = this.stats.frames ? this.stats.updateMs * 0.95 + ms * 0.05 : ms;
    this.stats.frames++;
  }

  /** Main-thread cost of update(), smoothed, for measurements (sim-load --world, the preview) */
  readonly stats = { updateMs: 0, frames: 0 };

  private updateFrame(dtSeconds: number, camera: Camera, focus?: Vector3): void {
    for (const w of this.waters) w?.update(dtSeconds);
    for (const r of this.rivers) r.update(dtSeconds);
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    // focusPoint is in the group's frame (the map's), worldFocus in the scene's: the game moves the
    // group so that its HQ sits at the scene origin, and the lights and sky live in the scene
    if (focus) {
      this.group.worldToLocal(this.focusPoint.copy(focus));
    } else {
      this.viewRay.origin.copy(this.camPos);
      camera.getWorldDirection(this.viewRay.direction);
      if (this.heights.raycast(this.viewRay, this.focusPoint, 3000) === null) this.focusPoint.copy(this.camPos);
    }
    this.terrain.update(this.camPos, dtSeconds, this.focusPoint);
    // Shadow box sized to what the camera sees around the focus: sharp up close, wide from high up
    const reach = this.camPos.distanceTo(this.focusPoint);
    this.group.localToWorld(this.worldFocus.copy(this.focusPoint));
    // The box's radius in its steps, for the casters too: following the distance every frame, objects at
    // its edge switched casting on and off and the shadow map rendered again each frame (shimmer)
    const shadowRadius = this.environment.focus(this.worldFocus, Math.min(450, Math.max(70, reach * 0.9)));
    this.effects.update(dtSeconds, this.focusPoint);
    this.objects.shadowRadius = shadowRadius * 1.2;
    this.objects.update(dtSeconds, camera, this.focusPoint);
    // Grass between the camera's foot and the focus; from far up blades are below a pixel, skip them
    this.grassCenter.copy(this.camPos).lerp(this.focusPoint, 0.6);
    this.terrain.grass.update(dtSeconds, this.grassCenter);
    this.terrain.grass.setNear(reach < GRASS_MAX_VIEW_DISTANCE);
    // The weather's cover: at most four times a second, and only when something changed
    this.coverAge += dtSeconds;
    if (this.coverDirty && this.coverAge > 0.25) void this.refreshCover();
    this.cover.setFrame(this.group.position.x, this.group.position.z);
    // The shadow map renders only after a change: objects moved or switched level, the ground changed
    const shadowVersion = this.objects.version + this.terrain.chunks.version;
    if (shadowVersion !== this.shadowVersion) {
      this.shadowVersion = shadowVersion;
      this.environment.invalidateShadows();
    }
    this.environment.update(dtSeconds, camera, this.worldFocus);
    this.environment.matchFog(this.camPos, this.focusPoint);
    this.environment.setFogMap(this.group.position.x, this.group.position.z, this.doc.terrain.width / 2, this.doc.terrain.depth / 2);
  }

  /** Heights changed inside `rect` (map metres); whole map when omitted. Objects and water follow. */
  updateHeights(rect?: MapRect): void {
    this.terrain.rebuild(rect ? this.gridRect(rect) : undefined);
    this.objects.refreshHeights(rect);
    this.coverDirty = true;
    // Water and bridges only when the change reaches them: a brush on a big map must stay cheap
    if (!rect) this.updateWater();
    else this.refreshWaterNear(rect);
    if (!rect || this.bridgeNear(rect)) void this.refreshBridges();
    this.environment.invalidateShadows();
  }

  private async refreshBridges(): Promise<void> {
    await this.bridges.set(this.doc.paths, this.doc.terrain);
    this.environment.invalidateShadows();
  }

  /** Whether a water body's mask or a river comes within a few metres of a rectangle */
  /**
   * Heights changed in `rect`: only the water bodies whose mask reaches it
   * rebuild their surface (which cells it covers, its depth per vertex),
   * the apron's sea floor only when the change touches the border. Rivers
   * keep theirs: a ribbon follows its line, the depth comes from the
   * height texture per pixel.
   */
  private refreshWaterNear(rect: MapRect): void {
    const t = this.doc.terrain;
    const f = this.heights;
    const g = this.gridRect({ minX: rect.minX - 4, minY: rect.minY - 4, maxX: rect.maxX + 4, maxY: rect.maxY + 4 });
    const near = (mask: Uint8Array): boolean => {
      for (let j = Math.max(0, g.j0); j <= Math.min(f.rows - 1, g.j1); j++) {
        for (let i = Math.max(0, g.i0); i <= Math.min(f.columns - 1, g.i1); i++) {
          if (mask[j * f.columns + i]) return true;
        }
      }
      return false;
    };
    const border = g.i0 <= 0 || g.j0 <= 0 || g.i1 >= f.columns - 1 || g.j1 >= f.rows - 1;
    let lava = false;
    [t.water, ...(t.waterBodies ?? [])].forEach((body, k) => {
      const surface = this.waters[k];
      if (!body || !surface || !near(body.mask)) return;
      if (k === 0 && border) this.terrain.refreshWater();
      surface.set(body, k === 0 ? this.terrain.apronProfile : null);
      lava ||= body.kind === 'lava';
      this.coverDirty = true;
    });
    if (lava) this.effects.setLavaLights(this.lavaLightPoints());
  }

  private bridgeNear(rect: MapRect): boolean {
    const nodes = new Map(this.doc.paths.nodes.map((n) => [n.id, n]));
    return this.doc.paths.edges.some((e) => {
      if (e.kind !== 'bridge') return false;
      return [nodes.get(e.a), nodes.get(e.b), ...(e.via ?? [])].some(
        (p) => p && p.x > rect.minX - 20 && p.x < rect.maxX + 20 && p.y > rect.minY - 20 && p.y < rect.maxY + 20,
      );
    });
  }

  /** First placed object a scene-space ray hits (editor picking) */
  raycastObjects(ray: Ray): ObjectHit | null {
    return this.objects.raycast(ray);
  }

  /** The ground layers or the cliff material changed: reloads the terrain's materials */
  updateLayers(): Promise<void> {
    return this.terrain.load(this.assets, this.doc.paths, this.options.anisotropy ?? 8);
  }

  /** Splat weights changed inside `rect` */
  updateSplat(rect?: MapRect): void {
    if (!rect) {
      this.terrain.refreshSplat();
      return;
    }
    // Map metres to splat texels (texel (0, 0) at the south-west corner), one texel of margin
    const t = this.doc.terrain;
    const r = t.splat.resolution;
    this.terrain.refreshSplat({
      i0: Math.floor(((rect.minX + t.width / 2) / t.width) * r) - 1,
      j0: Math.floor(((rect.minY + t.depth / 2) / t.depth) * r) - 1,
      i1: Math.ceil(((rect.maxX + t.width / 2) / t.width) * r) + 1,
      j1: Math.ceil(((rect.maxY + t.depth / 2) / t.depth) * r) + 1,
    });
  }

  /**
   * Water changed: level, mask, colour or kind of the main body or of the
   * further bodies (`terrain.waterBodies`), the rivers, or heights under them
   */
  /**
   * Water changed. With `body` (0 the main water, 1.. the `waterBodies`) only
   * that body's surface is rebuilt, the objects floating in `rect` (map
   * metres) follow, and lava lights only when lava is involved: a pool brush
   * painting one mask stays cheap. Without, everything: all bodies, rivers,
   * river banks, the apron.
   */
  updateWater(rect?: MapRect, body?: number): void {
    if (body !== undefined && body > 0 && this.waters.length === 1 + (this.doc.terrain.waterBodies?.length ?? 0)) {
      this.updateWaterBody(body, rect);
      return;
    }
    this.terrain.refreshWater(this.doc.paths);
    // Rain stops and grass ends at the new surfaces
    this.coverDirty = true;
    const bodies = [this.doc.terrain.water, ...(this.doc.terrain.waterBodies ?? [])];
    // Slot 0 is the main body (it may be null); further bodies follow
    while (this.waters.length > bodies.length) this.waters.pop()?.dispose();
    bodies.forEach((body, k) => {
      const surface = this.waters[k] ?? null;
      if (!body) {
        surface?.dispose();
        this.waters[k] = null;
        return;
      }
      const apron = k === 0 ? this.terrain.apronProfile : null;
      if (surface) {
        surface.set(body, apron);
      } else {
        const created = new WaterSurface(this.heights, this.terrain.heightTexture, body, apron);
        this.waters[k] = created;
        this.group.add(created.mesh);
      }
    });
    // Rivers: rebuilt from their lines each time (cheap: a ribbon per river)
    for (const r of this.rivers) r.dispose();
    this.rivers = (this.doc.terrain.rivers ?? [])
      .filter((r) => r.points.length >= 2)
      .map((r) => new RiverSurface(this.heights, this.terrain.heightTexture, r));
    for (const r of this.rivers) this.group.add(r.mesh);
    // The constructor sets up the water before the effects exist and lights the lava after
    if (this.effects) this.effects.setLavaLights(this.lavaLightPoints());
    // Floating objects follow the water, bridge decks clear the water they cross
    if (this.objects) this.objects.refreshHeights(undefined, true);
    if (this.bridges) void this.refreshBridges();
    this.lightWater();
  }

  private updateWaterBody(k: number, rect?: MapRect): void {
    const water = this.doc.terrain.waterBodies?.[k - 1];
    const surface = this.waters[k];
    if (!water || !surface) {
      this.updateWater();
      return;
    }
    const wasLava = surface.kind === 'lava';
    surface.set(water, null);
    this.coverDirty = true;
    if (wasLava || water.kind === 'lava') this.effects.setLavaLights(this.lavaLightPoints());
    this.objects.refreshHeights(rect, true);
    if (!rect || this.bridgeNear(rect)) void this.refreshBridges();
    this.lightWater();
  }

  /** Replaces the placed objects (also `doc.objects`); resolves when their models are in */
  setObjects(objects: MapObject[]): Promise<void> {
    this.doc.objects = objects;
    return Promise.all([this.objects.setObjects(objects), this.refreshEffects(), this.refreshContact()]).then(
      () => undefined,
    );
  }

  /** One object moved, turned, scaled or changed asset (already changed in `doc.objects`) */
  /**
   * Objects added to `doc.objects` by the caller: only the object cells
   * (192 m) they land in are rebuilt, and the contact shadows around them.
   * Resolves when they show.
   */
  async addObjects(objects: MapObject[]): Promise<void> {
    if (!objects.length) return;
    const shown = this.objects.addObjects(objects);
    void this.refreshContact(objects);
    if (await this.hasEffects(objects)) void this.refreshEffects();
    await shown;
  }

  /** Objects removed from `doc.objects` by the caller (pass them, not only their ids: their spots clear) */
  removeObjects(objects: MapObject[]): void {
    if (!objects.length) return;
    this.objects.removeObjects(objects.map((o) => o.id));
    void this.refreshContact(objects);
    void this.hasEffects(objects).then((has) => (has ? this.refreshEffects() : undefined));
  }

  updateObject(object: MapObject): void {
    if (!this.objects.updateObject(object)) void this.objects.setObjects(this.doc.objects);
    void this.refreshEffects(object.asset);
    void this.refreshContact();
  }

  updatePaths(): void {
    this.terrain.refreshPaths(this.doc.paths);
    void this.refreshBridges();
  }

  setEnvironment(env: MapEnvironment): void {
    this.doc.environment = env;
    this.environment.set(env);
    this.lightWater();
    this.effects.setDarkness(this.environment.darkness);
  }

  /** Where glowing lava lights its surroundings: one point per 40 m patch of a lava body, every 30 m along lava flows */
  private lavaLightPoints(): Vector3[] {
    const t = this.doc.terrain;
    const f = this.heights;
    const out: Vector3[] = [];
    const patch = 40;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (!body || body.kind !== 'lava') continue;
      const cells = new Map<number, { x: number; y: number; n: number }>();
      for (let j = 0; j < f.rows; j += 2) {
        for (let i = 0; i < f.columns; i += 2) {
          if (!body.mask[j * f.columns + i] || f.sample(i, j) > body.level) continue;
          const x = f.originX + i * f.cellSize;
          const y = f.originY + j * f.cellSize;
          const key = Math.floor(x / patch) * 4096 + Math.floor(y / patch);
          const c = cells.get(key) ?? { x: 0, y: 0, n: 0 };
          c.x += x;
          c.y += y;
          c.n++;
          cells.set(key, c);
        }
      }
      for (const c of cells.values()) out.push(mapToScene(c.x / c.n, c.y / c.n, body.level + 5, new Vector3()));
    }
    for (const r of t.rivers ?? []) {
      if (r.kind !== 'lava') continue;
      let walked = 30;
      for (let k = 0; k < r.points.length - 1; k++) {
        const a = r.points[k];
        const b = r.points[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (; walked < len; walked += 30) {
          const u = walked / len;
          out.push(mapToScene(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.height + (b.height - a.height) * u + 5, new Vector3()));
        }
        walked -= len;
      }
    }
    return out.slice(0, 256);
  }

  private async refreshCover(): Promise<void> {
    this.coverDirty = false;
    this.coverAge = 0;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    this.cover.set(this.doc.objects, new Map(catalog.objects.map((o) => [o.id, o])), this.doc.terrain);
  }

  /** Contact shadows of the objects in the baked ground occlusion */
  /** Contact shadows of the objects; with `changed` only around those */
  private async refreshContact(changed?: MapObject[]): Promise<void> {
    this.coverDirty = true;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const entries = new Map(catalog.objects.map((o) => [o.id, o]));
    let rect: MapRect | undefined;
    if (changed) {
      for (const o of changed) {
        const r = (entries.get(o.asset)?.footprint ?? 1) * (o.scale || 1) * 1.5 + 1;
        rect = rect
          ? { minX: Math.min(rect.minX, o.x - r), minY: Math.min(rect.minY, o.y - r), maxX: Math.max(rect.maxX, o.x + r), maxY: Math.max(rect.maxY, o.y + r) }
          : { minX: o.x - r, minY: o.y - r, maxX: o.x + r, maxY: o.y + r };
      }
    }
    this.terrain.occlusion.setObjects(this.doc.objects, entries, rect ? this.gridRect(rect) : undefined);
  }

  /** Whether any of the objects has effects or a light */
  private async hasEffects(objects: MapObject[]): Promise<boolean> {
    const catalog = await this.assets.catalog();
    const assets = new Set(objects.map((o) => o.asset));
    return catalog.objects.some((e) => assets.has(e.id) && (!!e.effects || !!e.light));
  }

  /** Rebuilds effects and lights; with an asset id only when that asset has any */
  private async refreshEffects(asset?: string): Promise<void> {
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    if (asset) {
      const e = catalog.objects.find((o) => o.id === asset);
      if (!e?.effects && !e?.light) return;
    }
    this.effects.set(this.doc.objects, catalog);
    this.effects.setDarkness(this.environment.darkness);
  }

  private lightWater(): void {
    const e = this.environment;
    for (const w of this.waters) w?.setSky(e.skyDome.uniforms, e.sun.intensity);
    for (const r of this.rivers) r.setSky(e.skyDome.uniforms, e.sun.intensity);
  }

  dispose(): void {
    this.disposed = true;
    this.terrain.dispose();
    for (const w of this.waters) w?.dispose();
    for (const r of this.rivers) r.dispose();
    this.effects.dispose();
    this.cover.dispose();
    this.objects.dispose();
    this.bridges.dispose();
    this.environment.dispose();
    this.group.removeFromParent();
    this.losBlockers.removeFromParent();
    this.group.clear();
  }

  /** Grid samples covering a map rectangle, one sample of margin */
  private gridRect(rect: MapRect): GridRect {
    const f = this.heights;
    return {
      i0: Math.floor((rect.minX - f.originX) / f.cellSize) - 1,
      j0: Math.floor((rect.minY - f.originY) / f.cellSize) - 1,
      i1: Math.ceil((rect.maxX - f.originX) / f.cellSize) + 1,
      j1: Math.ceil((rect.maxY - f.originY) / f.cellSize) + 1,
    };
  }

  private async load(): Promise<void> {
    await Promise.all([
      this.terrain.load(this.assets, this.doc.paths, this.options.anisotropy ?? 8),
      this.objects.setObjects(this.doc.objects),
      this.refreshEffects(),
      this.refreshContact(),
      this.bridges.set(this.doc.paths, this.doc.terrain),
    ]);
  }
}

/** The low ground of a map for the height fog: the water level, or near the lowest heights */
function lowGround(heights: Float32Array, waterLevel: number | undefined): number {
  if (waterLevel !== undefined) return waterLevel;
  const sorted = Float32Array.from(heights).sort();
  return sorted[Math.floor(sorted.length * 0.05)] ?? 0;
}
