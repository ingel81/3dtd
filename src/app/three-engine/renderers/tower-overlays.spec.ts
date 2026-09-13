import { describe, it, expect } from 'vitest';
import { BufferGeometry, CircleGeometry, Line, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { createLosRing, createRangeIndicator, createTipMarker } from './tower-overlays';

const fill = new MeshBasicMaterial();

describe('createRangeIndicator', () => {
  it('lies flat half a metre above the tower without a terrain probe', () => {
    const indicator = createRangeIndicator(30, new Vector3(5, 10, 7), fill, null);
    const [disc, edge] = indicator.children as Mesh[];

    expect(indicator.position.toArray()).toEqual([5, 10.5, 7]);
    expect(disc.geometry).toBeInstanceOf(CircleGeometry);
    expect(disc.material).toBe(fill);
    expect(edge.geometry).toBeInstanceOf(RingGeometry);
    expect((edge.geometry as RingGeometry).parameters).toMatchObject({ innerRadius: 28, outerRadius: 30 });
  });

  it('follows the terrain the probe reports, disc 1.5 m and edge 2 m above it', () => {
    // A slope rising 0.1 m per metre towards +x.
    const indicator = createRangeIndicator(20, new Vector3(0, 0, 0), fill, (x) => x * 0.1);
    const [disc, edge] = indicator.children as [Mesh, Line];

    const vertices = disc.geometry.getAttribute('position');
    expect(vertices.count).toBe(1 + 8 * 48);
    expect(vertices.getY(0)).toBeCloseTo(1.5, 9);
    expect(vertices.getY(8 * 48)).toBeCloseTo(vertices.getX(8 * 48) * 0.1 + 1.5, 5);

    const edgePoints = edge.geometry.getAttribute('position');
    expect(edgePoints.count).toBe(48 + 1); // closed loop
    expect(edgePoints.getY(0)).toBeCloseTo(20 * 0.1 + 2, 5);
  });

  it('keeps a flat disc where the centre has no ground and leaves out edge points without ground', () => {
    // No ground at the centre, nor on the east half of the edge.
    const probe = (x: number, z: number) => (Math.hypot(x, z) < 1 || x > 0 ? null : 0);
    const indicator = createRangeIndicator(20, new Vector3(0, 0, 0), fill, probe);
    const [disc, edge] = indicator.children as [Mesh, Line];
    expect(disc.geometry).toBeInstanceOf(CircleGeometry);
    expect((edge.geometry as BufferGeometry).getAttribute('position').count).toBeLessThan(49);
  });
});

describe('tower debug markers', () => {
  it('puts the tip marker and the LOS ring at the shoot height, drawn on top', () => {
    const tip = createTipMarker(1, 12, 3, true);
    const ring = createLosRing(1, 12, 3, 2.4, false);

    expect(tip.position.toArray()).toEqual([1, 12, 3]);
    expect(tip.visible).toBe(true);
    expect(ring.position.toArray()).toEqual([1, 12, 3]);
    expect(ring.visible).toBe(false);
    expect([tip.renderOrder, ring.renderOrder]).toEqual([999, 999]);
    expect(ring.geometry.getAttribute('position').getX(0)).toBeCloseTo(2.4, 6);
  });
});
