import { describe, it, expect, vi } from 'vitest';
import { Vector2, Vector3, Vector4, type WebGLRenderer } from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { groundCirclePositions, SpawnDistanceRings, type RingGround } from './spawn-distance-rings';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

const HQ = { lat: 48.9, lon: 9.2 };
const HQ_GROUND = 240;

/**
 * Metres east as +X, north as +Z around the HQ, the ground rising 1 m per
 * 100 m east; no tile west of 100 m.
 */
function ground(): RingGround {
  const toLocal = (lat: number, lon: number, height: number) => new Vector3(
    (lon - HQ.lon) * METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD),
    height,
    (lat - HQ.lat) * METERS_PER_DEGREE_LAT,
  );
  return {
    sync: { geoToLocalSimple: toLocal },
    getTerrainHeightAtGeo: (lat, lon) => {
      const x = toLocal(lat, lon, 0).x;
      return x < -100 ? null : HQ_GROUND + x / 100;
    },
  };
}

/** The flat positions as points. */
function points(positions: number[]): Vector3[] {
  const result: Vector3[] = [];
  for (let i = 0; i < positions.length; i += 3) result.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
  return result;
}

describe('SpawnDistanceRings', () => {
  it('lays a ring at its radius around the HQ, closed, each point 2 m above the ground under it', () => {
    const ring = points(groundCirclePositions(ground(), HQ, 1500));

    expect(ring.at(-1)!.equals(ring[0])).toBe(true);
    for (const p of ring) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(1500, 6);
      if (p.x >= -100) expect(p.y).toBeCloseTo(HQ_GROUND + p.x / 100 + 2, 6);
    }
  });

  it("lays the points no tile answers for on the HQ's ground", () => {
    const west = points(groundCirclePositions(ground(), HQ, 200)).filter((p) => p.x < -100);

    expect(west.length).toBeGreaterThan(0);
    for (const p of west) expect(p.y).toBeCloseTo(HQ_GROUND + 2, 6);
  });

  it('draws each ring as a dashed line in its colour over a continuous dark halo, in pixels and over the houses', () => {
    const rings = new SpawnDistanceRings(ground(), HQ, [
      { radiusM: 200, color: 0xc96a3a },
      { radiusM: 1500, color: 0x22c55e },
    ]);

    const lines = rings.group.children as Line2[];
    expect(lines).toHaveLength(4);
    const [halo, line] = lines.map((l) => l.material as LineMaterial);
    expect(halo.dashed).toBe(false);
    expect(halo.color.getHex()).toBe(0x0b0f0c);
    expect(line.dashed).toBe(true);
    expect(line.color.getHex()).toBe(0xc96a3a);
    expect((lines[3].material as LineMaterial).color.getHex()).toBe(0x22c55e);
    for (const material of [halo, line]) {
      expect(material.worldUnits).toBe(false);
      expect(material.depthTest).toBe(false);
    }
    expect(halo.linewidth).toBeGreaterThan(line.linewidth);
    expect(lines[1].renderOrder).toBeGreaterThan(lines[0].renderOrder);

    // 48 dashes around the ring, whatever its radius: 2 pi r / 48 per period
    expect(line.dashSize + line.gapSize).toBeCloseTo((2 * Math.PI * 200) / 48, 0);
  });

  it('takes the canvas size before every draw, so the pixel width follows a resize from the next frame', () => {
    const rings = new SpawnDistanceRings(ground(), HQ, [{ radiusM: 200, color: 0xc96a3a }]);
    // After ThreeTilesEngine.resize(): renderer.setSize() set the viewport, in CSS px
    const renderer = { getViewport: (target: Vector4) => target.set(0, 0, 1280, 720) } as unknown as WebGLRenderer;

    const lines = rings.group.children as Line2[];
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      line.onBeforeRender(renderer);
      expect((line.material as LineMaterial).resolution.equals(new Vector2(1280, 720))).toBe(true);
    }
  });

  it('frees its lines on dispose', () => {
    const rings = new SpawnDistanceRings(ground(), HQ, [{ radiusM: 200, color: 0xc96a3a }]);
    const lines = [...rings.group.children] as Line2[];
    const disposed = lines.flatMap((l) => [vi.spyOn(l.geometry, 'dispose'), vi.spyOn(l.material, 'dispose')]);

    rings.dispose();

    for (const spy of disposed) expect(spy).toHaveBeenCalled();
    expect(rings.group.children).toHaveLength(0);
  });
});
