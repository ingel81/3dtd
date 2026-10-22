import { describe, expect, it } from 'vitest';
import { BufferAttribute, Vector3 } from 'three';
import type { MapRiver } from '../../map-document';
import { riverNetwork, type RiverGround } from '../../../../map-ops/river-network';
import { HeightField } from '../height-field';
import { HeightTexture } from '../terrain/height-texture';
import { RiverSurface } from './river-surface';
import { WALL_FOOT } from './water-walls';

/** 101 x 101 samples of 2 m, flat at 0; a straight river west to east, its surface at `height` */
function river(height: number, xs = [-60, -20, 20, 60]) {
  const n = 101;
  const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 200, 200);
  const r: MapRiver = { id: 'r', kind: 'water', points: xs.map((x) => ({ x, y: 0, width: 6, height })) };
  const ground: RiverGround = { grid: field.grid, width: 200, depth: 200, rivers: [r], water: null, waterBodies: [] };
  return new RiverSurface(field, new HeightTexture(field), r, ground, riverNetwork(ground), 0);
}

/** The wall vertices of a geometry: position and the surface over each */
function walls(s: RiverSurface) {
  const g = s.mesh.geometry;
  const wall = g.getAttribute('aWall') as BufferAttribute;
  const pos = g.getAttribute('position') as BufferAttribute;
  const out: { p: Vector3; top: number }[] = [];
  for (let k = 0; k < wall.count; k++) if (wall.getX(k) > 0.5) out.push({ p: new Vector3().fromBufferAttribute(pos, k), top: wall.getY(k) });
  return { out, g, pos };
}

describe('RiverSurface walls', () => {
  it('hangs walls only across an end at the border, down past the ground, facing out of the map; none along its sides', () => {
    const s = river(1.5, [-99, -20, 20, 99]);
    const { out, g, pos } = walls(s);
    expect(out.length).toBeGreaterThan(0);
    for (const w of out) {
      expect(w.top).toBeLessThanOrEqual(1.5 + 1e-5);
      expect([w.top, Math.min(0, w.top) - WALL_FOOT].some((h) => Math.abs(w.p.y - h) < 1e-4)).toBe(true);
      // At an end (scene x is map -x), never along a side
      expect(Math.abs(w.p.x)).toBeGreaterThan(95);
    }
    const index = g.index!;
    const wallAttr = g.getAttribute('aWall') as BufferAttribute;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let checked = 0;
    for (let t = 0; t < index.count; t += 3) {
      if (wallAttr.getX(index.getX(t)) < 0.5) continue;
      a.fromBufferAttribute(pos, index.getX(t));
      b.fromBufferAttribute(pos, index.getX(t + 1));
      c.fromBufferAttribute(pos, index.getX(t + 2));
      const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      expect(normal.x * Math.sign(a.x)).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
    s.dispose();
  });

  it('runs out where it ends on the map, its surface down to the bed, with no wall across its end; at the border it keeps one', () => {
    const inside = river(1.5);
    const pos = inside.mesh.geometry.getAttribute('position') as BufferAttribute;
    // The first row (the river's start): sunk under the ground
    for (let c = 0; c <= 8; c++) expect(pos.getY(c)).toBeLessThan(0);
    expect(walls(inside).out).toHaveLength(0);
    inside.dispose();
    const border = river(1.5, [-99, -20, 20, 99]);
    expect(walls(border).out.some((w) => Math.abs(w.p.z) < 2.9)).toBe(true);
    border.dispose();
  });

  it('hangs none where the banks stand over its surface', () => {
    const s = river(-0.3);
    expect(walls(s).out).toHaveLength(0);
    s.dispose();
  });

  it('closes a stretch a crater cut off with a wall across each end, and opens again when it is gone', () => {
    const s = river(1.5);
    s.setCraters([{ gone: [40, 70], from: 70, dry: 0, filled: 0, sink: 0, lake: 0.5 }]);
    const cuts = s.mesh.children[0] as RiverSurface['mesh'];
    expect(cuts).toBeDefined();
    const along = cuts.geometry.getAttribute('aAlong') as BufferAttribute;
    const places = new Set(Array.from({ length: along.count }, (_, k) => along.getX(k).toFixed(2)));
    expect([...places].sort()).toEqual(['39.99', '70.01']);
    // The same cut again builds nothing new; none left takes the walls away
    s.setCraters([{ gone: [40, 70], from: 70, dry: 0, filled: 0, sink: 0, lake: 1 }]);
    expect(s.mesh.children[0]).toBe(cuts);
    s.setCraters([]);
    expect(s.mesh.children).toHaveLength(0);
    s.dispose();
  });
});
