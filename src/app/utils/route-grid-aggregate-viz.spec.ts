import { describe, expect, it } from 'vitest';
import { InstancedBufferAttribute, InstancedMesh, Matrix4, ShaderMaterial } from 'three';
import { RouteGridAggregateViz, overlayCellKind } from './route-grid-aggregate-viz';
import type { RouteCell } from './route-cell';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

/** A cell at (x, 0), sampled at 5 m unless told otherwise. */
function cell(
  key: number,
  x: number,
  opts: { sampled?: boolean; surface?: RouteCell['surface']; centre?: boolean } = {},
): RouteCell {
  const sampled = opts.sampled ?? true;
  return {
    key,
    x,
    z: 0,
    // The centre line runs through the cell, or 2 m beside it.
    axisX: opts.centre ? x : x + 2,
    axisZ: 0,
    terrainHeight: sampled ? 5 : 0,
    surface: opts.surface ?? 'ground',
    tunnelSpan: null,
    onApproach: null,
    routeAnchorY: 0,
    sample: {
      state: sampled ? 'stable' : 'unsampled',
      sampledAt: 0,
      tileDepth: sampled ? 20 : 0,
      tileGeometricError: sampled ? 2 : Infinity,
    },
    heightSampled: sampled,
    enemies: new Set(),
    towerVisibility: new Map(),
    airVisibility: new Map(),
  };
}

/**
 * The Route Grid Overlay is the tool for telling missing cells apart from
 * cells a tower's LOS display does not draw, so it has to draw every cell
 * and show what state each one is in.
 */
describe('RouteGridAggregateViz', () => {
  const cells = new Map<number, RouteCell>([
    [1, cell(1, 1, { centre: true })],
    [2, cell(2, 3, { surface: 'tunnel' })],
    [3, cell(3, 5, { surface: 'deck' })],
    [4, cell(4, 7, { sampled: false })],
  ]);
  /** The grid's estimate for a cell without a sample; 7 m here. */
  const viz = () => new RouteGridAggregateViz(cells, 2, (c) => (c.heightSampled ? c.terrainHeight : 7));

  const yOf = (mesh: InstancedMesh, i: number) => {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    return m.elements[13];
  };
  const attribute = (mesh: InstancedMesh, name: string) =>
    Array.from((mesh.geometry.getAttribute(name) as InstancedBufferAttribute).array).slice(0, mesh.count);

  it('draws every cell, the ones without a height sample too, at the height it is given', () => {
    const mesh = viz().createVisualization();
    expect(mesh.count).toBe(4);
    expect(yOf(mesh, 0)).toBeCloseTo(5.05, 6);
    // Unsampled: the neighbours' estimate, not the route anchor at 0.
    expect(yOf(mesh, 3)).toBeCloseTo(7.05, 6);

    const air = viz().createAirVisualization();
    expect(air.count).toBe(4);
    expect(yOf(air, 3)).toBeCloseTo(7 + LOS_VIZ_CONFIG.airSampleYOffset, 6);
  });

  it('marks the state of each cell for its outline', () => {
    // Centre line + sampled, tunnel, deck, unsampled.
    expect(attribute(viz().createVisualization(), 'aCellKind')).toEqual([8, 3, 1, 2]);
  });

  it('keeps the coverage buffer aligned with every cell', () => {
    cells.get(4)!.towerVisibility.set('t1', true);
    try {
      expect(attribute(viz().createVisualization(), 'aCellState')).toEqual([0, 0, 0, 1]);
    } finally {
      cells.get(4)!.towerVisibility.clear();
    }
  });

  it('draws the outline in the shader, with the log depth chunks', () => {
    const material = viz().createVisualization().material as ShaderMaterial;
    expect(material.vertexShader).toContain('logdepthbuf_vertex');
    expect(material.fragmentShader).toContain('logdepthbuf_fragment');
    expect(material.fragmentShader).toContain('fwidth(toEdge)');
    expect(material.uniforms['uHalfSize'].value).toBeCloseTo(LOS_VIZ_CONFIG.gridOverlay.plateScale, 6);
  });
});

describe('overlayCellKind', () => {
  it('puts a missing sample before anything else, then deck or tunnel', () => {
    expect(overlayCellKind(cell(1, 0, { sampled: false, surface: 'deck' }))).toBe(2);
    expect(overlayCellKind(cell(1, 0, { sampled: false, surface: 'tunnel' }))).toBe(2);
    expect(overlayCellKind(cell(1, 0, { surface: 'deck' }))).toBe(1);
    expect(overlayCellKind(cell(1, 0, { surface: 'approach' }))).toBe(1);
    expect(overlayCellKind(cell(1, 0, { surface: 'tunnel' }))).toBe(3);
    expect(overlayCellKind(cell(1, 0))).toBe(0);
  });

  it('adds 8 on the centre line, which the shader takes off again', () => {
    expect(overlayCellKind(cell(1, 0, { surface: 'deck', centre: true }))).toBe(9);
    expect(overlayCellKind(cell(1, 0, { surface: 'tunnel', centre: true }))).toBe(11);
  });
});
