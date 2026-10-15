import { ClampToEdgeWrapping, Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector4, type Vector3 } from 'three';
import type { HeightField } from '../height-field';

/**
 * The light of every lamp, torch, fire and glowing lava point on the land
 * around it, baked into two textures over the map (one texel per metre up
 * to 512 a side): what the six real point lights near the camera cannot
 * carry. Every map material samples it at its fragment (height-fog.ts,
 * LAMP_LIGHT_UNIFORMS) and adds it, times its own colour, as light: a
 * street lamp lights a disc of road under it, a brazier the wall beside it,
 * at no cost per light. Steady lights in one texture, flickering ones
 * (fire, lava) in the other, which the shader lets flicker by a phase that
 * changes over the map. Alpha holds the ground height the light stands on
 * (weighted), so a roof high over a lamp stays dark. Faded in by darkness
 * like the point lights.
 */

/** Most texels a side */
const MAX_TEXELS = 512;
/** Light at the foot of a lamp of catalogue intensity 1 */
const GAIN = 1.6;

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

export const LAMP_LIGHT_UNIFORMS = {
  /** 0 off (by day, no lights), up to 1 at night */
  uLampOn: { value: 0 },
  uLampSteady: { value: null as DataTexture | null },
  uLampFlicker: { value: null as DataTexture | null },
  /** Map metres to the textures' uv */
  uLampGridUv: { value: new Vector4() },
  uLampTime: { value: 0 },
};

export class LampLight {
  readonly steady: DataTexture;
  readonly flicker: DataTexture;
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

  constructor(private readonly field: HeightField) {
    const width = (field.columns - 1) * field.cellSize;
    const depth = (field.rows - 1) * field.cellSize;
    this.texel = Math.max(1, Math.max(width, depth) / (MAX_TEXELS - 1));
    this.columns = Math.ceil(width / this.texel) + 1;
    this.rows = Math.ceil(depth / this.texel) + 1;
    this.originX = field.originX;
    this.originY = field.originY;
    this.steady = this.make();
    this.flicker = this.make();
    this.steadyValues = new Float32Array(this.columns * this.rows * 4);
    this.flickerValues = new Float32Array(this.columns * this.rows * 4);
    this.weight = new Float32Array(this.columns * this.rows);
  }

  /** The textures' uv for map metres (x, y): u = x * uv.x + uv.z, v = y * uv.y + uv.w */
  gridUv(target: Vector4): Vector4 {
    const sx = 1 / (this.texel * this.columns);
    const sy = 1 / (this.texel * this.rows);
    return target.set(sx, sy, -this.originX * sx + 0.5 / this.columns, -this.originY * sy + 0.5 / this.rows);
  }

  /** Bakes the light of `spots` anew; true when any light falls on the map */
  bake(spots: readonly LampSpot[]): boolean {
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
      const reach = Math.max(s.distance, h * 2.5);
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
      const target = s.flicker ? flicker : steady;
      // Linear colour times strength; brighter lights reach further too (catalogue distance)
      color.copy(s.color).multiplyScalar(s.intensity * GAIN);
      for (let j = r.j0; j <= r.j1; j++) {
        const dy = this.originY + j * this.texel - y;
        for (let i = r.i0; i <= r.i1; i++) {
          const dx = this.originX + i * this.texel - x;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach) continue;
          // An inverse square from the light's height, ending softly at its reach
          const window = 1 - d2 / (reach * reach);
          const f = ((h * h) / (d2 + h * h)) * window * window;
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
        flicker[k * 4 + 3] = ground;
      }
    }
    this.upload(this.steady, steady, dirty);
    this.upload(this.flicker, flicker, dirty);
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

  dispose(): void {
    this.steady.dispose();
    this.flicker.dispose();
  }

  private make(): DataTexture {
    const t = new DataTexture(new Uint16Array(this.columns * this.rows * 4), this.columns, this.rows, RGBAFormat, HalfFloatType);
    t.colorSpace = NoColorSpace;
    t.magFilter = t.minFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  private upload(texture: DataTexture, values: Float32Array, r: Rect): void {
    const data = texture.image.data as Uint16Array;
    for (let j = r.j0; j <= r.j1; j++) {
      for (let q = (j * this.columns + r.i0) * 4; q < (j * this.columns + r.i1 + 1) * 4; q++) {
        data[q] = DataUtils.toHalfFloat(Math.max(-6e4, Math.min(6e4, values[q])));
      }
    }
    texture.needsUpdate = true;
  }
}

/** Added to every map material's light (height-fog.ts): the baked lamp light, flickering where it is fire */
export const LAMP_LIGHT_FRAGMENT = /* glsl */ `
if (uLampOn > 0.0) {
  vec2 lampAt = vec2(uFogMap.x - vFogWorldPos.x, vFogWorldPos.z - uFogMap.y);
  vec2 lampUv = lampAt * uLampGridUv.xy + uLampGridUv.zw;
  vec4 lampSteady = texture2D(uLampSteady, lampUv);
  vec3 lampFlicker = texture2D(uLampFlicker, lampUv).rgb;
  float lampPhase = dot(lampAt, vec2(0.13, 0.17));
  float lampFlick = 0.8 + 0.12 * sin(uLampTime * 9.0 + lampPhase) + 0.08 * sin(uLampTime * 23.0 + lampPhase * 3.0);
  // High over the ground the light stands on (a roof over a street lamp) it fades out
  float lampOver = vFogWorldPos.y - lampSteady.a;
  float lampVertical = 1.0 - smoothstep(6.0, 12.0, lampOver);
  // Faces turned up take it all, walls most of it, faces turned down little
  float lampUp = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  float lampFacing = 0.35 + 0.65 * clamp(lampUp * 0.5 + 0.5, 0.0, 1.0);
  vec3 lampLight = lampSteady.rgb + lampFlicker * lampFlick;
  // Soft limit: many lamps together light brightly, never to white
  lampLight = lampLight / (1.0 + max(max(lampLight.r, lampLight.g), lampLight.b) * 0.35);
  totalEmissiveRadiance += diffuseColor.rgb * lampLight * (uLampOn * lampVertical * lampFacing);
}
`;

export const LAMP_LIGHT_PARS = /* glsl */ `
uniform float uLampOn;
uniform sampler2D uLampSteady;
uniform sampler2D uLampFlicker;
uniform vec4 uLampGridUv;
uniform float uLampTime;
`;
