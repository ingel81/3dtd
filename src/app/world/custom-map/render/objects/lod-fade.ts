import { BufferGeometry, InstancedBufferAttribute, type Material } from 'three';

/**
 * Soft switches between the detail levels of the map's objects (E154,
 * OP-H5): around each switch distance a band where an object shows both
 * levels, the outgoing one dissolving and the incoming one appearing in a
 * complementary screen-space dither, so every pixel shows exactly one of
 * them and nothing pops. The same where the object goes (its pixel limit): there it
 * dissolves into nothing. Per instance the fade lives in a `lodFade`
 * attribute (fadeGeometry): 0 shows the object whole, t in (0, 1) drops a
 * share t of its pixels (outgoing), t - 1 keeps a share t (incoming).
 * Shadows do not dither: the level that covers more of an object casts.
 *
 * The dither is a fixed screen pattern: on a camera at rest an object in a
 * band would stand there as a field of dots. Once the camera stood still a
 * moment the band settles (`settleBlend`): each object goes over to the
 * level nearer its distance within SETTLE_S. A settled object keeps its
 * level when the camera moves again (`holdBlend`) and dissolves only as it
 * goes on through the band. Nothing pops, at rest nothing dithers.
 */

/** The band's width as a share of the switch distance */
export const LOD_BAND = 0.12;

/**
 * A level of an asset as the band needs it: where it starts, in metres of
 * camera distance per metre of the object's bounding radius (a screen share,
 * asset-catalog.ts screenDistance), and whether it is a far impostor
 */
export interface FadeLevel {
  from: number;
  impostor?: boolean;
}

/**
 * Where a level starts for an object of `radius` metres, for the quality
 * level's bias and impostor distance: an impostor no nearer than that
 * distance, whatever the object's size
 */
export function levelStart(level: FadeLevel, radius: number, lodBias: number, impostorFrom: number): number {
  return level.impostor ? Math.max(level.from * radius, impostorFrom) : level.from * radius * lodBias;
}

/**
 * The level for distance `d`: -1 beyond `draw` (where the object goes), else the last
 * level whose start it passed
 */
export function levelAt(levels: readonly FadeLevel[], d: number, radius: number, draw: number, lodBias: number, impostorFrom: number): number {
  if (d > draw) return -1;
  for (let l = levels.length - 1; l > 0; l--) {
    if (d >= levelStart(levels[l], radius, lodBias, impostorFrom)) return l;
  }
  return 0;
}

/**
 * The levels an object shows (blendAt, settleBlend), and how far the camera
 * may come or go before that can change (`slack`, m; 0 inside a band)
 */
export interface LodBlend {
  level: number;
  next: number | null;
  t: number;
  slack: number;
}

/**
 * The levels to show at distance `d` for an object of `radius` metres:
 * `level`, and inside a band `next` (the level beyond, -1 for none at
 * `draw`, where it goes) with `t` from 0 at the band's near edge to 1 at its far
 * edge; outside a band `next` is null. `slack` is the distance to the
 * nearest band: the object layer looks at the object again only once the
 * camera moved that far. Written into `out`: the object layer asks for every
 * object it looks at, and a new object each time was most of what it
 * allocated
 */
export function blendAt(
  levels: readonly FadeLevel[],
  d: number,
  radius: number,
  draw: number,
  lodBias: number,
  impostorFrom: number,
  out: LodBlend = { level: 0, next: null, t: 0, slack: 0 },
): LodBlend {
  let slack = Infinity;
  // The switch distances in order, where the object goes last
  for (let l = 1; l <= levels.length; l++) {
    const last = l === levels.length;
    const at = last ? draw : levelStart(levels[l], radius, lodBias, impostorFrom);
    const next = last ? -1 : l;
    const half = (at * LOD_BAND) / 2;
    if (!(at > 0)) continue;
    const off = Math.abs(d - at) - half;
    if (off < 0) {
      const level = levelAt(levels, at - half, radius, draw, lodBias, impostorFrom);
      // No switch here after all (a level that never shows): looked at again each frame while in the band
      if (level === next) {
        slack = 0;
        continue;
      }
      out.level = level;
      out.next = next;
      out.t = (d - (at - half)) / (2 * half);
      out.slack = 0;
      return out;
    }
    if (off < slack) slack = off;
  }
  out.level = levelAt(levels, d, radius, draw, lodBias, impostorFrom);
  out.next = null;
  out.t = 0;
  out.slack = slack;
  return out;
}

/** How long a band takes to settle at rest, or to open again once the camera moves, s */
export const SETTLE_S = 0.3;
/** The camera stands still this long before a band settles, s */
export const REST_S = 0.15;

/**
 * A band's blend `settle` of the way (0 moving .. 1 at rest) towards the
 * level that shows more of it: past the middle the next level, else its
 * own (without a hold, the level nearer the object's distance). Fully
 * settled it shows that one level alone. Written into `out`,
 * which may be `blend` itself
 */
export function settleBlend(blend: LodBlend, settle: number, out: LodBlend = { level: 0, next: null, t: 0, slack: 0 }): LodBlend {
  const { level, next } = blend;
  out.slack = blend.slack;
  if (next === null || settle <= 0) {
    out.level = level;
    out.next = next;
    out.t = blend.t;
    return out;
  }
  const target = blend.t >= 0.5 ? 1 : 0;
  const t = blend.t + (target - blend.t) * Math.min(1, settle);
  out.level = t >= 1 ? next : level;
  out.next = t <= 0 || t >= 1 ? null : next;
  out.t = t <= 0 || t >= 1 ? 0 : t;
  return out;
}

/**
 * A band's blend held on the level an object settled on (E268): settled at
 * `at` (the band's t then) on its near level (`end` 0) or its far one (1),
 * the object keeps that level while the camera stays on that side of `at`
 * and dissolves towards the other only as it goes on to the band's other
 * edge, where it shows that one alone, as without the hold. Without it a
 * settled object opened to the band's blend at the first move of the
 * camera and settled back at rest: a zoom by a notch showed a building
 * dissolve into its other level and return. Written into `blend` (its t),
 * which settleBlend then settles towards the level that shows more
 */
export function holdBlend(blend: LodBlend, at: number, end: number): LodBlend {
  if (blend.next === null) return blend;
  blend.t = end === 0 ? (blend.t <= at ? 0 : (blend.t - at) / (1 - at)) : blend.t >= at ? 1 : blend.t / at;
  return blend;
}

/**
 * A geometry for one mesh of instances: the model's own attributes and
 * index shared (one upload), plus the `lodFade` instances of this mesh, or
 * `fade` shared by several meshes
 */
export function fadeGeometry(source: BufferGeometry, fade: InstancedBufferAttribute): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) g.setAttribute(name, attr);
  g.setIndex(source.index);
  g.setDrawRange(source.drawRange.start, source.drawRange.count);
  for (const group of source.groups) g.addGroup(group.start, group.count, group.materialIndex);
  g.boundingBox = source.boundingBox;
  g.boundingSphere = source.boundingSphere;
  g.setAttribute('lodFade', fade);
  return g;
}

/** Frees what fadeGeometry made and nothing of the model: its attributes and index stay */
export function disposeFadeGeometry(g: BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) if (name !== 'lodFade') g.deleteAttribute(name);
  g.setIndex(null);
  g.dispose();
}

/** The dither of the band into a material; wraps what compiles it so far */
export function addLodFade(material: Material): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lodFade;\nvarying float vLodFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLodFade = lodFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLodFade;')
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
        if (vLodFade != 0.0) {
          // Interleaved gradient noise: a fine dither that does not move with the camera
          float lodNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (vLodFade > 0.0 ? lodNoise < vLodFade : lodNoise >= 1.0 + vLodFade) discard;
        }`,
      );
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-lod-fade`;
}
