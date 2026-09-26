import { DataTexture, FloatType, HalfFloatType, MathUtils, NearestFilter, RGBAFormat, type Vector3 } from 'three';

export const MAX_VAT_WIDTH = 8192;

/** Texture width and rows per frame; past MAX_VAT_WIDTH vertices a frame spans several rows. */
export function vatLayout(vertexCount: number): { texWidth: number; rowsPerFrame: number } {
  const texWidth = Math.min(vertexCount, MAX_VAT_WIDTH);
  return { texWidth, rowsPerFrame: Math.ceil(vertexCount / texWidth) };
}

/**
 * Largest error (m, in game) half-float texels may add to a baked position.
 * The camera stops 5 m from its orbit target (CameraRig minDistance) with a
 * 60° vertical fov. A pixel there covers 5.3 mm at 1080 and 4.0 mm at 1440
 * screen lines, so 2 mm stays within half a pixel up to 1440p.
 */
export const VAT_HALF_FLOAT_MAX_ERROR = 0.002;

/** Texel type of a VAT and how a texel maps back to a position: texel.xyz × extent + origin. */
export interface VATEncoding {
  /** HalfFloatType (RGBA16F, 8 bytes per texel) or FloatType (RGBA32F, 16 bytes). */
  type: typeof HalfFloatType | typeof FloatType;
  origin: [number, number, number];
  extent: [number, number, number];
  /** Largest position error half-float texels add (m, in game), whichever type was picked. */
  halfFloatError: number;
}

/** Per-axis bounds of baked positions (root space). */
export interface VATBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function emptyBounds(): VATBounds {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function growBounds(bounds: VATBounds, v: Vector3): void {
  const { min, max } = bounds;
  if (v.x < min[0]) min[0] = v.x;
  if (v.x > max[0]) max[0] = v.x;
  if (v.y < min[1]) min[1] = v.y;
  if (v.y > max[1]) max[1] = v.y;
  if (v.z < min[2]) min[2] = v.z;
  if (v.z > max[2]) max[2] = v.z;
}

/** Lowest and highest baked Y, 0 and 0 when nothing finite was baked. */
export function modelHeightRange(bounds: VATBounds): { modelMinY: number; modelMaxY: number } {
  return Number.isFinite(bounds.min[1])
    ? { modelMinY: bounds.min[1], modelMaxY: bounds.max[1] }
    : { modelMinY: 0, modelMaxY: 0 };
}

/**
 * Texel type and mapping for positions within `bounds`, shown at `worldScale`.
 *
 * Half floats keep 11 significant bits, so their error grows with the value.
 * The positions are stored relative to the centre of their bounding box and
 * divided by its half extent: every value lies in [-1, 1], where rounding to
 * nearest is off by at most 2^-12 of the half extent. Within
 * VAT_HALF_FLOAT_MAX_ERROR in game the VAT is RGBA16F, otherwise RGBA32F with
 * the positions as they are.
 */
export function vatEncoding(bounds: VATBounds, worldScale: number): VATEncoding {
  const { min, max } = bounds;
  const half = [0, 1, 2].map((a) => (max[a] - min[a]) / 2);
  const halfFloatError = Math.max(...half) * 2 ** -12 * worldScale;
  if (Number.isFinite(halfFloatError) && halfFloatError <= VAT_HALF_FLOAT_MAX_ERROR) {
    return {
      type: HalfFloatType,
      origin: [0, 1, 2].map((a) => (min[a] + max[a]) / 2) as [number, number, number],
      // A flat axis stores 0 everywhere; any non-zero extent decodes it.
      extent: half.map((h) => h || 1) as [number, number, number],
      halfFloatError,
    };
  }
  return { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError };
}

const halfScratch = new Float32Array(1);
const halfScratchBits = new Uint32Array(halfScratch.buffer);

/**
 * Half-float bits of `value`, rounded to nearest. DataUtils.toHalfFloat cuts
 * the mantissa off, which doubles the error. Covers the range the VAT stores
 * ([-1, 1]); past 65504 the result is wrong.
 */
export function toHalfFloatRounded(value: number): number {
  halfScratch[0] = value;
  const bits = halfScratchBits[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 112; // float bias 127, half bias 15
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    // Subnormal half; below 2^-25 it rounds to zero.
    if (exponent < -10) return sign;
    const shift = 14 - exponent;
    return sign | (((mantissa | 0x800000) + (1 << (shift - 1))) >>> shift);
  }
  // A carry out of the mantissa moves on to the next exponent, as it should.
  return sign | (((exponent << 10) | (mantissa >>> 13)) + ((mantissa >>> 12) & 1));
}

const HALF_FLOAT_ONE = 0x3c00;

/** The VAT texture for positions baked into `data` (xyz + padding per texel), stored as `encoding` says. */
export function createPositionTexture(data: Float32Array, width: number, height: number, encoding: VATEncoding): DataTexture {
  let texture: DataTexture;
  if (encoding.type === HalfFloatType) {
    const [ox, oy, oz] = encoding.origin;
    const [ex, ey, ez] = encoding.extent;
    // Clamped: texels past the last vertex of a tiled frame are unused zeros
    // and may lie outside the bounding box.
    const texels = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      texels[i] = toHalfFloatRounded(MathUtils.clamp((data[i] - ox) / ex, -1, 1));
      texels[i + 1] = toHalfFloatRounded(MathUtils.clamp((data[i + 1] - oy) / ey, -1, 1));
      texels[i + 2] = toHalfFloatRounded(MathUtils.clamp((data[i + 2] - oz) / ez, -1, 1));
      texels[i + 3] = HALF_FLOAT_ONE;
    }
    texture = new DataTexture(texels, width, height, RGBAFormat, HalfFloatType);
  } else {
    texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  }
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
