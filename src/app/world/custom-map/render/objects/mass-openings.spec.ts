import { describe, expect, it } from 'vitest';
import type { MapMass, MapMassOpening } from '../../map-document';
import { massBodies, massContains, massProblem } from '../../object-mass';
import { massShape } from './mass-shape';
import { FOUNDATION, WALL_ARCH, WALL_FACADE, WALL_PLAIN, WALL_REVEAL, WALL_WEDGE, type WallPiece } from './mass-openings';

/** A house 20 m along x, 10 m deep, a way straight through it across its depth at x = 4 */
const passage: MapMassOpening = { line: [4, -6, 4, 6], width: 3, height: 3.5, kind: 'passage', head: 'flat' };
const house = (openings: MapMassOpening[], over: Partial<MapMass> = {}): MapMass => ({
  rings: [[-10, -5, 10, -5, 10, 5, -10, 5]],
  height: 12,
  floors: 4,
  roof: 'flat',
  facade: 'plaster',
  openings,
  ...over,
});

const facades = (walls: readonly WallPiece[]) => walls.filter((w) => w.kind === WALL_FACADE && !w.corner && w.top > 0 && w.bottom < 12 && w.band > 0.5);
/** The pieces of the wall whose outward normal is (nx, nz) */
const wallOf = (walls: readonly WallPiece[], nx: number, nz: number) => facades(walls).filter((w) => Math.abs(w.nx - nx) < 1e-6 && Math.abs(w.nz - nz) < 1e-6);
/** Corner, edges and normal of a wedge: (e1 x e2) . n > 0, so the quad faces its normal */
const facesItsNormal = (w: WallPiece) => {
  const [ux, uy, uz] = w.e1!;
  const [vx, vy, vz] = w.e2!;
  return (uy * vz - uz * vy) * w.nx + (uz * vx - ux * vz) * (w.ny ?? 0) + (ux * vy - uy * vx) * w.nz > 0;
};

describe('mass openings: a way through a raised building', () => {
  it('stands the walls it crosses in pieces round it, the windows laid out over the whole wall', () => {
    const shape = massShape(house([passage]));
    for (const nz of [-1, 1]) {
      const pieces = wallOf(shape.walls, 0, nz);
      // Beside it the whole height, over it the lintel up to the parapet
      expect(pieces.length).toBe(3);
      for (const p of pieces) {
        expect(p.wallLength).toBeCloseTo(20);
        // The opening's middle, metres along the whole wall: where the way crosses it
        expect(p.sx + p.ax * (p.cut!.mid - p.u0!)).toBeCloseTo(4);
        expect(p.cut?.half).toBeCloseTo(1.5);
      }
      const lintel = pieces.find((p) => p.bottom > 0)!;
      expect(lintel.bottom).toBeCloseTo(3.5);
      expect(lintel.length).toBeCloseTo(3);
      expect(lintel.lift).toBeCloseTo(-3.5);
      const whole = pieces.filter((p) => p.bottom < 0);
      expect(whole.map((p) => p.length).reduce((a, b) => a + b, 0)).toBeCloseTo(17);
      for (const p of whole) expect(p.bottom).toBe(-FOUNDATION);
    }
    // The walls it does not cross stand whole
    expect(wallOf(shape.walls, 1, 0).length).toBe(1);
    expect(wallOf(shape.walls, 1, 0)[0].cut).toBeUndefined();
  });

  it('draws its inside: two reveals facing in, the ceiling facing down, on the ground under the building', () => {
    const mass = house([passage]);
    const shape = massShape(mass);
    const reveals = shape.walls.filter((w) => w.kind === WALL_REVEAL);
    expect(reveals.length).toBe(2);
    for (const r of reveals) {
      expect(r.length).toBeCloseTo(10);
      expect(r.top).toBeCloseTo(3.5);
      // Facing the way's middle
      const mx = r.sx + (r.ax * r.length) / 2;
      expect(Math.sign(4 - mx)).toBe(Math.sign(r.nx));
      expect(Math.abs(mx - 4)).toBeCloseTo(1.5);
    }
    const ceiling = shape.walls.filter((w) => w.kind === WALL_WEDGE);
    expect(ceiling.length).toBe(2);
    for (const c of ceiling) {
      expect(c.ny).toBeCloseTo(-1);
      expect(c.corner![1]).toBeCloseTo(3.5);
      expect(facesItsNormal(c)).toBe(true);
    }
    // The ceiling covers the way under the building: 3 m by 10 m
    const area = ceiling.reduce((s, c) => {
      const [ux, , uz] = c.e1!;
      const [vx, , vz] = c.e2!;
      return s + Math.abs(ux * vz - uz * vx) / 2;
    }, 0);
    expect(area).toBeCloseTo(30);
    expect(massContains(mass, 4, 0)).toBe(true);
    // No back wall: the way runs on through
    expect(shape.walls.filter((w) => w.kind === WALL_PLAIN && Math.abs(w.nz) > 0.9 && w.top < 5).length).toBe(0);
  });

  it('heads a stone gateway with a round arch: the arch a piece of its own, a vault of five facets inside', () => {
    const arch: MapMassOpening = { ...passage, width: 4, height: 5, head: 'arch' };
    const shape = massShape(house([arch], { facade: 'stone' }));
    const heads = shape.walls.filter((w) => w.kind === WALL_ARCH);
    expect(heads.length).toBe(2);
    for (const a of heads) {
      // From the springing (crown less half the width) to the crown
      expect(a.bottom).toBeCloseTo(3);
      expect(a.top).toBeCloseTo(5);
      expect(a.cut?.rise).toBeCloseTo(2);
    }
    const vault = shape.walls.filter((w) => w.kind === WALL_WEDGE);
    expect(vault.length).toBe(10);
    for (const v of vault) {
      expect(facesItsNormal(v)).toBe(true);
      // Down and in, never up
      expect(v.ny!).toBeLessThan(0);
    }
    // The reveals reach a little over the springing, where the vault's first facet starts
    for (const r of shape.walls.filter((w) => w.kind === WALL_REVEAL)) expect(r.top).toBeCloseTo(3 + 2 * Math.tan(Math.PI / 12));
  });

  it("ends a car park's entrance at a dark back wall a few metres in, its walls down to its floor", () => {
    const garage: MapMassOpening = { line: [4, -6, 4, -3], width: 4, height: 0.2, kind: 'garage', head: 'flat', floor: -2.2 };
    const shape = massShape(house([garage]));
    const back = shape.walls.filter((w) => w.kind === WALL_PLAIN && w.nz < -0.9 && w.top < 1);
    expect(back.length).toBe(1);
    expect(back[0].shade!).toBeLessThan(0.1);
    // At the stub's end, facing the way in
    expect(back[0].sz).toBeCloseTo(-3);
    const front = wallOf(shape.walls, 0, -1);
    expect(front.length).toBe(3);
    for (const p of front.filter((w) => w.bottom < 0)) expect(p.bottom).toBeCloseTo(-2.6);
    // The far wall stays whole
    expect(wallOf(shape.walls, 0, 1).length).toBe(1);
    for (const r of shape.walls.filter((w) => w.kind === WALL_PLAIN && Math.abs(w.nx) > 0.9 && w.top < 1)) expect(r.shade!).toBeLessThan(0.2);
  });

  it('opens the reveals of two ways that cross inside into each other', () => {
    const across: MapMassOpening = { line: [-11, 0, 11, 0], width: 3, height: 3.5, kind: 'passage', head: 'flat' };
    const shape = massShape(house([passage, across]));
    const reveals = shape.walls.filter((w) => w.kind === WALL_REVEAL);
    // Each of the four reveals in two, either side of the other way
    expect(reveals.length).toBe(8);
    for (const r of reveals) {
      const a = { x: r.sx, z: r.sz };
      const b = { x: r.sx + r.ax * r.length, z: r.sz + r.az * r.length };
      // No reveal stands in the other way
      if (Math.abs(r.nx) > 0.9) expect(Math.min(Math.abs(a.z), Math.abs(b.z))).toBeGreaterThanOrEqual(1.5 - 1e-6);
      else expect(Math.min(Math.abs(a.x - 4), Math.abs(b.x - 4))).toBeGreaterThanOrEqual(1.5 - 1e-6);
    }
  });

  it('cuts the parts on the ground it crosses, its inside drawn once, by the part over it', () => {
    const mass = house([passage], {
      parts: [
        { rings: [[-10, -5, 0, -5, 0, 5, -10, 5]], height: 12, floors: 4, roof: 'flat' },
        { rings: [[0, -5, 10, -5, 10, 5, 0, 5]], height: 9, floors: 3, roof: 'flat' },
        { rings: [[2, -2, 6, -2, 6, 2, 2, 2]], base: 9, height: 14, floors: 4, roof: 'flat' },
      ],
    });
    const bodies = massBodies(mass);
    expect(bodies.map((b) => b.hosts?.length)).toEqual([0, 1, 0]);
    const lower = massShape(bodies[1]);
    expect(lower.walls.filter((w) => w.kind === WALL_REVEAL).length).toBe(2);
    expect(wallOf(lower.walls, 0, -1).length).toBe(3);
    expect(massShape(bodies[0]).walls.filter((w) => w.kind === WALL_REVEAL).length).toBe(0);
    // The tower on the roof stands over it whole
    expect(massShape(bodies[2]).walls.filter((w) => w.cut).length).toBe(0);
  });

  it('ends a way that runs into another inside without a back wall', () => {
    const across: MapMassOpening = { line: [-11, 0, 11, 0], width: 3, height: 3.5, kind: 'passage', head: 'flat' };
    const into: MapMassOpening = { line: [4, -6, 4, 0.5], width: 3, height: 3.5, kind: 'passage', head: 'flat' };
    const shape = massShape(house([across, into]));
    expect(shape.walls.filter((w) => w.kind === WALL_PLAIN && Math.abs(w.nz) > 0.9 && w.top < 5).length).toBe(0);
    // Alone it ends at one
    expect(massShape(house([{ ...into }])).walls.filter((w) => w.kind === WALL_PLAIN && Math.abs(w.nz) > 0.9 && w.top < 5).length).toBe(1);
  });

  it("opens a part's wall that stands a little past the building's ground, its inside reaching out to it", () => {
    // OSM's part reaches 0.8 m past the outline on the far side
    const mass = house([passage], { parts: [{ rings: [[-10, -5, 10, -5, 10, 5.8, -10, 5.8]], height: 12, floors: 4, roof: 'flat' }] });
    const shape = massShape(massBodies(mass)[0]);
    expect(wallOf(shape.walls, 0, 1).length).toBe(3);
    for (const r of shape.walls.filter((w) => w.kind === WALL_REVEAL)) expect(r.length).toBeCloseTo(10.8);
  });

  it('is checked like the rest of a raised building', () => {
    expect(massProblem(house([passage]))).toBeNull();
    expect(massProblem(house([{ ...passage, width: 0.1 }]))?.key).toBe('massOpenings');
    expect(massProblem(house([{ ...passage, kind: 'door' as never }]))?.key).toBe('massOpenings');
    expect(massProblem(house([{ ...passage, line: [1, 1, 1, 1] }]))?.key).toBe('massOpenings');
    expect(massProblem(house([{ ...passage, floor: 2 }]))?.key).toBe('massOpenings');
    expect(massProblem(house([]))?.key).toBe('massOpenings');
  });
});
