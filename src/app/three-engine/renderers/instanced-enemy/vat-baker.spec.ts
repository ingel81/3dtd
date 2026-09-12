import { describe, it, expect } from 'vitest';
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  DataUtils,
  Float32BufferAttribute,
  FloatType,
  Group,
  HalfFloatType,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from 'three';
import {
  bakeVAT,
  toHalfFloatRounded,
  VAT_HALF_FLOAT_MAX_ERROR,
  vatClips,
  vatDeathSeconds,
  vatEncoding,
  vatFrameCount,
  type VATData,
} from './vat-baker';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { TIMING } from '../../../configs/timing.config';

describe('vatFrameCount', () => {
  it('bakes a loop up to the frame before its end, which is frame 0 again', () => {
    expect(vatFrameCount(2.958, 30)).toBe(89);
    expect(vatFrameCount(1, 30)).toBe(30);
    expect(vatFrameCount(0, 30)).toBe(1);
  });

  it('adds no frame to a loop whose float32 duration runs a hair past a whole frame', () => {
    // The loaders read 4/3 s as 1.3333333730697632 s: 40.0000012 frames.
    expect(vatFrameCount(Math.fround(4 / 3), 30)).toBe(40);
    expect(vatFrameCount(Math.fround(0.8), 30)).toBe(24);
    expect(vatFrameCount(Math.fround(149 / 30), 30)).toBe(149);
    // A hair short of a whole frame stays as it was.
    expect(vatFrameCount(Math.fround(25 / 6), 30)).toBe(125);
  });

  it('bakes a cut clip up to the frame shown at the cut', () => {
    // floor(t × 30) for t in [0, 2] is 0 to 60.
    expect(vatFrameCount(6.333, 30, 2)).toBe(61);
    expect(vatFrameCount(2.208, 30, 1.5)).toBe(46);
    expect(vatFrameCount(4.5, 30, 2.76)).toBe(83);
  });

  it('bakes a clip that ends before the cut up to its end pose', () => {
    expect(vatFrameCount(2.958, 30, 8.22)).toBe(89);
    // Frame 30 is the pose at the end of a 1 s clip, held while the enemy lies dead.
    expect(vatFrameCount(1, 30, 1)).toBe(31);
    expect(vatFrameCount(Math.fround(1 / 3), 30, 2)).toBe(11);
    expect(vatFrameCount(Math.fround(1.3), 30, 2)).toBe(40);
  });
});

describe('vatClips', () => {
  it('cuts death clips where the enemy is removed and keeps loops whole', () => {
    const config = ENEMY_TYPES['zombie-v2'];
    const deathSeconds = (TIMING.deathAnimationDuration / 1000) * config.animationSpeed!;
    expect(vatDeathSeconds(config)).toBe(deathSeconds);
    expect(vatClips(config)).toEqual([
      { name: config.walkAnimation, seconds: Infinity },
      ...config.deathAnimations!.map((name) => ({ name, seconds: deathSeconds })),
    ]);
  });

  it('scales the death cut with animationSpeed', () => {
    const clips = vatClips({ walkAnimation: 'walk', deathAnimation: 'die', animationSpeed: 0.75 });
    expect(clips[1]).toEqual({ name: 'die', seconds: 1.5 });
  });

  it('bakes a clip used twice once, as far as its longest use', () => {
    expect(vatClips({ walkAnimation: 'a', deathAnimation: 'a', deathAnimations: ['b', 'b'] })).toEqual([
      { name: 'a', seconds: Infinity },
      { name: 'b', seconds: 2 },
    ]);
  });
});

describe('vatEncoding', () => {
  it('stores a 2 m model in half floats relative to its bounding box', () => {
    const encoding = vatEncoding({ min: [-0.5, 0, -0.25], max: [0.5, 2, 0.25] }, 1);
    expect(encoding.type).toBe(HalfFloatType);
    expect(encoding.origin).toEqual([0, 1, 0]);
    expect(encoding.extent).toEqual([0.5, 1, 0.25]);
    // 2^-12 of the largest half extent (1 m).
    expect(encoding.halfFloatError).toBe(2 ** -12);
  });

  it('keeps float32 once half floats would pass the error limit in game', () => {
    const bounds = { min: [-1, 0, -1], max: [1, 2, 1] } as const;
    // Half extent 1: the error is 2^-12 × scale, the limit is passed above scale 8.192.
    const limitScale = VAT_HALF_FLOAT_MAX_ERROR * 2 ** 12;
    expect(vatEncoding({ min: [...bounds.min], max: [...bounds.max] }, limitScale * 0.99).type).toBe(HalfFloatType);

    const coarse = vatEncoding({ min: [...bounds.min], max: [...bounds.max] }, limitScale * 1.01);
    expect(coarse.type).toBe(FloatType);
    expect(coarse.origin).toEqual([0, 0, 0]);
    expect(coarse.extent).toEqual([1, 1, 1]);
    expect(coarse.halfFloatError).toBeGreaterThan(VAT_HALF_FLOAT_MAX_ERROR);
  });

  it('judges by the size of the box, not its distance from the model origin', () => {
    const near = vatEncoding({ min: [0, 0, 0], max: [1, 1, 1] }, 1);
    const far = vatEncoding({ min: [500, 500, 500], max: [501, 501, 501] }, 1);
    expect(far.type).toBe(HalfFloatType);
    expect(far.halfFloatError).toBe(near.halfFloatError);
  });

  it('decodes a flat axis without dividing by zero', () => {
    const encoding = vatEncoding({ min: [-1, 0, 3], max: [1, 2, 3] }, 1);
    expect(encoding.type).toBe(HalfFloatType);
    expect(encoding.origin[2]).toBe(3);
    expect(encoding.extent[2]).toBe(1);
  });

  it('keeps float32 when nothing finite was baked', () => {
    expect(vatEncoding({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, 1).type)
      .toBe(FloatType);
  });
});

describe('toHalfFloatRounded', () => {
  /** Deterministic values in [-1, 1]. */
  function* samples(count: number): Generator<number> {
    let seed = 12345;
    for (let i = 0; i < count; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      yield (seed / 2 ** 32) * 2 - 1;
    }
    yield* [0, -0, 1, -1, 0.5, 2 ** -14, 2 ** -15 * 1.5, 2 ** -24, 2 ** -25, 2 ** -26, 1 - 2 ** -12, 1 - 2 ** -13];
  }

  it('picks the nearest half float, one of the two DataUtils.toHalfFloat brackets', () => {
    for (const value of samples(20000)) {
      const bits = toHalfFloatRounded(value);
      const truncated = DataUtils.toHalfFloat(value);
      expect([truncated, truncated + 1]).toContain(bits);
      const error = Math.abs(DataUtils.fromHalfFloat(bits) - value);
      for (const neighbour of [bits - 1, bits + 1]) {
        const other = DataUtils.fromHalfFloat(neighbour & 0xffff);
        // Stepping below ±0 wraps into NaN territory; no candidate there.
        if (Number.isFinite(other)) expect(error).toBeLessThanOrEqual(Math.abs(other - value));
      }
    }
  });

  it('stays within 2^-12 for values in [-1, 1], half of what truncating costs', () => {
    let rounded = 0;
    let truncated = 0;
    for (const value of samples(20000)) {
      rounded = Math.max(rounded, Math.abs(DataUtils.fromHalfFloat(toHalfFloatRounded(value)) - value));
      truncated = Math.max(truncated, Math.abs(DataUtils.fromHalfFloat(DataUtils.toHalfFloat(value)) - value));
    }
    expect(rounded).toBeLessThanOrEqual(2 ** -12);
    expect(truncated).toBeGreaterThan(1.9 * 2 ** -12);
  });
});

describe('bakeVAT', () => {
  /** One triangle skinned to a bone that moves; returns the model root. */
  function skinnedTriangle(): Group {
    const bone = new Bone();
    bone.name = 'root';
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    const root = new Group();
    root.add(bone, mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new Skeleton([bone]));
    return root;
  }

  const walk = new AnimationClip('walk', 1, [
    new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 1, 0, 0]),
  ]);
  // Sinks one unit per second for five seconds; the enemy is removed after two.
  const die = new AnimationClip('die', 5, [
    new VectorKeyframeTrack('root.position', [0, 5], [0, 0, 0, 0, -5, 0]),
  ]);
  const clips = vatClips({ walkAnimation: 'walk', deathAnimation: 'die', animationSpeed: 1 });

  /** Position of `vertex` in `frame`, decoded as the VAT shader does. */
  function vatPosition(vat: VATData, vertex: number, frame: number): number[] {
    const { texWidth, rowsPerFrame, encoding } = vat;
    const data = vat.positionTexture.image.data as Float32Array | Uint16Array;
    const row = frame * rowsPerFrame + Math.floor(vertex / texWidth);
    const offset = (row * texWidth + (vertex % texWidth)) * 4;
    return [0, 1, 2].map((a) => {
      const texel = encoding.type === HalfFloatType ? DataUtils.fromHalfFloat(data[offset + a]) : data[offset + a];
      return texel * encoding.extent[a] + encoding.origin[a];
    });
  }

  it('stops a death clip at the frame on screen when the enemy is removed', () => {
    const vat = bakeVAT(skinnedTriangle(), [walk, die], clips, 1)!;

    expect(vat.animations.get('walk')).toMatchObject({ frameStart: 0, frameCount: 30 });
    expect(vat.animations.get('die')).toMatchObject({ frameStart: 30, frameCount: 61 });
    expect(vat.totalFrames).toBe(91);
    expect(vat.positionTexture.image.height).toBe(91);

    // Last baked frame: the pose at 2 s, vertex 0 sunk by two units.
    expect(vatPosition(vat, 0, 30 + 60)[1]).toBeCloseTo(-2, 3);
  });

  it('stores small models in half floats within the error bound', () => {
    const worldScale = 1;
    const exact = bakeVAT(skinnedTriangle(), [walk, die], clips, 1e6)!;
    const half = bakeVAT(skinnedTriangle(), [walk, die], clips, worldScale)!;
    expect(exact.positionTexture.type).toBe(FloatType);
    expect(exact.positionTexture.image.data).toBeInstanceOf(Float32Array);
    expect(half.positionTexture.type).toBe(HalfFloatType);
    expect(half.positionTexture.image.data).toBeInstanceOf(Uint16Array);

    // The bound holds for the positions as stored in float32, up to the
    // float32 step of the normalised value before it is rounded.
    const bound = (half.encoding.halfFloatError / worldScale) * (1 + 2 ** -12);
    let worst = 0;
    for (let frame = 0; frame < half.totalFrames; frame++) {
      for (let vertex = 0; vertex < half.vertexCount; vertex++) {
        const expected = vatPosition(exact, vertex, frame);
        const actual = vatPosition(half, vertex, frame);
        for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(actual[a] - expected[a]));
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(bound);
  });

  it('keeps the positions exact in float32 when half floats would be too coarse', () => {
    const vat = bakeVAT(skinnedTriangle(), [walk, die], clips, 1e6)!;
    expect(vat.encoding).toMatchObject({ type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1] });
    const data = vat.positionTexture.image.data as Float32Array;
    // Walk frame 15: the bone has moved half a unit along x.
    expect(data[15 * vat.texWidth * 4]).toBe(Math.fround(0.5));
  });
});
