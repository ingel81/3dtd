import { BufferGeometry, InstancedBufferAttribute, type Material } from 'three';

/**
 * Soft switches between the detail levels of the map's objects (E154,
 * OP-H5): around each switch distance a band where an object shows both
 * levels, the outgoing one dissolving and the incoming one appearing in a
 * complementary screen-space dither, so every pixel shows exactly one of
 * them and nothing pops. The same at the draw distance, where the object
 * dissolves into nothing. Per instance the fade lives in a `lodFade`
 * attribute (fadeGeometry): 0 shows the object whole, t in (0, 1) drops a
 * share t of its pixels (outgoing), t - 1 keeps a share t (incoming).
 * Shadows do not dither: in the band both levels cast.
 */

/** The band's width as a share of the switch distance */
export const LOD_BAND = 0.12;

/** A level of an asset as the band needs it: where it starts, and whether it is a far impostor */
export interface FadeLevel {
  from: number;
  impostor?: boolean;
}

/** Where a level starts at distance from the camera, for the quality level's bias and impostor distance */
export function levelStart(level: FadeLevel, lodBias: number, impostorFrom: number): number {
  return level.impostor ? Math.max(level.from, impostorFrom) : level.from * lodBias;
}

/**
 * The level for distance `d`: -1 beyond the draw distance, else the last
 * level whose start it passed
 */
export function levelAt(levels: readonly FadeLevel[], d: number, draw: number, lodBias: number, impostorFrom: number): number {
  if (d > draw) return -1;
  for (let l = levels.length - 1; l > 0; l--) {
    if (d >= levelStart(levels[l], lodBias, impostorFrom)) return l;
  }
  return 0;
}

/**
 * The levels to show at distance `d`: `level`, and inside a band `next`
 * (the level beyond, -1 for none at the draw distance) with `t` from 0 at
 * the band's near edge to 1 at its far edge; outside a band `next` is null
 */
export function blendAt(
  levels: readonly FadeLevel[],
  d: number,
  draw: number,
  lodBias: number,
  impostorFrom: number,
): { level: number; next: number | null; t: number } {
  const edges: [number, number][] = [];
  for (let l = 1; l < levels.length; l++) edges.push([levelStart(levels[l], lodBias, impostorFrom), l]);
  edges.push([draw, -1]);
  for (const [at, next] of edges) {
    const half = (at * LOD_BAND) / 2;
    if (Math.abs(d - at) < half && at > 0) {
      const level = levelAt(levels, at - half, draw, lodBias, impostorFrom);
      if (level === next) continue;
      return { level, next, t: (d - (at - half)) / (2 * half) };
    }
  }
  return { level: levelAt(levels, d, draw, lodBias, impostorFrom), next: null, t: 0 };
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
