import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { CUT_CELL, groundCuts, insideCut, TerrainCuts } from './terrain-cuts';

const portal = { id: 'tunnel-portal-concrete', category: 'structure', footprint: 15, groundCut: [4, 4.2, 6.4, 14] } as CatalogObject;
const entries = new Map([[portal.id, portal]]);

function placed(rotation: number, extra: Partial<MapObject> = {}): MapObject {
  return { id: 'tunnel-1', asset: portal.id, x: 100, y: 0, z: 0, rotation, scale: 1, ...extra };
}

describe('terrain cuts', () => {
  it('runs an opening back from the front face, along model -z', () => {
    // Front (+z) facing west: rotation as tunnels.ts turns a portal whose vault runs east
    const [cut] = groundCuts([placed(Math.atan2(1, 0))], entries, () => 10, () => null);
    expect(cut.dx).toBeCloseTo(1, 6);
    expect(cut.dy).toBeCloseTo(0, 6);
    expect(cut.springY).toBeCloseTo(14.2, 6);
    expect(cut.rise).toBeCloseTo(2.2, 6);
    // Inside: behind the face, under the arch; outside: in front, beside, above the crown, past the back
    expect(insideCut(cut, 105, 0, 12)).toBe(true);
    expect(insideCut(cut, 105, 3.9, 14)).toBe(true);
    expect(insideCut(cut, 95, 0, 12)).toBe(false);
    expect(insideCut(cut, 105, 4.5, 12)).toBe(false);
    expect(insideCut(cut, 105, 0, 16.5)).toBe(false);
    expect(insideCut(cut, 115, 0, 12)).toBe(false);
    // The arch: the crown in the middle, lower towards the walls
    expect(insideCut(cut, 105, 0, 16.3)).toBe(true);
    expect(insideCut(cut, 105, 3.5, 16.3)).toBe(false);
  });

  it('scales with the object and sits on its seat plus its own z', () => {
    const [cut] = groundCuts([placed(0, { scale: 2, z: 1 })], entries, () => 5, () => null);
    expect(cut.halfWidth).toBe(8);
    expect(cut.length).toBe(28);
    expect(cut.springY).toBeCloseTo(5 + 1 + 8.4, 6);
    // Rotation 0: the front faces map north, the vault runs south
    expect(cut.dy).toBeCloseTo(-1, 6);
  });

  it('skips objects without an opening', () => {
    expect(groundCuts([{ ...placed(0), asset: 'oak' }], entries, () => 0, () => null)).toEqual([]);
  });

  it('names each opening in the index texels its ground touches', () => {
    const cuts = new TerrainCuts(400, 400);
    const [cut] = groundCuts([placed(Math.atan2(1, 0))], entries, () => 0, () => null);
    cuts.set([cut, { ...cut, x: 108 }]);
    const at = (x: number, y: number) => cuts.indexAt(x, y);
    expect(at(110, 0)).toEqual([1, 2]);
    expect(at(120, 0)).toEqual([2, 0]);
    expect(at(0, 0)).toEqual([0, 0]);
    // The openings follow the index rows, two texels each
    const map = cuts.uniforms.uCutMap.value;
    const data = map.image.data as Float32Array;
    const rows = 400 / CUT_CELL;
    expect(map.image.height).toBe(rows + 1);
    expect([...data.slice(rows * rows * 4 + 8, rows * rows * 4 + 10)]).toEqual([108, 0]);
    // Unchanged openings upload nothing
    map.needsUpdate = false;
    const version = map.version;
    cuts.set([cut, { ...cut, x: 108 }]);
    expect(map.version).toBe(version);
    cuts.set([]);
    expect(at(110, 0)).toEqual([0, 0]);
    cuts.dispose();
  });
});
