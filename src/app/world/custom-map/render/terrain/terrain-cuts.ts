import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, Vector4 } from 'three';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { seatHeight } from '../objects/object-seat';

/**
 * The ground cut away inside the openings of models set into a slope (a
 * tunnel portal's vault): the height field cannot carry both the hill over a
 * vault and the road into it, so the terrain shader discards its fragments
 * inside each opening (TERRAIN_CUT_GLSL) and the model's own vault, floor and
 * dark back show. Before, the hill raised over a tunnel stood as a grass wall
 * a metre behind the portal's opening.
 *
 * An opening (catalogue `groundCut`: half width, spring, crown, length at
 * scale 1) runs from the model's front face (z = 0) back along -z, its
 * section straight walls up to the spring and an elliptic arch to the crown,
 * the profile three-quarter round and segmental vaults are built with.
 * Pitch and roll of the object are left out (no such model tilts). A run
 * piece (catalogue `row`) stretched along its x (MapObject.stretch) opens
 * that much wider, as it is drawn (a retaining wall's shelf beside a track).
 *
 * One float texture, a single texture unit (the terrain's program is near the
 * 16 of WebGL 2): a coarse index over the map (CUT_CELL metres a texel)
 * naming up to four openings per texel, then the openings, two texels each.
 * Besides the openings of models it cuts the ground out of the cellars of
 * ruins whose insides show (ruin-slabs.ts cellarCut: straight up, no arch).
 * A fragment pays one fetch however many there are, a fragment near an
 * opening two more. The terrain
 * writes its own depth (logarithmic depth buffer), so the discard costs no
 * early depth test. The shadow pass keeps the ground: the hill over the vault
 * shades it anyway.
 */

/** Metres per texel of the index */
export const CUT_CELL = 8;
/** Openings the index can name (one byte, 0 for none) */
const MAX_CUTS = 255;

/** One opening in map space */
export interface GroundCut {
  /** Middle of its front face */
  x: number;
  y: number;
  /** Unit direction into it */
  dx: number;
  dy: number;
  halfWidth: number;
  length: number;
  /** Heights of the spring and of the crown over the spring */
  springY: number;
  rise: number;
}

/**
 * The openings of the placed objects whose catalogue entry has a `groundCut`,
 * each at its object's seat (seatHeight, as MapObjectLayer places it)
 */
export function groundCuts(
  objects: readonly MapObject[],
  entries: ReadonlyMap<string, CatalogObject>,
  groundAt: (x: number, y: number) => number,
  waterAt: (x: number, y: number) => number | null,
): GroundCut[] {
  const out: GroundCut[] = [];
  for (const o of objects) {
    const e = entries.get(o.asset);
    if (!e?.groundCut) continue;
    const [halfWidth, spring, crown, length] = e.groundCut;
    const s = o.scale || 1;
    const stretch = e.row ? o.stretch || 1 : 1;
    const base = seatHeight(e, o, groundAt, waterAt) + o.z;
    // Model -z in map space (map-coords.ts: model +z turned by r lies along map (-sin r, cos r))
    out.push({
      x: o.x,
      y: o.y,
      dx: Math.sin(o.rotation),
      dy: -Math.cos(o.rotation),
      halfWidth: halfWidth * s * stretch,
      length: length * s,
      springY: base + spring * s,
      rise: Math.max(0, crown - spring) * s,
    });
  }
  return out;
}

/** Whether a map point at a height lies inside an opening: what TERRAIN_CUT_GLSL tests */
export function insideCut(c: GroundCut, x: number, y: number, h: number): boolean {
  const ox = x - c.x;
  const oy = y - c.y;
  const along = ox * c.dx + oy * c.dy;
  const across = Math.abs(ox * c.dy - oy * c.dx);
  if (along < 0 || along > c.length || across > c.halfWidth) return false;
  const u = across / c.halfWidth;
  return h < c.springY + c.rise * Math.sqrt(Math.max(0, 1 - u * u));
}

export class TerrainCuts {
  /** Uniforms to share into a material that includes TERRAIN_CUT_GLSL */
  readonly uniforms: {
    uCutMap: { value: DataTexture };
    /** Map corner of the index (x, y), texels per metre, rows of the index */
    uCutGrid: { value: Vector4 };
  };
  private map: DataTexture;
  private readonly columns: number;
  private readonly rows: number;
  private cuts: readonly GroundCut[] = [];

  constructor(
    private readonly width: number,
    private readonly depth: number,
  ) {
    this.columns = Math.max(2, Math.ceil(width / CUT_CELL));
    this.rows = Math.ceil(depth / CUT_CELL);
    this.map = this.texture(0);
    this.uniforms = {
      uCutMap: { value: this.map },
      uCutGrid: { value: new Vector4(-width / 2, -depth / 2, 1 / CUT_CELL, this.rows) },
    };
  }

  /** How many openings the texture holds */
  get size(): number {
    return this.cuts.length;
  }

  /** Index (four per texel, 0 none) of the texel at a map point, for tests */
  indexAt(x: number, y: number): [number, number, number, number] {
    const i = Math.floor((x + this.width / 2) / CUT_CELL);
    const j = Math.floor((y + this.depth / 2) / CUT_CELL);
    const px = this.map.image.data as Float32Array;
    const t = (j * this.columns + i) * 4;
    return [px[t], px[t + 1], px[t + 2], px[t + 3]];
  }

  /** Replaces the openings (past MAX_CUTS are left out; a texel names at most four); uploads only on a change */
  set(cuts: readonly GroundCut[]): void {
    const list = cuts.slice(0, MAX_CUTS);
    if (sameCuts(list, this.cuts)) return;
    this.cuts = list;
    const dataRows = Math.ceil((list.length * 2) / this.columns);
    if (this.map.image.height !== this.rows + dataRows) {
      this.map.dispose();
      this.map = this.texture(dataRows);
      this.uniforms.uCutMap.value = this.map;
    }
    const px = this.map.image.data as Float32Array;
    px.fill(0);
    const dataAt = this.rows * this.columns * 4;
    list.forEach((c, k) => {
      px.set([c.x, c.y, c.dx, c.dy, c.halfWidth, c.length, c.springY, c.rise], dataAt + k * 8);
      // The texels its ground rectangle touches
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const along of [0, c.length]) {
        for (const side of [-c.halfWidth, c.halfWidth]) {
          const x = c.x + c.dx * along + c.dy * side;
          const y = c.y + c.dy * along - c.dx * side;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
      const i0 = Math.max(0, Math.floor((x0 + this.width / 2) / CUT_CELL));
      const i1 = Math.min(this.columns - 1, Math.floor((x1 + this.width / 2) / CUT_CELL));
      const j0 = Math.max(0, Math.floor((y0 + this.depth / 2) / CUT_CELL));
      const j1 = Math.min(this.rows - 1, Math.floor((y1 + this.depth / 2) / CUT_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const t = (j * this.columns + i) * 4;
          for (let s = t; s < t + 4; s++) {
            if (px[s]) continue;
            px[s] = k + 1;
            break;
          }
        }
      }
    });
    this.map.needsUpdate = true;
  }

  dispose(): void {
    this.map.dispose();
  }

  /** The index rows, then `dataRows` rows of openings, two texels each */
  private texture(dataRows: number): DataTexture {
    const rows = this.rows + dataRows;
    const t = new DataTexture(new Float32Array(this.columns * rows * 4), this.columns, rows, RGBAFormat, FloatType);
    t.colorSpace = NoColorSpace;
    t.magFilter = t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
}

function sameCuts(a: readonly GroundCut[], b: readonly GroundCut[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    const p = a[k];
    const q = b[k];
    if (p.x !== q.x || p.y !== q.y || p.dx !== q.dx || p.dy !== q.dy || p.halfWidth !== q.halfWidth || p.length !== q.length || p.springY !== q.springY || p.rise !== q.rise) {
      return false;
    }
  }
  return true;
}

/** Declarations and `terrainCut(mapPos, height)` for a fragment shader */
export const TERRAIN_CUT_GLSL = /* glsl */ `
uniform sampler2D uCutMap;
uniform vec4 uCutGrid;

vec4 cutTexel(int n) {
  int w = textureSize(uCutMap, 0).x;
  return texelFetch(uCutMap, ivec2(n % w, int(uCutGrid.w) + n / w), 0);
}

bool insideCutAt(float k, vec2 m, float h) {
  vec4 a = cutTexel(int(k) * 2);
  vec4 b = cutTexel(int(k) * 2 + 1);
  vec2 o = m - a.xy;
  float along = dot(o, a.zw);
  float across = abs(o.x * a.w - o.y * a.z);
  if (along < 0.0 || along > b.y || across > b.x) return false;
  float u = across / b.x;
  return h < b.z + b.w * sqrt(max(0.0, 1.0 - u * u));
}

// Whether the ground at map point m and height h lies inside an opening of a model set into it (terrain-cuts.ts)
bool terrainCut(vec2 m, float h) {
  ivec2 size = textureSize(uCutMap, 0);
  ivec2 t = clamp(ivec2(floor((m - uCutGrid.xy) * uCutGrid.z)), ivec2(0), ivec2(size.x - 1, int(uCutGrid.w) - 1));
  vec4 k = texelFetch(uCutMap, t, 0);
  return (k.x > 0.5 && insideCutAt(k.x - 1.0, m, h)) || (k.y > 0.5 && insideCutAt(k.y - 1.0, m, h))
    || (k.z > 0.5 && insideCutAt(k.z - 1.0, m, h)) || (k.w > 0.5 && insideCutAt(k.w - 1.0, m, h));
}
`;
