import { describe, it, expect } from 'vitest';
import { Vector3, WebGLCubeRenderTarget } from 'three';
import { LosResolveContext, cubeCoverage, isCubeVisible } from './gpu-cube-resolve';

/** 2×2 texels per face, far 40 m */
const SIZE = 2;
const FAR = 40;

/** Six faces, every texel the RGBA bytes of `fill(face)`. */
function context(fill: (face: number) => [number, number, number, number]): LosResolveContext {
  const faces: Uint8Array[] = [];
  for (let face = 0; face < 6; face++) {
    const buf = new Uint8Array(SIZE * SIZE * 4);
    for (let o = 0; o < buf.length; o += 4) buf.set(fill(face), o);
    faces.push(buf);
  }
  return {
    cube: { width: SIZE } as WebGLCubeRenderTarget,
    referencePos: new Vector3(),
    farDistance: FAR,
    faces,
    visibilityBias: 0.5,
    emptyDepthEpsilon: 0.001,
  };
}

/** R byte 1: 1/255 of far, 0.16 m from the tip */
const AT_TIP: [number, number, number, number] = [1, 0, 0, 0];
/** R byte 128: half of far, 20 m */
const MID: [number, number, number, number] = [128, 0, 0, 0];
/** The cleared colour: nothing drawn there */
const CLEARED: [number, number, number, number] = [0, 0, 0, 0];

describe('gpu-cube-resolve', () => {
  it('reads a cleared texel as no blocker and a texel at the tip as one', () => {
    // Face 0 is +X: a cell 10 m east of the tip
    expect(isCubeVisible(0, 0, 0, 10, 0, 0, context(() => CLEARED))).toBe(true);
    expect(isCubeVisible(0, 0, 0, 10, 0, 0, context(() => MID))).toBe(true);
    expect(isCubeVisible(0, 0, 0, 10, 0, 0, context(() => AT_TIP))).toBe(false);
  });

  it('cubeCoverage counts the texels at the tip and the empty ones over all six faces', () => {
    const ctx = context((face) => (face === 0 ? AT_TIP : face === 1 ? CLEARED : MID));
    expect(cubeCoverage(ctx, 2)).toEqual({ near: 4 / 24, empty: 4 / 24 });
    expect(cubeCoverage(context(() => AT_TIP), 2)).toEqual({ near: 1, empty: 0 });
  });

  it('cubeCoverage of a context without faces is zero, not NaN', () => {
    expect(cubeCoverage({ ...context(() => MID), faces: [] }, 2)).toEqual({ near: 0, empty: 0 });
  });
});
