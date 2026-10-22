import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  type ShaderMaterial,
} from 'three';
import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { APRON_RINGS, RIVER_REACH, type ApronProfile } from '../terrain/terrain-apron';
import type { GridRect } from '../terrain/terrain-chunks';
import { uploadRect } from '../terrain/texture-ranges';
import { createWaterMaterial, setWaterColor, setWaterEffects, setWaterFlow, setWaterMask, setWaterMirrored, setWaterSky } from './water-material';
import type { WaterReflection } from './water-reflection';
import type { MapEffects } from '../map-effects';
import type { SceneCopy } from './scene-copy';
import { setHeatHaze } from './heat-haze';
import { WallStrip } from './water-walls';
import { bakeFlow, bakeFlowOffThread, flowInputIn, SHORE_FIELD_MAX } from './flow-map';
import { bakeShoreCut, bakeShoreCutOffThread, pasteShoreCut, SHORE_CUT_RADIUS, shoreCutInput } from './shore-cut';

/**
 * One area body of a map (water, sea, swamp, ice or lava over a mask): a
 * flat surface at `level` over the mask grown by two cells. The material
 * cuts it where the terrain rises above the level (smooth shoreline,
 * water-material.ts) and fades it out by the mask, so cell-sized masks do
 * not show as steps. Along steep banks the shore cut (shore-cut.ts, beside
 * the mask in one texture) ends it on a smooth line just inside the wall.
 *
 * Only the main body runs on beyond the map's border (pass the apron).
 * Not a line-of-sight blocker (`userData.losTransparent`).
 *
 * The surface is cut into tiles of TILE cells a side, one mesh each with
 * the same material, plus one for the part beyond the border: a brush on the
 * mask rebuilds only the tiles it reaches (`set` with a rectangle), not the
 * whole map's surface.
 */
const TILE = 64;

/**
 * Metres past a body's samples its mask and current reach (window): the
 * shore cut's band, the shore field the surf reads (the material looks 25 m
 * outward) and a little more
 */
const WINDOW_MARGIN_M = SHORE_FIELD_MAX + 8;

export class WaterSurface {
  /** The tiles and the part beyond the border */
  readonly object = new Group();
  private material: ShaderMaterial;
  private readonly tiles = new Map<number, Mesh<BufferGeometry, ShaderMaterial>>();
  private apronMesh: Mesh<BufferGeometry, ShaderMaterial> | null = null;
  /**
   * The samples of the grid mask and current cover: the body's with a
   * margin (WINDOW_MARGIN_M), not the whole map (a pond on an OSM city's
   * grid carried 8.6 MB of both, a city has a dozen bodies). Grows when an
   * edit takes the water past it (fitWindow)
   */
  private window: GridRect;
  /** The mask (R) and the shore cut (G) per height sample of the window */
  private mask: DataTexture;
  /** The mask array the texture was last baked from (a new one, say after an undo, bakes all) */
  private maskSource: Uint8Array | null = null;
  /** The samples the mask sets (maskBounds, ungrown), worked out once per mask array and grown by its brushes */
  private bounds: GridRect | null = null;
  private boundsOf: Uint8Array | null = null;
  private maskLevel = Number.NaN;
  /** The whole bake in a worker the texture waits for; a newer one (or the end) leaves an older one's unused */
  private shoreJob = 0;
  private shorePending = false;
  /** The samples baked here since that bake's arrays were copied out: baked again over its result */
  private shoreSince: GridRect | null = null;
  /** Baked current of the body (flow-map.ts), on the mask's window */
  private flow: DataTexture;
  /** A later bake of the current (editing: a pool brush must not pay for the whole body each step) */
  private flowDue: ReturnType<typeof setTimeout> | null = null;
  private flowBaked = false;
  /** The bake whose flow the surface waits for; a newer one (or the end) leaves an older one's unused */
  private flowJob = 0;
  /** The last bakes of the current and of the shore cut started, in their workers (settled) */
  private flowBaking: Promise<void> = Promise.resolve();
  private shoreBaking: Promise<void> = Promise.resolve();
  /** What the surface shows now */
  kind: MapWater['kind'];
  private effects: { on: MapEffects; copy: SceneCopy; reflection: WaterReflection | null } | null = null;
  /** The surface's level (map frame), for the reflection's plane */
  level = 0;
  /** This body is the one the reflection mirrors */
  private mirrored = 0;
  private beforeRender: Mesh['onBeforeRender'] = () => undefined;
  /** The frame copy lava's heat shimmer reads, null when it is off (heat-haze.ts) */
  private hazeCopy: SceneCopy | null = null;

  constructor(
    private readonly field: HeightField,
    private readonly heights: HeightTexture,
    water: MapWater,
    apron: ApronProfile | null,
    /** The map's main body: the terrain wets its banks itself, the water draws no wet film of its own */
    private readonly main = false,
  ) {
    this.kind = water.kind ?? 'water';
    this.window = this.windowAround(maskBounds(water.mask, field.columns, field.rows, 0), 1);
    [this.mask, this.flow] = this.windowTextures();
    this.object.name = 'custom-map-water-body';
    this.object.matrixAutoUpdate = false;
    this.material = this.makeMaterial(water);
    this.set(water, apron);
  }

  /**
   * Rebuilds the surface for changed water or heights; with `rect` (height
   * samples) only the tiles it reaches and that part of the mask, and the
   * part beyond the border only when `apron` is given
   */
  set(water: MapWater, apron: ApronProfile | null, rect?: GridRect): void {
    const kind = water.kind ?? 'water';
    if (kind !== this.kind) {
      const sky = this.material.uniforms;
      const old = this.material;
      // The haze reads the old material's clock: built again with the new one (setEffects below)
      for (const m of this.meshes()) setHeatHaze(m, null);
      this.kind = kind;
      this.material = this.makeMaterial(water);
      // Keep the sky and light the old material had
      for (const key of ['uZenith', 'uHorizon', 'uSunDir', 'uSunColor', 'uGlowColor', 'uCloudColor', 'uCloudShadow', 'uCover', 'uGlow', 'uSkyTime', 'uCloudOffset', 'uSkyTex', 'uLight']) {
        if (sky[key]) this.material.uniforms[key] = sky[key];
      }
      old.dispose();
      for (const m of this.meshes()) m.material = this.material;
      if (this.effects) this.setEffects(this.effects.on, this.effects.copy, this.effects.reflection);
      setWaterMirrored(this.material, this.mirrored);
    }
    setWaterColor(this.material, kind, water.color);
    this.level = water.level;
    const f = this.field;
    const bounds = this.waterBounds(water, rect);
    this.fitWindow(bounds);
    // A tile's cells reach two samples past the mask (the grown mask) and one for their far corner; a whole
    // rebuild only where the mask has water, the tiles beyond go
    const reach = rect ?? bounds;
    const r = reach && { i0: Math.max(0, reach.i0 - 3), j0: Math.max(0, reach.j0 - 3), i1: Math.min(f.columns - 2, reach.i1 + 2), j1: Math.min(f.rows - 2, reach.j1 + 2) };
    if (!rect) this.dropTilesBeyond(r);
    this.bakeMask(water, rect);
    // Ice stands still. The current runs over the whole body, in a worker (tens of ms to a second on a big
    // body): the first bake right away, edits (a mask or height brush) once they pause for a quarter second
    if (kind !== 'ice') {
      if (this.flowDue) clearTimeout(this.flowDue);
      this.flowDue = null;
      if (this.flowBaked) {
        this.flowDue = setTimeout(() => {
          this.flowDue = null;
          this.bakeFlow(water);
        }, 250);
      } else {
        this.flowBaked = true;
        this.bakeFlow(water);
      }
    }
    if (r) {
      for (let tj = Math.floor(r.j0 / TILE); tj <= Math.floor(r.j1 / TILE); tj++) {
        for (let ti = Math.floor(r.i0 / TILE); ti <= Math.floor(r.i1 / TILE); ti++) this.buildTile(water, ti, tj);
      }
    }
    if (apron || !rect) this.buildApron(water, apron);
  }

  /**
   * The samples the mask sets: anew for a new mask array or a whole rebuild (the mask may have changed in place),
   * grown by a brush's rectangle (a brush that takes water away leaves them larger, which only costs a look)
   */
  private waterBounds(water: MapWater, rect?: GridRect): GridRect | null {
    const f = this.field;
    if (!rect || water.mask !== this.boundsOf) {
      this.bounds = maskBounds(water.mask, f.columns, f.rows, 0);
      this.boundsOf = water.mask;
    } else {
      const r = { i0: Math.max(0, rect.i0), j0: Math.max(0, rect.j0), i1: Math.min(f.columns - 1, rect.i1), j1: Math.min(f.rows - 1, rect.j1) };
      this.bounds = this.bounds ? unionRect(this.bounds, r) : r;
    }
    return this.bounds;
  }

  /** The window of `bounds` grown by `margins` times WINDOW_MARGIN_M, within the grid; a sample without bounds */
  private windowAround(bounds: GridRect | null, margins: number): GridRect {
    const f = this.field;
    if (!bounds) return { i0: 0, j0: 0, i1: 0, j1: 0 };
    const m = Math.ceil((WINDOW_MARGIN_M * margins) / f.cellSize) + SHORE_CUT_RADIUS;
    return { i0: Math.max(0, bounds.i0 - m), j0: Math.max(0, bounds.j0 - m), i1: Math.min(f.columns - 1, bounds.i1 + m), j1: Math.min(f.rows - 1, bounds.j1 + m) };
  }

  /** Mask and current of the window, the current still far from a shore until the first bake is in (bakeFlow) */
  private windowTextures(): [DataTexture, DataTexture] {
    const w = this.window.i1 - this.window.i0 + 1;
    const h = this.window.j1 - this.window.j0 + 1;
    const mask = new DataTexture(new Uint8Array(w * h * 2), w, h, RGFormat, UnsignedByteType);
    const still = new Uint8Array(w * h * 4);
    for (let k = 0; k < still.length; k += 4) {
      still[k] = still[k + 1] = 128;
      still[k + 2] = 255;
    }
    const flow = new DataTexture(still, w, h, RGBAFormat, UnsignedByteType);
    for (const t of [mask, flow]) {
      t.colorSpace = NoColorSpace;
      t.magFilter = t.minFilter = LinearFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.unpackAlignment = 1;
    }
    return [mask, flow];
  }

  /**
   * An edit took the water past the window (its margin no longer around it): a larger one, with room for more
   * brushes, its mask and current baked whole again
   */
  private fitWindow(bounds: GridRect | null): void {
    const need = this.windowAround(bounds, 1);
    const w = this.window;
    if (!bounds || (need.i0 >= w.i0 && need.j0 >= w.j0 && need.i1 <= w.i1 && need.j1 <= w.j1)) return;
    this.window = this.windowAround(bounds, 2);
    this.mask.dispose();
    this.flow.dispose();
    [this.mask, this.flow] = this.windowTextures();
    this.setWindowUniforms(this.material);
    this.maskSource = null;
    this.flowBaked = false;
  }

  /** The window's textures in the material, map metres to their texel centres */
  private setWindowUniforms(m: ShaderMaterial): void {
    const f = this.field;
    const w = this.window.i1 - this.window.i0 + 1;
    const h = this.window.j1 - this.window.j0 + 1;
    const sx = 1 / (f.cellSize * w);
    const sy = 1 / (f.cellSize * h);
    const x0 = f.originX + this.window.i0 * f.cellSize;
    const y0 = f.originY + this.window.j0 * f.cellSize;
    setWaterMask(m, this.mask, new Vector4(sx, sy, -x0 * sx + 0.5 / w, -y0 * sy + 0.5 / h));
    setWaterFlow(m, this.kind === 'ice' ? null : this.flow);
  }

  /** `r` (grid samples) cut to the window, in the window's samples; null outside it */
  private local(r: GridRect): GridRect | null {
    const w = this.window;
    const i0 = Math.max(r.i0, w.i0) - w.i0;
    const j0 = Math.max(r.j0, w.j0) - w.j0;
    const i1 = Math.min(r.i1, w.i1) - w.i0;
    const j1 = Math.min(r.j1, w.j1) - w.j0;
    return i1 < i0 || j1 < j0 ? null : { i0, j0, i1, j1 };
  }

  /** `r` cut to the window, in grid samples */
  private clip(r: GridRect): GridRect | null {
    const l = this.local(r);
    return l && { i0: l.i0 + this.window.i0, j0: l.j0 + this.window.j0, i1: l.i1 + this.window.i0, j1: l.j1 + this.window.j0 };
  }

  /** The tile meshes outside `r` (cells) go: no water there any more; all of them without one */
  private dropTilesBeyond(r: GridRect | null): void {
    for (const [key, mesh] of this.tiles) {
      const ti = key % 4096;
      const tj = Math.floor(key / 4096);
      const inside = r && ti >= Math.floor(r.i0 / TILE) && ti <= Math.floor(r.i1 / TILE) && tj >= Math.floor(r.j0 / TILE) && tj <= Math.floor(r.j1 / TILE);
      if (inside) continue;
      setHeatHaze(mesh, null);
      mesh.geometry.dispose();
      mesh.removeFromParent();
      this.tiles.delete(key);
    }
  }

  /** The first bakes of the current and of the shore cut are in (the view's `ready` waits for them) */
  get settled(): Promise<void> {
    return Promise.all([this.flowBaking, this.shoreBaking]).then(() => undefined);
  }

  /** The current of the whole body in a worker; a newer bake takes its place. A failed worker: baked here */
  private bakeFlow(water: MapWater): void {
    const job = ++this.flowJob;
    const window = this.window;
    this.flowBaking = bakeFlowOffThread(flowInputIn(this.field, water, window)).then((flow) => {
      if (job !== this.flowJob || window !== this.window) return;
      this.flow.image.data = flow ?? bakeFlow(flowInputIn(this.field, water, window));
      this.flow.needsUpdate = true;
    });
  }

  /**
   * Mask and shore cut anew: over the whole grid for a new mask array, a new
   * level or no rectangle, in a worker (the first bake too; the texture
   * keeps the last cut until it is back, the first time none); else around
   * `rect` (the cut reaches a few samples past a change of heights), here.
   */
  private bakeMask(water: MapWater, rect?: GridRect): void {
    const f = this.field;
    const data = this.mask.image.data as Uint8Array;
    const whole = !rect || water.mask !== this.maskSource || water.level !== this.maskLevel;
    const grow = SHORE_CUT_RADIUS;
    this.maskSource = water.mask;
    this.maskLevel = water.level;
    if (whole) {
      this.bakeWholeOffThread(water);
      return;
    }
    const r = this.clip({ i0: rect.i0 - grow, j0: rect.j0 - grow, i1: rect.i1 + grow, j1: rect.j1 + grow });
    if (!r) return;
    bakeShoreCut(f.grid.heights, f.columns, f.rows, f.cellSize, water.level, water.mask, data, r, this.window);
    // A brush while a whole bake runs: its result misses this, baked again over it when it is back
    if (this.shorePending) this.shoreSince = this.shoreSince ? unionRect(this.shoreSince, r) : r;
    uploadRect(this.mask, this.local(r) ?? undefined);
  }

  /**
   * The whole bake of the body as it stands now, in a worker, only around the mask (no surface stands farther
   * out: a pool on a big map bakes its corner); a newer one takes its place
   */
  private bakeWholeOffThread(water: MapWater): void {
    const f = this.field;
    const job = ++this.shoreJob;
    this.shorePending = true;
    this.shoreSince = null;
    const b = this.bounds;
    const rect = b && this.clip({ i0: b.i0 - SHORE_CUT_RADIUS, j0: b.j0 - SHORE_CUT_RADIUS, i1: b.i1 + SHORE_CUT_RADIUS, j1: b.j1 + SHORE_CUT_RADIUS });
    if (!rect) {
      // No water: nothing to wait for
      this.shorePending = false;
      (this.mask.image.data as Uint8Array).fill(0);
      uploadRect(this.mask, undefined);
      return;
    }
    // Only the samples the bake reads go to the worker: a pool on a big map copies its corner, not the grid
    const { input, window } = shoreCutInput(f.grid.heights, f.columns, f.rows, f.cellSize, water.level, water.mask, rect);
    const into = this.window;
    this.shoreBaking = bakeShoreCutOffThread(input).then((cut) => {
      if (job !== this.shoreJob || into !== this.window) return;
      this.shorePending = false;
      const data = new Uint8Array((into.i1 - into.i0 + 1) * (into.j1 - into.j0 + 1) * 2);
      // The worker's samples reach past the window by its read margin: only those inside go in
      if (cut) pasteShoreCut(cut, window, data, into);
      // A failed worker: the bake here after all
      else bakeShoreCut(f.grid.heights, f.columns, f.rows, f.cellSize, water.level, water.mask, data, rect, into);
      const since = this.shoreSince && this.clip(this.shoreSince);
      this.shoreSince = null;
      if (since) bakeShoreCut(f.grid.heights, f.columns, f.rows, f.cellSize, water.level, water.mask, data, since, into);
      this.mask.image.data = data;
      uploadRect(this.mask, undefined);
    });
  }

  /** The tile and border meshes (all share the material) */
  meshes(): Mesh<BufferGeometry, ShaderMaterial>[] {
    return [...this.tiles.values(), ...(this.apronMesh ? [this.apronMesh] : [])];
  }

  /** How strongly this body shows the mirror of its level (0 none, 1 full; it fades, mirror-choice.ts) */
  setMirrored(weight: number): void {
    this.mirrored = weight;
    setWaterMirrored(this.material, weight);
  }

  /** Whether the reflection may mirror this body: water, sea or swamp */
  get reflective(): boolean {
    return this.kind === 'water' || this.kind === 'sea' || this.kind === 'swamp' || this.kind === undefined;
  }

  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number, darkness = 0): void {
    setWaterSky(this.material, skyUniforms, sunIntensity, darkness);
  }

  /** Switchable effects (refraction, sea waves); `copy` is the view's frame copy */
  setEffects(on: MapEffects, copy: SceneCopy, reflection: WaterReflection | null = null): void {
    this.effects = { on, copy, reflection };
    const { refraction, reflects } = setWaterEffects(this.material, this.kind ?? 'water', on, copy, reflection);
    // The mirror renders before the frame copy is taken: the copy is of the frame, not of the mirror
    this.beforeRender = (renderer, scene, camera) => {
      if (reflects && reflection) reflection.render(renderer, scene, camera, this);
      if (refraction) copy.capture(renderer);
    };
    for (const m of this.meshes()) m.onBeforeRender = this.beforeRender;
    // Lava's heat shimmer over every tile
    this.hazeCopy = on.lavaGlow && this.kind === 'lava' ? copy : null;
    for (const m of this.meshes()) setHeatHaze(m, this.hazeCopy);
  }

  update(dt: number): void {
    this.material.uniforms['uTime'].value += dt;
  }

  dispose(): void {
    this.flowJob++;
    this.shoreJob++;
    for (const m of this.meshes()) setHeatHaze(m, null);
    for (const m of this.meshes()) m.geometry.dispose();
    this.tiles.clear();
    this.apronMesh = null;
    this.material.dispose();
    if (this.flowDue) clearTimeout(this.flowDue);
    this.mask.dispose();
    this.flow.dispose();
    this.object.removeFromParent();
  }

  private makeMesh(geometry: BufferGeometry): Mesh<BufferGeometry, ShaderMaterial> {
    const mesh = new Mesh(geometry, this.material);
    mesh.name = 'custom-map-water';
    mesh.userData['losTransparent'] = true;
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    // Refraction copies the frame before the first tile draws (once a frame)
    mesh.onBeforeRender = this.beforeRender;
    if (this.hazeCopy) setHeatHaze(mesh, this.hazeCopy);
    mesh.matrixAutoUpdate = false;
    this.object.add(mesh);
    return mesh;
  }

  /** One tile's cells anew; a tile without water goes */
  private buildTile(water: MapWater, ti: number, tj: number): void {
    const key = tj * 4096 + ti;
    const old = this.tiles.get(key);
    const geometry = this.buildGeometry(water, ti * TILE, tj * TILE);
    if (old) {
      setHeatHaze(old, null);
      old.geometry.dispose();
      old.removeFromParent();
      this.tiles.delete(key);
    }
    if (!geometry) return;
    this.tiles.set(key, this.makeMesh(geometry));
  }

  private buildApron(water: MapWater, apron: ApronProfile | null): void {
    if (this.apronMesh) {
      setHeatHaze(this.apronMesh, null);
      this.apronMesh.geometry.dispose();
      this.apronMesh.removeFromParent();
      this.apronMesh = null;
    }
    const geometry = apron ? this.buildApronGeometry(water, apron) : null;
    if (geometry) this.apronMesh = this.makeMesh(geometry);
  }

  private makeMaterial(water: MapWater): ShaderMaterial {
    const f = this.field;
    const m = createWaterMaterial({
      kind: water.kind ?? 'water',
      river: false,
      heights: this.heights,
      color: water.color,
      mapHalf: new Vector2(((f.columns - 1) * f.cellSize) / 2, ((f.rows - 1) * f.cellSize) / 2),
    });
    this.setWindowUniforms(m);
    m.uniforms['uWetFilm'].value = this.main ? 0 : 1;
    return m;
  }

  /**
   * The cells of one tile (from cell (i0, j0), TILE a side) that hold water:
   * the mask grown by two samples, cells above the level at every corner
   * left out; null when none
   */
  private buildGeometry(water: MapWater, ci0: number, cj0: number): BufferGeometry | null {
    const f = this.field;
    const cols = f.columns;
    const rows = f.rows;
    const mask = water.mask;
    const ci1 = Math.min(cols - 2, ci0 + TILE - 1);
    const cj1 = Math.min(rows - 2, cj0 + TILE - 1);
    // The mask grown by two samples over the tile's samples: the material cuts the surface where the terrain is above it
    const sw = ci1 - ci0 + 2;
    const sh = cj1 - cj0 + 2;
    const grown = new Uint8Array(sw * sh);
    for (let j = Math.max(0, cj0 - 2); j <= Math.min(rows - 1, cj1 + 3); j++) {
      for (let i = Math.max(0, ci0 - 2); i <= Math.min(cols - 1, ci1 + 3); i++) {
        if (!mask[j * cols + i]) continue;
        for (let jj = Math.max(cj0, j - 2); jj <= Math.min(cj1 + 1, j + 2); jj++) {
          for (let ii = Math.max(ci0, i - 2); ii <= Math.min(ci1 + 1, i + 2); ii++) grown[(jj - cj0) * sw + ii - ci0] = 1;
        }
      }
    }
    const vertexOf = new Int32Array(sw * sh).fill(-1);
    const positions: number[] = [];
    const depths: number[] = [];
    const indices: number[] = [];
    const vertex = (i: number, j: number): number => {
      const k = (j - cj0) * sw + i - ci0;
      if (vertexOf[k] < 0) {
        vertexOf[k] = positions.length / 3;
        positions.push(-(f.originX + i * f.cellSize), water.level, f.originY + j * f.cellSize);
        depths.push(water.level - f.sample(i, j));
      }
      return vertexOf[k];
    };
    // The walls (water-walls.ts) along the mask's edge, where the surface fades out (half way between a wet and a
    // dry sample): only where the ground there lies below the level, the surface ending in the air
    const walls: number[] = [];
    const strip = new WallStrip((v) => {
      positions.push(-v.x, v.height, v.y);
      depths.push(0);
      walls[positions.length / 3 - 1] = v.top;
      return positions.length / 3 - 1;
    }, indices, LAKE_WALL);
    const wet = (i: number, j: number): boolean => mask[j * cols + i] > 127;
    const at = (i: number, j: number): [number, number] => [f.originX + i * f.cellSize, f.originY + j * f.cellSize];
    for (let j = cj0; j <= cj1; j++) {
      for (let i = ci0; i <= ci1; i++) {
        const corners: [number, number][] = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        const w = corners.map(([ci, cj]) => wet(ci, cj));
        const count = w.filter(Boolean).length;
        if (count === 0 || count === 4) continue;
        // The middles of the cell's sides that cross from wet to dry, in turn round the cell
        const cross: [number, number][] = [];
        for (let e = 0; e < 4; e++) {
          if (w[e] === w[(e + 1) % 4]) continue;
          const [ax, ay] = at(...corners[e]);
          const [bx, by] = at(...corners[(e + 1) % 4]);
          cross.push([(ax + bx) / 2, (ay + by) / 2]);
        }
        // Out: from the wet corners' middle to the dry ones'
        let ox = 0;
        let oy = 0;
        for (let e = 0; e < 4; e++) {
          const [x, y] = at(...corners[e]);
          ox += w[e] ? -x / count : x / (4 - count);
          oy += w[e] ? -y / count : y / (4 - count);
        }
        for (let q = 0; q + 1 < cross.length; q += 2) {
          const [ax, ay] = cross[q];
          const [bx, by] = cross[q + 1];
          strip.add(ax, ay, water.level, f.heightAt(ax, ay), bx, by, water.level, f.heightAt(bx, by), ox, oy);
        }
      }
    }
    for (let j = cj0; j <= cj1; j++) {
      for (let i = ci0; i <= ci1; i++) {
        const k = (j - cj0) * sw + i - ci0;
        if (!(grown[k] && grown[k + 1] && grown[k + sw] && grown[k + sw + 1])) continue;
        // Skip cells above the water at every corner (their planar triangles are above it everywhere)
        const lo = Math.min(f.sample(i, j), f.sample(i + 1, j), f.sample(i, j + 1), f.sample(i + 1, j + 1));
        if (lo > water.level) continue;
        const v00 = vertex(i, j);
        const v10 = vertex(i + 1, j);
        const v01 = vertex(i, j + 1);
        const v11 = vertex(i + 1, j + 1);
        indices.push(v00, v10, v11, v00, v11, v01);
      }
    }
    return indices.length ? this.geometryOf(positions, depths, indices, walls) : null;
  }

  /**
   * Water that reaches the border runs on beyond it over the apron's rings;
   * it ends where the apron's blurred bed rises above the level (negative
   * depth, discarded in the shader). Null when no water reaches the border
   */
  private buildApronGeometry(water: MapWater, p: ApronProfile): BufferGeometry | null {
    const f = this.field;
    const cols = f.columns;
    const mask = water.mask;
    const positions: number[] = [];
    const depths: number[] = [];
    const indices: number[] = [];
    // A river runs on a little way; a sea (a coast's stretch, or most of the border wet) to the horizon, over the
    // floor the apron sinks there (ApronProfile.seaAt): ended at the river's reach, the sea floor showed past it
    const riverRings = APRON_RINGS.filter((d) => d <= RIVER_REACH).length;
    const n = p.count;
    const wetBorder = (k: number): boolean => {
      const [x, y] = p.position(0, k);
      const i = Math.round((x - f.originX) / f.cellSize);
      const j = Math.round((y - f.originY) / f.cellSize);
      return mask[j * cols + i] > 0 && f.sample(i, j) < water.level;
    };
    const ringVertex = new Map<number, number>();
    const apronVertex = (r: number, k: number): number => {
      const key = r * n + (k % n);
      let v = ringVertex.get(key);
      if (v === undefined) {
        v = positions.length / 3;
        const [x, y] = p.position(r, k % n);
        positions.push(-x, water.level, y);
        depths.push(water.level - p.height(r, k % n));
        ringVertex.set(key, v);
      }
      return v;
    };
    for (let k = 0; k < n; k++) {
      if (p.wetShare <= 0.5 && (!wetBorder(k) || !wetBorder((k + 1) % n))) continue;
      const rings = p.seaAt(k) && p.seaAt(k + 1) ? APRON_RINGS.length : riverRings;
      for (let r = 0; r < rings - 1; r++) {
        const a = apronVertex(r, k);
        const b = apronVertex(r, k + 1);
        const c = apronVertex(r + 1, k);
        const e = apronVertex(r + 1, k + 1);
        // Both windings; the material draws one side
        indices.push(a, c, b, b, c, e, a, b, c, b, e, c);
      }
    }
    return indices.length ? this.geometryOf(positions, depths, indices) : null;
  }

  /** `walls`: per vertex the surface over it where it is a wall's (sparse) */
  private geometryOf(positions: number[], depths: number[], indices: number[], walls: readonly number[] = []): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1));
    const wall = new Float32Array(depths.length * 2);
    walls.forEach((top, k) => wall.set([1, top], k * 2));
    g.setAttribute('aWall', new BufferAttribute(wall, 2));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Metres a lake must stand over the ground at its mask's edge for a wall there: a step, a dam, not a shallow beach */
const LAKE_WALL = 0.5;

function unionRect(a: GridRect, b: GridRect): GridRect {
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

/**
 * The samples a mask sets, grown by `grow` and clamped to the grid; null when it is empty. The first and last
 * set sample are found four bytes at a time, then each row between only scans in from both ends: a pool on a
 * large map reads little more than the empty grid in words
 */
export function maskBounds(mask: Uint8Array, columns: number, rows: number, grow: number): GridRect | null {
  const n = columns * rows;
  let first = -1;
  let last = -1;
  const words = mask.byteOffset % 4 === 0 ? new Uint32Array(mask.buffer, mask.byteOffset, n >> 2) : null;
  const tail = words ? words.length * 4 : 0;
  if (words) {
    for (let w = 0; w < words.length && first < 0; w++) if (words[w]) for (let k = w * 4; k < w * 4 + 4; k++) if (mask[k]) { first = k; break; }
  }
  for (let k = tail; k < n && first < 0; k++) if (mask[k]) first = k;
  if (first < 0) return null;
  for (let k = n - 1; k >= tail && last < 0; k--) if (mask[k]) last = k;
  if (words) {
    for (let w = words.length - 1; w >= 0 && last < 0; w--) if (words[w]) for (let k = w * 4 + 3; k >= w * 4; k--) if (mask[k]) { last = k; break; }
  }
  const j0 = Math.floor(first / columns);
  const j1 = Math.floor(last / columns);
  let i0 = columns;
  let i1 = -1;
  for (let j = j0; j <= j1; j++) {
    const row = j * columns;
    for (let i = 0; i < i0; i++) if (mask[row + i]) { i0 = i; break; }
    for (let i = columns - 1; i > i1; i--) if (mask[row + i]) { i1 = i; break; }
  }
  return { i0: Math.max(0, i0 - grow), j0: Math.max(0, j0 - grow), i1: Math.min(columns - 1, i1 + grow), j1: Math.min(rows - 1, j1 + grow) };
}
