import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import type { MapMass, MapObject } from '../../map-document';
import { massDistance, massOf, massRadius } from '../../object-mass';
import { toModel } from '../../object-ground';
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import { drainage, lavaCloseness, shapeReach, shapeRows, type GroundBaker, type SampleRect, type ShapePatch } from './ground-shape';
import { uploadRect } from './texture-ranges';

/**
 * The ground's shape baked onto the height grid, four bytes per sample
 * (RGBA, linearly filtered), all read with the one texture fetch the
 * terrain shader already made:
 *
 * - R, occlusion: how much of the sky the slopes around a sample hide
 *   (horizon angles in eight directions out to 32 m), so hollows, gullies
 *   and the foot of slopes and cliffs darken; times a soft dark spot under
 *   trees, rocks and buildings (contact shadow). The shader multiplies its
 *   ambient light by it (and the direct light a little).
 * - G, curvature: the height against the mean of rings at 4 and 12 m
 *   around it, 0.5 flat, above on crests and knolls, below in hollows and
 *   channels (about +-4 m of difference over the range)
 * - B, drainage: how much ground drains through a sample (D8 flow
 *   accumulation, log scale): runnels and valley floors light up. Baked for
 *   the whole grid on a full update; a brush leaves it until the next one
 * - A, lava: closeness to lava, 1 on it, 0 from 12 m (`setLava`)
 *
 * The numbers come from ground-shape.ts, worked out in place, or by a
 * `baker` off the page's thread (the editor's worker, the game's
 * GroundWorker) whose results come back as patches (`applyShape`,
 * `setLavaCloseness`). Given one from the start, the first bake runs there
 * too; until it is in (`settled`) the ground draws open, without occlusion.
 */

/** Queued occlusion waits until the heights rest this long … */
const OCCLUSION_QUIET_MS = 120;
/** … or at most this long */
const OCCLUSION_WAIT_MS = 500;

const OBJECT_DARKNESS: Partial<Record<CatalogObject['category'], number>> = {
  tree: 0.4,
  building: 0.55,
  structure: 0.4,
  wall: 0.35,
  rock: 0.35,
  plant: 0.15,
  prop: 0.2,
};
/** Metres off its walls a raised building darkens the ground (a model darkens its footprint's disc and half again) */
const WALL_SHADE = 4;

export class GroundOcclusion {
  readonly texture: DataTexture;
  private readonly terrain: Float32Array;
  private readonly objects: Float32Array;
  private readonly pixels: Uint8Array;
  /** Samples whose terrain occlusion waits (horizon reach included), and the next row to do */
  private pending: { i0: number; j0: number; i1: number; j1: number; row: number; since: number; last: number } | null = null;
  /** Curvature, drainage and lava as the texture's bytes (ground-shape.ts works them out so) */
  private readonly curvature: Uint8Array;
  private drainage: Uint8Array;
  private readonly lava: Uint8Array;
  /** A baker's job under way: what is asked meanwhile waits for it, gathered (null: all) */
  private baking = false;
  private waiting: SampleRect | null | undefined = undefined;
  /** A whole shape (with the drainage) is in */
  private shaped = false;
  /** Resolves once no baker's job is under way or waiting (settled) */
  private idle: Promise<void> = Promise.resolve();
  private toIdle: (() => void) | null = null;

  constructor(
    private readonly field: HeightField,
    /** Works the shape out off the page's thread; null: in place, a few milliseconds a frame */
    public baker: GroundBaker | null = null,
  ) {
    const n = field.columns * field.rows;
    this.terrain = new Float32Array(n).fill(1);
    this.objects = new Float32Array(n).fill(1);
    this.curvature = new Uint8Array(n).fill(128);
    this.drainage = new Uint8Array(n);
    this.lava = new Uint8Array(n);
    this.pixels = new Uint8Array(n * 4).fill(255);
    this.texture = new DataTexture(this.pixels, field.columns, field.rows, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.updateTerrain();
  }

  /** Every shape asked of the baker so far is in (at once without one) */
  get settled(): Promise<void> {
    return this.idle;
  }

  /** Terrain occlusion of the samples in a rectangle (whole grid when omitted), plus the reach of the horizon search */
  updateTerrain(rect?: SampleRect): void {
    if (this.baker) this.bake(rect ?? null);
    else this.inPlace(rect);
  }

  private inPlace(rect?: SampleRect): void {
    const r = shapeReach(this.field, rect);
    if (!rect) this.drainage = drainage(this.field);
    this.terrainRows(r.i0, r.i1, r.j0, r.j1);
    if (!rect) this.shaped = true;
  }

  /**
   * Like updateTerrain, but later: a held brush changes heights every frame,
   * and the horizon search over its rectangle cost a 2 m map some 5 ms each
   * time. The rectangles gather while the changes go on (OCCLUSION_QUIET_MS
   * without one, at most OCCLUSION_WAIT_MS), then `flush` works them off in
   * slices of rows: a stroke costs the search over its area a few times, not
   * once a frame.
   */
  queueTerrain(rect: SampleRect, now = performance.now()): void {
    const r = shapeReach(this.field, rect);
    const p = this.pending;
    this.pending = p
      ? { i0: Math.min(p.i0, r.i0), j0: Math.min(p.row, r.j0), i1: Math.max(p.i1, r.i1), j1: Math.max(p.j1, r.j1), row: Math.min(p.row, r.j0), since: p.since, last: now }
      : { ...r, row: r.j0, since: now, last: now };
  }

  /** Works off queued occlusion for about `budgetMs` once the changes paused; true while some is left */
  flush(budgetMs: number, now = performance.now()): boolean {
    const p = this.pending;
    if (!p) return false;
    if (now - p.last < OCCLUSION_QUIET_MS && now - p.since < OCCLUSION_WAIT_MS) return true;
    if (this.baker) {
      // The whole of it to the baker, once its last job is back
      if (this.baking) return true;
      this.pending = null;
      this.bake({ i0: p.i0, j0: p.row, i1: p.i1, j1: p.j1 }, true);
      return false;
    }
    const until = now + budgetMs;
    // A band of rows at a time: the clock is read once a band
    const band = Math.max(1, Math.floor(1024 / (p.i1 - p.i0 + 1)));
    while (p.row <= p.j1) {
      const end = Math.min(p.j1, p.row + band - 1);
      this.terrainRows(p.i0, p.i1, p.row, end);
      p.row = end + 1;
      if (performance.now() > until) break;
    }
    if (p.row > p.j1) this.pending = null;
    // Under a held brush one slice per wait, the rest once it rests
    else p.since = now;
    return !!this.pending;
  }

  /** Occlusion and curvature of rows j0..j1 in place (ground-shape.ts shapeRows), then their texels */
  private terrainRows(i0: number, i1: number, j0: number, j1: number): void {
    shapeRows(this.field, this.terrain, this.curvature, i0, i1, j0, j1);
    this.upload(i0, j0, i1, j1);
  }

  /**
   * A shape the baker works out: `reached` says the rectangle already holds the horizon search's reach. One job
   * at a time (each rectangle counts, none may take another's place); what is asked meanwhile goes next, gathered
   */
  private bake(rect: SampleRect | null, reached = false): void {
    const ask = rect && !reached ? shapeReach(this.field, rect) : rect;
    if (this.baking) {
      const w = this.waiting;
      this.waiting = w === undefined ? ask : w === null || ask === null ? null : { i0: Math.min(w.i0, ask.i0), j0: Math.min(w.j0, ask.j0), i1: Math.max(w.i1, ask.i1), j1: Math.max(w.j1, ask.j1) };
      return;
    }
    const baker = this.baker!;
    this.baking = true;
    if (!this.toIdle) this.idle = new Promise((resolve) => (this.toIdle = resolve));
    const next = (): void => {
      this.baking = false;
      const w = this.waiting;
      this.waiting = undefined;
      if (w !== undefined && this.baker === baker) this.bake(w, true);
      if (this.baking) return;
      this.toIdle?.();
      this.toIdle = null;
    };
    const first = (): void => {
      // The first whole shape did not come (no map open in the editor's worker yet): worked out here once
      if (ask === null && !this.shaped && this.baker === baker) this.inPlace();
      next();
    };
    void baker.shape(ask).then(
      (patch) => {
        if (!patch) return first();
        if (this.baker === baker) this.applyShape(patch);
        next();
      },
      first,
    );
  }

  /** Occlusion and curvature of a rectangle, and the drainage when it came along, as a baker worked them out */
  applyShape(p: ShapePatch): void {
    const f = this.field;
    if (p.columns !== f.columns || p.rows !== f.rows) return;
    const { i0, j0, i1, j1 } = p.rect;
    const w = i1 - i0 + 1;
    for (let j = j0; j <= j1; j++) {
      const from = (j - j0) * w;
      this.terrain.set(p.terrain.subarray(from, from + w), j * f.columns + i0);
      this.curvature.set(p.curvature.subarray(from, from + w), j * f.columns + i0);
    }
    if (p.drainage) this.drainage = p.drainage;
    if (p.drainage) this.shaped = true;
    if (p.drainage) this.upload(0, 0, f.columns - 1, f.rows - 1);
    else this.upload(i0, j0, i1, j1);
  }

  /**
   * Closeness to lava per sample: `lava` marks the samples under lava (1)
   * or not (0); 1 there, falling off to 0 at 12 m. Lights the ground from
   * below and turns it to cooled rock around flows and pools.
   */
  setLava(lava: Uint8Array): void {
    this.setLavaCloseness(lavaCloseness(lava, this.field));
  }

  /** The closeness to lava per sample as worked out (ground-shape.ts lavaCloseness); only its channel is written */
  setLavaCloseness(closeness: Uint8Array): void {
    if (closeness.length !== this.lava.length) return;
    this.lava.set(closeness);
    const px = this.pixels;
    for (let k = 0, q = 3; k < closeness.length; k++, q += 4) px[q] = closeness[k];
    uploadRect(this.texture, undefined);
  }

  /**
   * Contact shadows of the placed objects (replaces the previous ones). With
   * a sample rectangle only the samples in it are redone, from the objects
   * that reach into it: an object placed or removed costs its own spot.
   */
  setObjects(
    objects: MapObject[],
    entries: Map<string, CatalogObject>,
    rect?: { i0: number; j0: number; i1: number; j1: number },
  ): void {
    const f = this.field;
    const i0 = Math.max(0, rect?.i0 ?? 0);
    const j0 = Math.max(0, rect?.j0 ?? 0);
    const i1 = Math.min(f.columns - 1, rect?.i1 ?? f.columns - 1);
    const j1 = Math.min(f.rows - 1, rect?.j1 ?? f.rows - 1);
    if (i0 > i1 || j0 > j1) return;
    if (rect) {
      for (let j = j0; j <= j1; j++) this.objects.fill(1, j * f.columns + i0, j * f.columns + i1 + 1);
    } else {
      this.objects.fill(1);
    }
    // With a rectangle, objects far from it are passed over before their catalogue entry is looked up
    let reach = 0;
    if (rect) for (const e of entries.values()) reach = Math.max(reach, e.footprint * 1.5);
    const minX = f.originX + i0 * f.cellSize;
    const maxX = f.originX + i1 * f.cellSize;
    const minY = f.originY + j0 * f.cellSize;
    const maxY = f.originY + j1 * f.cellSize;
    for (const o of objects) {
      const mass = massOf(o);
      if (rect) {
        const r = (mass ? massRadius(mass) + WALL_SHADE : reach) * (o.scale || 1);
        if (o.x + r < minX || o.x - r > maxX || o.y + r < minY || o.y - r > maxY) continue;
      }
      const e = entries.get(o.asset);
      const dark = e ? OBJECT_DARKNESS[e.category] : undefined;
      if (!e || !dark || e.footprint <= 0) continue;
      if (mass) {
        this.shadeMass(o, mass, dark, i0, j0, i1, j1);
        continue;
      }
      const r = e.footprint * (o.scale || 1) * 1.5;
      const ci = (o.x - f.originX) / f.cellSize;
      const cj = (o.y - f.originY) / f.cellSize;
      const rc = r / f.cellSize;
      for (let j = Math.max(j0, Math.floor(cj - rc)); j <= Math.min(j1, Math.ceil(cj + rc)); j++) {
        for (let i = Math.max(i0, Math.floor(ci - rc)); i <= Math.min(i1, Math.ceil(ci + rc)); i++) {
          const d = Math.hypot(i - ci, j - cj) / rc;
          if (d >= 1) continue;
          const t = 1 - d;
          const k = j * f.columns + i;
          this.objects[k] *= 1 - dark * t * t * (3 - 2 * t);
        }
      }
    }
    this.upload(i0, j0, i1, j1);
  }

  /** The ground round a raised building (object-mass.ts) darkens within WALL_SHADE of its walls, as round a model */
  private shadeMass(o: MapObject, mass: MapMass, dark: number, i0: number, j0: number, i1: number, j1: number): void {
    const f = this.field;
    const s = o.scale || 1;
    const r = massRadius(mass) * s + WALL_SHADE;
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    const ci = (o.x - f.originX) / f.cellSize;
    const cj = (o.y - f.originY) / f.cellSize;
    const rc = r / f.cellSize;
    for (let j = Math.max(j0, Math.floor(cj - rc)); j <= Math.min(j1, Math.ceil(cj + rc)); j++) {
      for (let i = Math.max(i0, Math.floor(ci - rc)); i <= Math.min(i1, Math.ceil(ci + rc)); i++) {
        const m = toModel(f.originX + i * f.cellSize - o.x, f.originY + j * f.cellSize - o.y, cos, sin);
        const d = (massDistance(mass, m.x / s, m.z / s) * s) / WALL_SHADE;
        if (d >= 1) continue;
        const t = 1 - d;
        const k = j * f.columns + i;
        this.objects[k] *= 1 - dark * t * t * (3 - 2 * t);
      }
    }
  }

  /** Occlusion at sample (i, j), 0 dark to 1 open */
  at(i: number, j: number): number {
    return this.pixels[(j * this.field.columns + i) * 4] / 255;
  }

  /** Curvature, drainage and lava at sample (i, j), 0..1 as baked (curvature 0.5 flat) */
  shapeAt(i: number, j: number): { curvature: number; drainage: number; lava: number } {
    const q = (j * this.field.columns + i) * 4;
    return { curvature: this.pixels[q + 1] / 255, drainage: this.pixels[q + 2] / 255, lava: this.pixels[q + 3] / 255 };
  }

  dispose(): void {
    this.texture.dispose();
  }

  private upload(i0: number, j0: number, i1: number, j1: number): void {
    const cols = this.field.columns;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        const q = k * 4;
        this.pixels[q] = Math.round(Math.max(0, Math.min(1, this.terrain[k] * this.objects[k])) * 255);
        this.pixels[q + 1] = this.curvature[k];
        this.pixels[q + 2] = this.drainage[k];
        this.pixels[q + 3] = this.lava[k];
      }
    }
    const whole = i0 === 0 && j0 === 0 && i1 === cols - 1 && j1 === this.field.rows - 1;
    uploadRect(this.texture, whole ? undefined : { i0, j0, i1, j1 });
  }
}
