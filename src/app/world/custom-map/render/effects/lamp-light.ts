import { Color, DataUtils, Vector4, type DataArrayTexture, type Vector3 } from 'three';
import type { HeightField } from '../height-field';
import { LIGHT_FLICKER, LIGHT_LAMPS, type LightGrid } from './light-grid';

/**
 * The light of every lamp, torch, fire and glowing lava point on the land
 * around it, baked into the map's light grid (light-grid.ts, one texel per
 * metre up to 512 a side): what the six real point lights near the camera cannot
 * carry. Every map material samples it at its fragment (height-fog.ts,
 * LAMP_LIGHT_UNIFORMS) and adds it, times its own colour, as light: a
 * street lamp lights a disc of road under it, a brazier the wall beside it,
 * at no cost per light. Steady lights in one layer, flickering ones
 * (fire, lava) in the other, which the shader lets flicker by a phase that
 * changes over the map. The steady layer's alpha holds the ground height the light stands on
 * (weighted), so a roof high over a lamp stays dark. Faded in by darkness
 * like the point lights.
 */

/** Light at the foot of a lamp of catalogue intensity 1 */
const GAIN = 2.8;
/**
 * The falloff's core is at least this share of the reach wide: a pure
 * inverse square from a low lamp (a torch at 2 m) lit a hand's breadth of
 * ground and left the rest of its reach dark
 */
const CORE = 0.2;
/** Share of the foot's light that the whole pool keeps, fading only with its edge: a faint one, the tail does the rest */
const FLOOR = 0.06;
/** The pool's tail runs on past the catalogue reach, times it, before the window closes it */
const TAIL = 1.5;
/** How much the light varies over the pool (uneven paving, a dirty glass): ± this share, in patches of a few metres */
const GRAIN = 0.12;

interface Rect {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) };
}

export interface LampSpot {
  /** Scene position of the light (group space) */
  position: Vector3;
  color: Color;
  /** Catalogue intensity, about 1 for a lamp */
  intensity: number;
  /** Reach on the ground, metres */
  distance: number;
  flicker: boolean;
}

/** Height above a smooth surface its lamp glint looks for the light at, metres: a street lamp's */
const LAMP_GLINT_HEIGHT = 4;

export const LAMP_LIGHT_UNIFORMS = {
  /** 0 off (by day, no lights), up to 1 at night */
  uLampOn: { value: 0 },
  /** The map's light grid (light-grid.ts): steady lamp light and ground height, flickering light and the far shadow */
  uLampGrid: { value: null as DataArrayTexture | null },
  /** Map metres to the grid's uv */
  uLampGridUv: { value: new Vector4() },
  uLampTime: { value: 0 },
};

export class LampLight {
  private readonly columns: number;
  private readonly rows: number;
  private readonly texel: number;
  private readonly originX: number;
  private readonly originY: number;
  /** The light as floats (rgb, and the weighted ground height in the steady one's alpha) and the weights */
  private readonly steadyValues: Float32Array;
  private readonly flickerValues: Float32Array;
  private readonly weight: Float32Array;
  /** Where the last bake put light */
  private baked: Rect | null = null;
  /** What the last bake was of (lampSignature) and whether it lit anything */
  private signature: Float64Array | null = null;
  private lit = false;

  constructor(
    private readonly field: HeightField,
    /** Where the light goes: its lamp layers' colour, and the steady one's ground height */
    readonly grid: LightGrid,
  ) {
    this.texel = grid.texel;
    this.columns = grid.columns;
    this.rows = grid.rows;
    this.originX = grid.originX;
    this.originY = grid.originY;
    this.steadyValues = new Float32Array(this.columns * this.rows * 4);
    this.flickerValues = new Float32Array(this.columns * this.rows * 4);
    this.weight = new Float32Array(this.columns * this.rows);
  }

  /** The grid's uv for map metres (x, y): u = x * uv.x + uv.z, v = y * uv.y + uv.w */
  gridUv(target: Vector4): Vector4 {
    return this.grid.gridUv(target);
  }

  /**
   * Bakes the light of `spots` anew; true when any light falls on the map.
   * The same lights as the last bake bake nothing: the effects are built
   * again for other reasons too (a quality level's particle share), and each
   * of those baked the whole map's light anew (20 to 25 ms on harbor town).
   * The ground under each light counts: an edit there bakes again
   */
  bake(spots: readonly LampSpot[]): boolean {
    const signature = lampSignature(spots, this.field);
    if (this.signature && sameValues(signature, this.signature)) return this.lit;
    this.signature = signature;
    this.lit = this.bakeAnew(spots);
    return this.lit;
  }

  private bakeAnew(spots: readonly LampSpot[]): boolean {
    const steady = this.steadyValues;
    const flicker = this.flickerValues;
    const weight = this.weight;
    // Only where the last bake or this one reach is cleared and converted (a lamp placed is a small rectangle)
    const before = this.baked;
    let rect: Rect | null = null;
    const color = new Color();
    const work: { s: LampSpot; x: number; y: number; ground: number; h: number; reach: number; r: Rect }[] = [];
    for (const s of spots) {
      const x = -s.position.x;
      const y = s.position.z;
      const ground = this.field.heightAt(x, y);
      const h = Math.max(0.5, s.position.y - ground);
      const reach = Math.max(s.distance, h * 2.5) * TAIL;
      const r: Rect = {
        i0: Math.max(0, Math.floor((x - reach - this.originX) / this.texel)),
        i1: Math.min(this.columns - 1, Math.ceil((x + reach - this.originX) / this.texel)),
        j0: Math.max(0, Math.floor((y - reach - this.originY) / this.texel)),
        j1: Math.min(this.rows - 1, Math.ceil((y + reach - this.originY) / this.texel)),
      };
      if (r.i0 > r.i1 || r.j0 > r.j1) continue;
      work.push({ s, x, y, ground, h, reach, r });
      rect = union(rect, r);
    }
    const dirty = union(before, rect);
    if (!dirty) return false;
    this.clear(dirty);
    for (const { s, x, y, ground, h, reach, r } of work) {
      const core = Math.max(h, (reach / TAIL) * CORE);
      const target = s.flicker ? flicker : steady;
      // Linear colour times strength; brighter lights reach further too (catalogue distance)
      color.copy(s.color).multiplyScalar(s.intensity * GAIN);
      for (let j = r.j0; j <= r.j1; j++) {
        const dy = this.originY + j * this.texel - y;
        for (let i = r.i0; i <= r.i1; i++) {
          const dx = this.originX + i * this.texel - x;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach) continue;
          // An inverse square from the light's height (its core at least CORE of the reach): bright under the lamp,
          // a long soft tail out past the reach, over a faint floor (FLOOR); a little uneven (GRAIN)
          const window = 1 - d2 / (reach * reach);
          const grain = 1 + GRAIN * (valueNoise(this.originX + i * this.texel, this.originY + j * this.texel) * 2 - 1);
          const f = (((core * core) / (d2 + core * core)) * (1 - FLOOR) + FLOOR) * window * window * grain;
          const k = j * this.columns + i;
          const q = k * 4;
          target[q] += color.r * f;
          target[q + 1] += color.g * f;
          target[q + 2] += color.b * f;
          steady[q + 3] += ground * f;
          weight[k] += f;
        }
      }
    }
    for (let j = dirty.j0; j <= dirty.j1; j++) {
      for (let i = dirty.i0; i <= dirty.i1; i++) {
        const k = j * this.columns + i;
        // Without light the texel's own ground, so the height blends smoothly into a pool's edge
        const ground = weight[k] > 0 ? steady[k * 4 + 3] / weight[k] : this.field.heightAt(this.originX + i * this.texel, this.originY + j * this.texel);
        steady[k * 4 + 3] = ground;
      }
    }
    // The flickering layer's alpha is the far shadow's (light-grid.ts)
    this.upload(LIGHT_LAMPS, steady, dirty, 4);
    this.upload(LIGHT_FLICKER, flicker, dirty, 3);
    this.baked = rect;
    return !!rect;
  }

  /** Zeroes the light inside `r` */
  private clear(r: Rect): void {
    for (let j = r.j0; j <= r.j1; j++) {
      const a = j * this.columns + r.i0;
      const b = j * this.columns + r.i1 + 1;
      this.steadyValues.fill(0, a * 4, b * 4);
      this.flickerValues.fill(0, a * 4, b * 4);
      this.weight.fill(0, a, b);
    }
  }

  /** The first `channels` of each texel in `r` from `values` into a layer of the grid */
  private upload(layer: number, values: Float32Array, r: Rect, channels: number): void {
    const data = this.grid.data;
    const start = this.grid.layerStart(layer);
    for (let j = r.j0; j <= r.j1; j++) {
      for (let q = (j * this.columns + r.i0) * 4; q < (j * this.columns + r.i1 + 1) * 4; q += 4) {
        for (let c = 0; c < channels; c++) data[start + q + c] = DataUtils.toHalfFloat(Math.max(-6e4, Math.min(6e4, values[q + c])));
      }
    }
    this.grid.changed(layer);
  }
}

/**
 * Added to every map material's light (height-fog.ts): the baked lamp light, flickering where it is fire. On
 * smooth surfaces (paving with the night's dew, wet stone) the lamps glint: the view reflected off the surface
 * is followed up to a lamp's height and the light found there shows, a streak towards the viewer as on a wet
 * street, at one lookup more.
 */
export const LAMP_LIGHT_FRAGMENT = /* glsl */ `
if (uLampOn > 0.0) {
  // Faces turned up take it all, walls most of it, faces turned down little
  float lampUp = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  float lampFacing = 0.35 + 0.65 * clamp(lampUp * 0.5 + 0.5, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * lampLightAt(vFogWorldPos) * lampFacing;
  #ifdef STANDARD
  float lampGloss = 1.0 - smoothstep(0.25, 0.6, roughnessFactor);
  if (lampGloss > 0.0 && lampUp > 0.5) {
    vec3 lampView = normalize(vFogWorldPos - cameraPosition);
    vec3 lampMirror = reflect(lampView, vec3(0.0, 1.0, 0.0));
    vec3 lampSeen = lampLightAt(vFogWorldPos + lampMirror * (${LAMP_GLINT_HEIGHT.toFixed(1)} / max(lampMirror.y, 0.08)));
    float lampFresnel = 0.04 + 0.96 * pow(1.0 - clamp(lampMirror.y, 0.0, 1.0), 5.0);
    totalEmissiveRadiance += lampSeen * lampGloss * lampGloss * (0.15 + 0.85 * lampFresnel) * 0.6;
  }
  #endif
}
`;

/** uLampOn's declaration, once per shader whichever of the lamp's chunks comes first (the lamp glass's and the light's) */
export const LAMP_ON_UNIFORM = /* glsl */ `#ifndef LAMP_ON_UNIFORM
#define LAMP_ON_UNIFORM
uniform float uLampOn;
#endif`;

/** The baked light at a world position, by darkness (needs HEIGHT_FOG_PARS before it for uFogMap) */
export const LAMP_LIGHT_PARS = /* glsl */ `
${LAMP_ON_UNIFORM}
precision highp sampler2DArray;
uniform sampler2DArray uLampGrid;
uniform vec4 uLampGridUv;
uniform float uLampTime;
vec3 lampLightAt(vec3 worldPos) {
  if (uLampOn <= 0.0) return vec3(0.0);
  vec2 lampAt = vec2(uFogMap.x - worldPos.x, worldPos.z - uFogMap.y);
  vec2 lampUv = lampAt * uLampGridUv.xy + uLampGridUv.zw;
  vec4 lampSteady = texture(uLampGrid, vec3(lampUv, 0.0));
  vec3 lampFlicker = texture(uLampGrid, vec3(lampUv, 1.0)).rgb;
  float lampPhase = dot(lampAt, vec2(0.13, 0.17));
  float lampFlick = 0.78 + 0.14 * sin(uLampTime * 9.0 + lampPhase) + 0.08 * sin(uLampTime * 23.0 + lampPhase * 3.0);
  // High over the ground the light stands on (a roof over a street lamp) it fades out
  float lampVertical = 1.0 - smoothstep(6.0, 12.0, worldPos.y - lampSteady.a);
  vec3 lampLight = lampSteady.rgb + lampFlicker * lampFlick;
  // Soft limit: many lamps together light brightly, never to white
  lampLight = lampLight / (1.0 + max(max(lampLight.r, lampLight.g), lampLight.b) * 0.35);
  return lampLight * (uLampOn * lampVertical);
}
`;

/** Smooth value noise 0..1 over map metres, cells of 2.5 m */
function valueNoise(x: number, y: number): number {
  const fx = x / 2.5;
  const fy = y / 2.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sx;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The numbers of each spot that the bake reads, with the ground under it (an edit there bakes again), in one array */
function lampSignature(spots: readonly LampSpot[], field: HeightField): Float64Array {
  const out = new Float64Array(spots.length * 10);
  spots.forEach((s, k) => {
    const ground = field.heightAt(-s.position.x, s.position.z);
    out.set([s.position.x, s.position.y, s.position.z, s.color.r, s.color.g, s.color.b, s.intensity, s.distance, s.flicker ? 1 : 0, ground], k * 10);
  });
  return out;
}

function sameValues(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
