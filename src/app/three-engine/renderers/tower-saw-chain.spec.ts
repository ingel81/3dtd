import { describe, it, expect } from 'vitest';
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { ChainLoop, chainLinkGeometry, chainlessGeometry, type SawBar } from './tower-saw-chain';

const BAR: SawBar = { from: [0, 0, 0.3], to: [0, 0, 0.7], normal: [1, 0, 0] };

describe('ChainLoop', () => {
  it('closes on itself and keeps its links on the bar, the housing side not drawn', () => {
    const loop = new ChainLoop(BAR);
    expect(loop.pitch * loop.links).toBeCloseTo(loop.perimeter, 9);
    const a = new Matrix4();
    const b = new Matrix4();
    // Out along the edge: a link at the bar's middle, 0.09 off its middle line in the bar's plane
    expect(loop.place(0.12 + 0.2, false, 1, a)).toBe(true);
    const p = new Vector3().setFromMatrixPosition(a);
    expect(p.x).toBeCloseTo(0, 9);
    expect(Math.abs(p.y)).toBeCloseTo(0.09, 9);
    expect(p.z).toBeCloseTo(0.5, 9);
    // Once round, the same frame
    loop.place(0.32 + loop.perimeter, false, 1, b);
    expect(new Vector3().setFromMatrixPosition(b).distanceTo(p)).toBeLessThan(1e-9);
    // The back turn sits in the housing
    expect(loop.place(-0.05, false, 1, a)).toBe(false);
    // A turned link: its run and face reversed, still a rotation (no mirror)
    loop.place(0.32, true, 1, b);
    expect(b.determinant()).toBeCloseTo(1, 9);
    // Stretched along the run for the blur
    loop.place(0.32, false, 2, a);
    expect(a.determinant()).toBeCloseTo(2, 9);
  });

  it('builds one link with a steel strap and an orange cutter', () => {
    const geometry = chainLinkGeometry();
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.getAttribute('color')).toBeDefined();
    geometry.dispose();
  });
});

describe('chainlessGeometry', () => {
  it('presses the modelled teeth into the bar past the housing, once per source geometry', () => {
    const source = new BufferGeometry();
    source.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0.13, 0.5, // a tooth on the edge
      0, 0, 0.82, // a tooth on the nose
      0, 0.13, 0.2, // the housing, left alone
      0.02, 0.05, 0.5, // the bar's face, left alone
    ]), 3));
    source.setAttribute('uv', new BufferAttribute(new Float32Array(8), 2));
    const flat = chainlessGeometry(source, BAR);
    const p = new Vector3();
    p.fromBufferAttribute(flat.getAttribute('position'), 0);
    expect(p.y).toBeCloseTo(0.085, 6);
    p.fromBufferAttribute(flat.getAttribute('position'), 1);
    expect(p.z).toBeCloseTo(0.785, 6);
    p.fromBufferAttribute(flat.getAttribute('position'), 2);
    expect(p.y).toBeCloseTo(0.13, 6);
    p.fromBufferAttribute(flat.getAttribute('position'), 3);
    expect(p.toArray()).toEqual([0.019999999552965164, 0.05000000074505806, 0.5]);
    // The other attributes are the source's, the source untouched
    expect(flat.getAttribute('uv')).toBe(source.getAttribute('uv'));
    expect(source.getAttribute('position').getY(0)).toBeCloseTo(0.13, 6);
    expect(chainlessGeometry(source, BAR)).toBe(flat);
  });
});
