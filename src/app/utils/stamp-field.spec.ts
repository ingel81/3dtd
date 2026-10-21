import { StampField, craterStampOf, rubbleStampOf, STAMP_CELL_M, type ToLocal } from './stamp-field';
import { craterCm, rubbleLump } from '../map-ops/impact-stamp';
import { RUBBLE } from '../configs/destruction.config';
import { MAP_METERS_PER_DEGREE as K } from '../world/custom-map/map-document';
import type { RunStructure } from '../sim/protocol/run-rules';

/** The custom map frame at the equator: local x is the map's -x, z its y */
const local: ToLocal = (lat, lon, out) => {
  out.x = -lon * K;
  out.z = lat * K;
};
const SPAN = { minIx: -50, minIz: -50, maxIx: 50, maxIz: 50 };
/** The middle of the cell holding local `v` on one axis */
const mid = (v: number) => (Math.floor(v / STAMP_CELL_M) + 0.5) * STAMP_CELL_M;

describe('StampField (docs/DESTRUCTION_PLAN.md)', () => {
  it('sums the stamps per route cell, each from its shape at the cell middle', () => {
    const field = new StampField(SPAN);
    field.crater({ x: 10, z: 10, radius: 3, depthCm: 50 }, 1);
    const dx = mid(10.5) - 10;
    const dz = mid(9.2) - 10;
    expect(field.heightAt(10.5, 9.2)).toBe(craterCm(dx * dx + dz * dz, 3, 50) / 100);
    expect(field.heightAt(11, 11)).toBeLessThan(0);
    // A second one over it adds up
    field.crater({ x: 12, z: 10, radius: 3, depthCm: 50 }, 1);
    const both = craterCm((mid(11) - 10) ** 2 + (mid(11) - 10) ** 2, 3, 50) + craterCm((mid(11) - 12) ** 2 + (mid(11) - 10) ** 2, 3, 50);
    expect(field.heightAt(11, 11)).toBe(both / 100);
    // Off the field: nothing
    expect(field.heightAt(1000, 0)).toBe(0);
    expect(field.brakeAt(1000, 0)).toBe(1);
  });

  it('comes to the same cells in any order and back to flat when every stamp is taken away again', () => {
    const a = new StampField(SPAN);
    const b = new StampField(SPAN);
    const stamps = Array.from({ length: 30 }, (_, i) => ({ x: ((i * 37) % 80) - 40, z: ((i * 53) % 80) - 40, radius: 1 + (i % 5), depthCm: 10 + i * 3 }));
    for (const s of stamps) a.crater(s, 1);
    for (const s of [...stamps].reverse()) b.crater(s, 1);
    for (let x = -50; x < 50; x += 1.3) for (let z = -50; z < 50; z += 1.7) expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
    for (const s of stamps) a.crater(s, -1);
    for (let x = -50; x < 50; x += 1.3) for (let z = -50; z < 50; z += 1.7) expect(a.heightAt(x, z)).toBe(0);
  });

  it("heaps a fallen structure's rubble over its ground plan, and slows the enemies where it lies high enough", () => {
    const field = new StampField(SPAN);
    // A barn 8 m by 4 m at map (20, 10), turned a quarter: long along the map's y
    const barn: RunStructure = { id: 'barn', lat: 10 / K, lon: 20 / K, radius: 5, height: 6, hp: 100, box: [20, 10, 4, 2, Math.PI / 2] };
    const heap = rubbleStampOf(barn, local);
    expect(heap.peakCm).toBe(Math.round(600 * RUBBLE.heightShare));
    field.rubbleHeap(heap, 1);
    // Its middle at local (-20, 10): the top in the lumps of its patch (the cell middle (-21, 11) is map (21, 11)), slowing
    expect(field.heightAt(-20.5, 10.5)).toBe(Math.trunc(heap.peakCm * rubbleLump(21, 11)) / 100);
    expect(field.brakeAt(-20.5, 10.5)).toBe(RUBBLE.brake);
    // Turned: the long side runs along local z, 3 m out that way it stands higher than 3 m out across
    expect(field.heightAt(-20.5, 12.5)).toBeGreaterThan(field.heightAt(-22.5, 10.5));
    expect(field.heightAt(-22.5, 10.5)).toBeGreaterThan(0);
    // Far off: flat, full pace
    expect(field.heightAt(-20, 30)).toBe(0);
    expect(field.brakeAt(-20, 30)).toBe(1);
    // Without a ground plan: a disc of its radius times RUBBLE.spill
    const disc = rubbleStampOf({ ...barn, box: undefined }, local);
    expect(disc).toMatchObject({ x: -20, z: 10, coreX: 0, coreZ: 0, falloff: 5 * RUBBLE.spill, mapX: 20, mapY: 10 });
    // A crater dug into the heap keeps it slowing; taken away, the heap is as before
    const before = field.heightAt(-20.5, 10.5);
    const crater = craterStampOf(210, 110, 15, 30, local);
    field.crater(crater, 1);
    expect(field.heightAt(-20.5, 10.5)).toBeLessThan(before);
    expect(field.brakeAt(-20.5, 10.5)).toBe(RUBBLE.brake);
    field.crater(crater, -1);
    expect(field.heightAt(-20.5, 10.5)).toBe(before);
  });

  it('holds a crater entry in the local frame: map dm to m', () => {
    expect(craterStampOf(100, -250, 25, 40, local)).toEqual({ x: -10, z: -25, radius: 2.5, depthCm: 40 });
  });

  it('tells the cells its stamps changed since it was last asked, all of them after a clear (E291)', () => {
    const field = new StampField(SPAN);
    expect(field.takeChanged()).toBeNull();
    field.crater({ x: 10, z: 10, radius: 3, depthCm: 50 }, 1);
    // 4.05 m round (10, 10): cells 2 to 7 of 2 m on both axes
    expect(field.takeChanged()).toEqual({ minIx: 2, maxIx: 7, minIz: 2, maxIz: 7 });
    expect(field.takeChanged()).toBeNull();
    field.crater({ x: 10, z: 10, radius: 3, depthCm: 50 }, -1);
    field.crater({ x: -20, z: 10, radius: 3, depthCm: 50 }, 1);
    expect(field.takeChanged()).toEqual({ minIx: -13, maxIx: 7, minIz: 2, maxIz: 7 });
    // Off the field nothing changed
    field.crater({ x: 5000, z: 0, radius: 3, depthCm: 50 }, 1);
    expect(field.takeChanged()).toBeNull();
    field.clear();
    expect(field.takeChanged()).toEqual(SPAN);
  });
});
