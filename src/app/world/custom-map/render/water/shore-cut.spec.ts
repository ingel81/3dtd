import { describe, expect, it } from 'vitest';
import { cellHeight } from '../height-field';
import { bakeShoreCut, SHORE_CUT_SCALE } from './shore-cut';

const N = 81;
const LEVEL = 19.5;

/** A round hollow 24 cells across in the middle of the grid; `wall(r)` its height at r cells from the centre */
function hollow(wall: (r: number) => number): Float32Array {
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = wall(Math.hypot(i - 40, j - 40));
  return h;
}

function bake(h: Float32Array): Uint8Array {
  const mask = new Uint8Array(N * N).fill(255);
  const out = new Uint8Array(N * N * 2);
  bakeShoreCut(h, N, N, 2, LEVEL, mask, out, { i0: 0, j0: 0, i1: N - 1, j1: N - 1 });
  return out;
}

/** The drawn terrain at a point (cells): the mesh's two triangles per cell, as terrainHeightAt */
function meshAt(h: Float32Array, x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  return cellHeight(h[j * N + i], h[j * N + i + 1], h[(j + 1) * N + i], h[(j + 1) * N + i + 1], fx, fy);
}

/** The cut in cells at a point, bilinear as the texture samples it */
function cutAt(out: Uint8Array, x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const v = (ii: number, jj: number) => (out[(jj * N + ii) * 2 + 1] - 128) / SHORE_CUT_SCALE;
  return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
}

/** Distance from the centre at which the water ends along each of 720 rays: where `wet` first fails */
function radii(wet: (x: number, y: number) => boolean): number[] {
  const out: number[] = [];
  for (let a = 0; a < 720; a++) {
    const dx = Math.cos((a / 720) * Math.PI * 2);
    const dy = Math.sin((a / 720) * Math.PI * 2);
    let r = 0;
    while (r < 30 && wet(40 + dx * r, 40 + dy * r)) r += 0.01;
    out.push(r);
  }
  return out;
}

/** How far the line strays from its own average over 4 cells of arc: the teeth, not the overall shape */
const roughness = (r: number[]) => {
  let sum = 0;
  for (let k = 0; k < r.length; k++) {
    let mean = 0;
    for (let d = -20; d <= 20; d++) mean += r[(k + d + r.length) % r.length];
    sum += Math.abs(r[k] - mean / 41);
  }
  return sum / r.length;
};

describe('shore cut', () => {
  it('ends the water round a pit with sheer walls on a rounder line, inside the drawn waterline', () => {
    // Floor 18 m below the rim, the wall within one cell
    const h = hollow((r) => (r < 12 ? 0 : 20));
    const out = bake(h);
    const mesh = radii((x, y) => meshAt(h, x, y) < LEVEL);
    const both = radii((x, y) => meshAt(h, x, y) < LEVEL && cutAt(out, x, y) > 0);
    // The mesh's waterline runs in teeth along the samples; the cut takes most of them off
    expect(roughness(both)).toBeLessThan(roughness(mesh) * 0.35);
    // and only a little more: it stays within 1.2 cells of the wall
    for (let k = 0; k < mesh.length; k++) expect(mesh[k] - both[k]).toBeLessThan(1.2);
  });

  it('leaves a gentle shore to the depth per pixel', () => {
    // A bowl rising 0.6 m per 2 m cell
    const h = hollow((r) => 12 + r * 0.6);
    const out = bake(h);
    const mesh = radii((x, y) => meshAt(h, x, y) < LEVEL);
    const both = radii((x, y) => meshAt(h, x, y) < LEVEL && cutAt(out, x, y) > 0.25);
    expect(both).toEqual(mesh);
  });

  it('keeps the mask beside the cut', () => {
    const h = hollow((r) => (r < 12 ? 0 : 20));
    const mask = new Uint8Array(N * N);
    mask[40 * N + 40] = 255;
    const out = new Uint8Array(N * N * 2);
    bakeShoreCut(h, N, N, 2, LEVEL, mask, out, { i0: 30, j0: 30, i1: 50, j1: 50 });
    expect(out[(40 * N + 40) * 2]).toBe(255);
    expect(out[(40 * N + 41) * 2]).toBe(0);
    // Far inside the water the cut is open
    expect(out[(40 * N + 40) * 2 + 1]).toBeGreaterThan(128);
  });
});
