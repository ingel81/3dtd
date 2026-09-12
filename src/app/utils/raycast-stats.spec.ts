import { describe, it, expect, vi, afterEach } from 'vitest';
import { Object3D, Raycaster, type Intersection } from 'three';
import { RaycastStats, instrumentRaycasts } from './raycast-stats';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RaycastStats', () => {
  it('books rays on the outermost caller and falls back to unscoped', () => {
    const stats = new RaycastStats();
    const outer = stats.enter('streets');
    const inner = stats.enter('heightAtGeo');
    stats.record(0, 2, 1);
    stats.exit(inner);
    stats.record(10, 11, 1);
    stats.exit(outer);
    stats.record(20, 23, 0);

    const rows = stats.rows();
    expect(rows.map((r) => [r.caller, r.calls, r.totalMs])).toEqual([
      ['streets', 2, 3],
      ['unscoped', 1, 3],
    ]);
    expect(rows[0].maxMs).toBe(2);
    expect(rows[0].avgMs).toBe(1.5);
    expect(rows[0].hitsPerCall).toBe(1);
  });

  it('sums back-to-back rays into bursts and keeps the longest', () => {
    const stats = new RaycastStats();
    const scope = stats.enter('routeGrid');
    // Three rays with 1 ms gaps: one burst of 6 ms.
    stats.record(0, 2, 1);
    stats.record(3, 5, 1);
    stats.record(6, 8, 1);
    // 10 ms later: a new burst.
    stats.record(18, 19, 1);
    stats.exit(scope);

    const [row] = stats.rows();
    expect(row.maxBurstMs).toBe(6);
    expect(row.totalMs).toBe(7);
  });

  it('starts over on reset', () => {
    const stats = new RaycastStats();
    stats.record(0, 1, 0);
    stats.reset();
    expect(stats.rows()).toEqual([]);
  });
});

describe('instrumentRaycasts', () => {
  it('times the raycast, counts its hits and hands on its result', () => {
    const stats = new RaycastStats();
    const group = new Object3D();
    // TilesGroup.raycast returns false to stop three from walking the tile scenes again.
    group.raycast = ((_raycaster: Raycaster, intersects: Intersection[]) => {
      intersects.push({ distance: 1 } as Intersection, { distance: 2 } as Intersection);
      return false;
    }) as Object3D['raycast'];
    const child = new Object3D();
    const childRaycast = vi.spyOn(child, 'raycast');
    group.add(child);

    instrumentRaycasts(group, stats);
    const hits = new Raycaster().intersectObject(group, true);

    expect(hits).toHaveLength(2);
    expect(childRaycast).not.toHaveBeenCalled();
    const [row] = stats.rows();
    expect(row.caller).toBe('unscoped');
    expect(row.calls).toBe(1);
    expect(row.hitsPerCall).toBe(2);
  });
});
