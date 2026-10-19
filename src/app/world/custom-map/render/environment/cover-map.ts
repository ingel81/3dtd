import { ClampToEdgeWrapping, DataTexture, FloatType, NearestFilter, NoColorSpace, RedFormat, UnsignedByteType, Vector2, Vector4 } from 'three';
import type { MapObject, MapTerrain } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { massContains, massDistance, massOf, massRadius, massTop } from '../../object-mass';
import { boxDistance, toModel } from '../../object-ground';
import type { HeightField } from '../height-field';
import { uploadRect, type TexelRect } from '../terrain/texture-ranges';

/** How far from a footprint the second channel measures, m (grass grows full from 1.5 m) */
export const COVER_RIM = 3;

/**
 * The top of everything rain and snow stop on, one value per height sample:
 * the terrain, raised to the roof height inside the footprint of buildings,
 * structures and rocks, and to the surface of water, lava and ice. Weather
 * particles below it are not drawn, so it does not rain indoors or through
 * the ground; grass grows only where the top is the ground itself. Coarse
 * by design (the grid's cells, a footprint circle per object, a raised
 * building's outline). A second texture (`rim`, a byte per sample) holds
 * how far the sample lies from the nearest ground of a building,
 * structure, standing wall or rock (its rectangle or outline where it has
 * one), up to COVER_RIM: grass grows shorter towards it. A byte is 1.2 cm
 * of it; in the top's float texture it held 5.8 MB more on an OSM world.
 */
export class CoverMap {
  readonly texture: DataTexture;
  /** Metres to the nearest footprint per sample, over COVER_RIM in 255 steps (normalised: 1 is COVER_RIM or more) */
  readonly rim: DataTexture;
  private readonly tops: Float32Array;
  /** Metres to the nearest footprint, per sample */
  private readonly rims: Float32Array;
  private readonly rimBytes: Uint8Array;
  /** The objects of the last set that cover or hold a rim, each with its entry (object, entry, ...) */
  private readonly found: (MapObject | CatalogObject)[] = [];
  /** Uniforms for a shader that includes COVER_GLSL; uCoverFrame xy is the map group's scene offset */
  readonly uniforms: {
    uCover: { value: DataTexture };
    uCoverGrid: { value: Vector4 };
    uCoverSize: { value: Vector2 };
    uCoverFrame: { value: Vector2 };
  };

  constructor(private readonly field: HeightField) {
    this.tops = new Float32Array(field.columns * field.rows);
    this.rims = new Float32Array(field.columns * field.rows);
    this.rimBytes = new Uint8Array(field.columns * field.rows);
    this.texture = new DataTexture(this.tops, field.columns, field.rows, RedFormat, FloatType);
    this.rim = new DataTexture(this.rimBytes, field.columns, field.rows, RedFormat, UnsignedByteType);
    for (const t of [this.rim]) {
      t.colorSpace = NoColorSpace;
      t.magFilter = t.minFilter = NearestFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
    }
    this.texture.colorSpace = NoColorSpace;
    this.texture.magFilter = this.texture.minFilter = NearestFilter;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.uniforms = {
      uCover: { value: this.texture },
      uCoverGrid: { value: new Vector4(field.originX, field.originY, field.cellSize, 0) },
      uCoverSize: { value: new Vector2(field.columns, field.rows) },
      uCoverFrame: { value: new Vector2() },
    };
    this.set([], new Map());
  }

  /**
   * Terrain heights plus the roofs of buildings, structures and rocks, and
   * the surfaces of water bodies and rivers. `bare`: samples where the fight
   * tore the ground up (a crater, a heap of rubble, custom-map-ground-damage.ts),
   * which grow no grass, as at a footprint. With `rect` (samples, inclusive)
   * (the heights changed there) only those samples are worked out and go
   * up, each as the whole map's would come out, and the whole roof of an
   * object standing on them (its top follows the ground under its middle):
   * a crater's few metres instead of every footprint of the map
   */
  set(objects: MapObject[], entries: Map<string, CatalogObject>, terrain?: MapTerrain, bare?: Uint8Array | null, rect?: TexelRect): void {
    const f = this.field;
    const w: TexelRect = rect
      ? { i0: Math.max(0, rect.i0), j0: Math.max(0, rect.j0), i1: Math.min(f.columns - 1, rect.i1), j1: Math.min(f.rows - 1, rect.j1) }
      : { i0: 0, j0: 0, i1: f.columns - 1, j1: f.rows - 1 };
    if (w.i1 < w.i0 || w.j1 < w.j0) return;
    // What stops rain or keeps grass short: buildings, structures and rocks, and standing walls (not a fence or a
    // hedge row) that let rain through
    const found = this.found;
    found.length = 0;
    for (const o of objects) {
      const e = entries.get(o.asset);
      if (!e) continue;
      if (e.category === 'building' || e.category === 'structure' || e.category === 'rock' || (e.category === 'wall' && e.height >= 1.5)) found.push(o, e);
    }
    if (rect) {
      const changed = { ...w };
      for (let n = 0; n < found.length; n += 2) {
        const o = found[n] as MapObject;
        const e = found[n + 1] as CatalogObject;
        if (e.category === 'wall') continue;
        const ci = (o.x - f.originX) / f.cellSize;
        const cj = (o.y - f.originY) / f.cellSize;
        // The samples its middle's height comes from
        if (Math.ceil(ci) < changed.i0 || Math.floor(ci) > changed.i1 || Math.ceil(cj) < changed.j0 || Math.floor(cj) > changed.j1) continue;
        const mass = massOf(o);
        const rc = ((mass ? massRadius(mass) : e.footprint) * (o.scale || 1)) / f.cellSize;
        w.i0 = Math.max(0, Math.min(w.i0, Math.floor(ci - rc)));
        w.j0 = Math.max(0, Math.min(w.j0, Math.floor(cj - rc)));
        w.i1 = Math.min(f.columns - 1, Math.max(w.i1, Math.ceil(ci + rc)));
        w.j1 = Math.min(f.rows - 1, Math.max(w.j1, Math.ceil(cj + rc)));
      }
    }
    const heights = f.grid.heights;
    for (let j = w.j0; j <= w.j1; j++) {
      const row = j * f.columns;
      this.tops.set(heights.subarray(row + w.i0, row + w.i1 + 1), row + w.i0);
      this.rims.fill(COVER_RIM, row + w.i0, row + w.i1 + 1);
    }
    if (terrain) this.addWater(terrain, w);
    for (let n = 0; n < found.length; n += 2) {
      const o = found[n] as MapObject;
      const e = found[n + 1] as CatalogObject;
      const covers = e.category !== 'wall';
      const s = o.scale || 1;
      // A raised building (object-mass.ts): its own height over its outline, not its entry's disc
      const mass = massOf(o);
      const r = (mass ? massRadius(mass) : e.footprint) * s;
      const ci = (o.x - f.originX) / f.cellSize;
      const cj = (o.y - f.originY) / f.cellSize;
      // Nothing of it reaches the window: its rim is the farthest it reaches
      const reach = (r + COVER_RIM) / f.cellSize + 1;
      if (ci + reach < w.i0 || ci - reach > w.i1 || cj + reach < w.j0 || cj - reach > w.j1) continue;
      this.addRim(o, e, w);
      if (!covers) continue;
      const top = f.heightAt(o.x, o.y) + o.z + (mass ? massTop(mass) : e.height) * s;
      const rc = r / f.cellSize;
      const cos = Math.cos(o.rotation);
      const sin = Math.sin(o.rotation);
      for (let j = Math.max(w.j0, Math.floor(cj - rc)); j <= Math.min(w.j1, Math.ceil(cj + rc)); j++) {
        for (let i = Math.max(w.i0, Math.floor(ci - rc)); i <= Math.min(w.i1, Math.ceil(ci + rc)); i++) {
          if (Math.hypot(i - ci, j - cj) > rc) continue;
          if (mass) {
            const m = toModel(f.originX + i * f.cellSize - o.x, f.originY + j * f.cellSize - o.y, cos, sin);
            if (!massContains(mass, m.x / s, m.z / s)) continue;
          }
          const k = j * f.columns + i;
          if (top > this.tops[k]) this.tops[k] = top;
        }
      }
    }
    for (let j = w.j0; j <= w.j1; j++) {
      for (let k = j * f.columns + w.i0, end = j * f.columns + w.i1; k <= end; k++) {
        if (bare?.[k]) this.rims[k] = 0;
        this.rimBytes[k] = Math.round((Math.min(this.rims[k], COVER_RIM) / COVER_RIM) * 255);
      }
    }
    found.length = 0;
    uploadRect(this.texture, rect && w);
    uploadRect(this.rim, rect && w);
  }

  /** The distance of the samples round an object to its ground (outline, rectangle or footprint disc) into the rims */
  private addRim(o: MapObject, e: CatalogObject, w: TexelRect): void {
    const f = this.field;
    const s = o.scale || 1;
    const mass = massOf(o);
    const r = (mass ? massRadius(mass) : e.footprint) * s + COVER_RIM;
    const ci = (o.x - f.originX) / f.cellSize;
    const cj = (o.y - f.originY) / f.cellSize;
    const rc = r / f.cellSize;
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    for (let j = Math.max(w.j0, Math.floor(cj - rc)); j <= Math.min(w.j1, Math.ceil(cj + rc)); j++) {
      for (let i = Math.max(w.i0, Math.floor(ci - rc)); i <= Math.min(w.i1, Math.ceil(ci + rc)); i++) {
        const dx = f.originX + i * f.cellSize - o.x;
        const dy = f.originY + j * f.cellSize - o.y;
        let d: number;
        if (mass) {
          const m = toModel(dx, dy, cos, sin);
          d = massDistance(mass, m.x / s, m.z / s) * s;
        } else if (e.box) {
          d = boxDistance(e.box, s, dx, dy, cos, sin);
        } else {
          d = Math.max(0, Math.hypot(dx, dy) - e.footprint * s);
        }
        const k = j * f.columns + i;
        if (d < this.rims[k]) this.rims[k] = d;
      }
    }
  }

  private addWater(t: MapTerrain, w: TexelRect): void {
    const f = this.field;
    const tops = this.tops;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (!body) continue;
      for (let j = w.j0; j <= w.j1; j++) {
        for (let k = j * f.columns + w.i0, end = j * f.columns + w.i1; k <= end; k++) if (body.mask[k] && body.level > tops[k]) tops[k] = body.level;
      }
    }
    // Rivers: a disc of the surface's width every half cell along the line
    for (const river of t.rivers ?? []) {
      for (let p = 0; p < river.points.length - 1; p++) {
        const a = river.points[p];
        const b = river.points[p + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (f.cellSize * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const x = a.x + (b.x - a.x) * u;
          const y = a.y + (b.y - a.y) * u;
          const level = a.height + (b.height - a.height) * u;
          const rc = ((a.width + (b.width - a.width) * u) * 0.5) / f.cellSize;
          const ci = (x - f.originX) / f.cellSize;
          const cj = (y - f.originY) / f.cellSize;
          for (let j = Math.max(w.j0, Math.floor(cj - rc)); j <= Math.min(w.j1, Math.ceil(cj + rc)); j++) {
            for (let i = Math.max(w.i0, Math.floor(ci - rc)); i <= Math.min(w.i1, Math.ceil(ci + rc)); i++) {
              if (Math.hypot(i - ci, j - cj) > rc) continue;
              const k = j * f.columns + i;
              if (level > tops[k]) tops[k] = level;
            }
          }
        }
      }
    }
  }

  /** Where the map group sits in the scene (the game moves it so its HQ is at the origin) */
  setFrame(x: number, z: number): void {
    this.uniforms.uCoverFrame.value.set(x, z);
  }

  dispose(): void {
    this.texture.dispose();
    this.rim.dispose();
  }
}

export const COVER_GLSL = /* glsl */ `
uniform sampler2D uCover;
uniform vec4 uCoverGrid;
uniform vec2 uCoverSize;
uniform vec2 uCoverFrame;

// Height of the cover under a scene position (terrain or roof), nearest sample
float coverTopAt(vec3 scenePos) {
  vec2 m = vec2(-(scenePos.x - uCoverFrame.x), scenePos.z - uCoverFrame.y);
  vec2 g = clamp((m - uCoverGrid.xy) / uCoverGrid.z + 0.5, vec2(0.0), uCoverSize - 1.0);
  return texelFetch(uCover, ivec2(g), 0).r;
}
`;
