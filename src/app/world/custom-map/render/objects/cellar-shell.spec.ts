import { BoxGeometry, BufferAttribute, BufferGeometry, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_CELLAR_STOREYS } from '../../object-cellar';
import type { ModelPart } from '../map-asset-library';
import { cellarShell } from './cellar-shell';

const part = (name: string, geometry: BufferGeometry): ModelPart => ({ geometry, material: new MeshStandardMaterial({ name }) });

/**
 * A house of 10 by 8 m: its plinth from 1 m under the floor to 0.45 m over it, 4 cm proud of the wall, the wall
 * up to 6 m, two windows on its front (+z) and one on its back, frames, a door
 */
function house(): ModelPart[] {
  return [
    part('plinth-concrete', new BoxGeometry(10.08, 1.45, 8.08).translate(0, -0.275, 0)),
    part('plaster', new BoxGeometry(10, 5.55, 8).translate(0, 0.45 + 2.775, 0)),
    part('window-glass', new BoxGeometry(1.1, 1.3, 0.02).translate(-2.5, 1.9, 3.98).toNonIndexed()),
    part('window-glass', new BoxGeometry(1.1, 1.3, 0.02).translate(2.5, 1.9, 3.98).toNonIndexed()),
    part('window-glass', new BoxGeometry(1.1, 1.3, 0.02).translate(0, 1.9, -3.98).toNonIndexed()),
    part('frame-white', new BoxGeometry(1.2, 1.4, 0.06).translate(-2.5, 1.9, 3.95)),
    part('door-oak', new BoxGeometry(1.1, 2.1, 0.06).translate(0, 1.5, 3.95)),
  ];
}

const cellarOf = (p: ModelPart) => p.geometry.getAttribute('aCellar') as BufferAttribute;

describe('cellar-shell: a building model\'s cellar from its foot', () => {
  it('marks the vertices of its plinth\'s foot, with the texture running on down; the wall over it stays', () => {
    const parts = cellarShell(house());
    const plinth = parts[0];
    const pos = plinth.geometry.getAttribute('position');
    const c = cellarOf(plinth);
    let feet = 0;
    for (let i = 0; i < pos.count; i++) {
      const foot = Math.abs(pos.getY(i) + 1) < 1e-6;
      expect(c.getX(i)).toBe(foot ? 1 : 0);
      if (!foot) continue;
      feet++;
      // On an upright side the texture's v runs down by 1 / 1.45 a metre (BoxGeometry: 0 at the foot, 1 at the top)
      const n = plinth.geometry.getAttribute('normal');
      if (Math.abs(n.getY(i)) < 0.5) expect(c.getZ(i)).toBeCloseTo(-1 / 1.45, 5);
    }
    // Four sides of two foot corners and the bottom's four
    expect(feet).toBe(12);
    const wall = cellarOf(parts[1]);
    for (let i = 0; i < wall.count; i++) expect(wall.getX(i)).toBe(0);
  });

  it('opens the plinth\'s top over the ground: only its ledge before the wall stays, the cellar under it open to a hole', () => {
    const [plinth] = cellarShell(house());
    const g = plinth.geometry;
    const pos = g.getAttribute('position');
    const index = g.getIndex()!;
    let area = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => [pos.getX(index.getX(i + j)), pos.getY(index.getX(i + j)), pos.getZ(index.getX(i + j))]);
      if ([a, b, c].some((p) => Math.abs(p[1] - 0.45) > 1e-4)) continue;
      // Facing up, its area
      const cross = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(cross).toBeGreaterThan(0);
      area += cross / 2;
    }
    // The ring between the plinth's face and the wall's: 10.08 x 8.08 less 10 x 8
    expect(area).toBeCloseTo(10.08 * 8.08 - 10 * 8, 4);
  });

  it('adds a cellar window under each window of the ground floor, in every storey, and a door on each wall with one', () => {
    const before = house();
    const parts = cellarShell(before);
    const added = (k: number) => parts[k].geometry.getAttribute('position').count - before[k].geometry.getAttribute('position').count;
    // Three windows (two at the front, one at the back): their glass in the first glass part, their frames and the
    // doors' frames in the frame part, two doors (the front's and the back's middle window) in the door part
    expect(added(2)).toBe(3 * MAX_CELLAR_STOREYS * 6);
    expect(added(5)).toBe((3 + 2) * MAX_CELLAR_STOREYS * 6);
    expect(added(6)).toBe(2 * MAX_CELLAR_STOREYS * 6);
    const glass = parts[2].geometry;
    const pos = glass.getAttribute('position');
    const c = cellarOf(parts[2]);
    const n = before[2].geometry.getAttribute('position').count;
    const kinds = new Set<number>();
    for (let i = n; i < pos.count; i += 6) {
      // Its corners on one point (drawn nothing until the shader opens it), on the plinth's face at the front or back
      for (let k = 1; k < 6; k++) expect(pos.getX(i + k)).toBe(pos.getX(i));
      expect(Math.abs(pos.getZ(i))).toBeCloseTo(4.04 + 0.025, 5);
      expect(pos.getY(i)).toBeCloseTo(-0.35, 5);
      kinds.add(c.getX(i));
      expect(c.getW(i)).toBeGreaterThanOrEqual(0);
      expect(c.getW(i)).toBeLessThan(MAX_CELLAR_STOREYS);
    }
    // Windows, and the windows where a door may open instead
    expect([...kinds].sort()).toEqual([2, 2.5]);
  });

  it('leaves a model standing over its floor as it is: no foot, no cellar', () => {
    const shed = [part('plaster', new BoxGeometry(4, 3, 4).translate(0, 1.6, 0))];
    const [p] = cellarShell(shed);
    expect(p.geometry.getAttribute('position').count).toBe(shed[0].geometry.getAttribute('position').count);
    expect(Array.from(cellarOf(p).array).every((v) => v === 0)).toBe(true);
  });

  it('splits a foot vertex two faces of other texture directions share, each running on its own way', () => {
    // Two upright faces meeting at the corner (0, -1, 0): on the one along x the texture's v runs up, on the one along z its u
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 2, -1, 0, 2, 1, 0, 0, 1, 0, 0, -1, -2, 0, 1, -2]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(18).fill(0), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 0, 5]);
    const [p] = cellarShell([part('plaster', g)]);
    const c = cellarOf(p);
    const pos = p.geometry.getAttribute('position');
    // The shared corner twice now, each with its face's direction
    expect(pos.count).toBe(7);
    const gradients = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) + 1) > 1e-6) continue;
      expect(c.getX(i)).toBe(1);
      gradients.add(`${c.getY(i).toFixed(3)},${c.getZ(i).toFixed(3)}`);
    }
    expect(gradients).toEqual(new Set(['0.000,-0.500', '-0.500,0.000']));
    // Every corner of the second face that was the shared one names the copy
    const index = p.geometry.getIndex()!;
    const second = [6, 7, 8].map((k) => index.getX(k));
    expect(second).not.toContain(0);
  });
});
