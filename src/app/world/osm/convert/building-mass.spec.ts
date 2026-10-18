import { describe, expect, it } from 'vitest';
import type { MapMass, MapPoint } from '../../custom-map/map-document';
import { massArea, massContains, massPitched } from '../../custom-map/object-mass';
import { toModel } from '../../custom-map/object-ground';
import { clipOffRoads, massFacade, massLevels, massTint, raiseMass, simplifyRing } from './building-mass';
import { minAreaRect } from './buildings';

/** A ring of map points from x, y pairs */
const ring = (...xy: number[]): MapPoint[] => xy.flatMap((_, i) => (i % 2 ? [] : [{ x: xy[i], y: xy[i + 1] }]));

/** The rotated block of the nursing home: wings round a courtyard, turned 25 degrees, off the map's middle */
function turned(points: MapPoint[], angle: number, at: MapPoint): MapPoint[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => ({ x: at.x + p.x * c - p.y * s, y: at.y + p.x * s + p.y * c }));
}

describe('raised buildings from OSM footprints', () => {
  const outer = turned(ring(-40, -20, 40, -20, 40, 20, -40, 20), 0.44, { x: 120, y: -60 });
  const yard = turned(ring(-20, -8, 20, -8, 20, 8, -20, 8), 0.44, { x: 120, y: -60 });
  const area = 80 * 40 - 40 * 16;

  it('lays the outline and its courtyard in the axes of the object: back on the map they are the footprint', () => {
    const rect = minAreaRect(outer);
    const raised = raiseMass(outer, [yard], rect, 'civic', { building: 'yes', amenity: 'social_facility' }, area, 7)!;
    expect(raised.mass.rings.length).toBe(2);
    expect(massArea(raised.mass)).toBeCloseTo(area, -1);
    expect(raised.mass.roof).toBe('flat');
    expect(raised.mass.facade).toBe('plaster');
    // Points of the footprint lie on the building, the courtyard's middle does not
    const c = Math.cos(raised.rotation);
    const s = Math.sin(raised.rotation);
    const local = (p: MapPoint) => toModel(p.x - raised.centre.x, p.y - raised.centre.y, c, s);
    const wing = turned([{ x: 0, y: 14 }], 0.44, { x: 120, y: -60 })[0];
    expect(massContains(raised.mass, local(wing).x, local(wing).z)).toBe(true);
    const middle = local({ x: 120, y: -60 });
    expect(massContains(raised.mass, middle.x, middle.z)).toBe(false);
    // Its rectangle's half sides
    expect([raised.hw * 2, raised.hd * 2].sort((p, q) => p - q).map((v) => Math.round(v))).toEqual([40, 80]);
  });

  it('puts a pitched roof on a house that fills its rectangle, a mansard on a crooked one, a flat one round a courtyard', () => {
    const plain = turned(ring(-6, -4.5, 6, -4.5, 6, 4.5, -6.3, 4.5), 1.1, { x: 0, y: 0 });
    const raised = raiseMass(plain, [], minAreaRect(plain), 'house', { building: 'house' }, 108, 2)!;
    expect(massPitched(raised.mass)).toBe(true);
    expect(raised.mass.ridge).toBeGreaterThan(2.5);
    const l = ring(0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30);
    const lHouse = raiseMass(l, [], minAreaRect(l), 'house', { building: 'house' }, 500, 2)!.mass;
    expect(lHouse.roof).toBe('mansard');
    expect(lHouse.ridge).toBeGreaterThan(1);
    expect(raiseMass(l, [ring(2, 2, 6, 2, 6, 6, 2, 6)], minAreaRect(l), 'house', { building: 'house' }, 484, 2)!.mass.roof).toBe('flat');
    // The tag decides over the kind
    expect(raiseMass(plain, [], minAreaRect(plain), 'house', { building: 'house', 'roof:shape': 'flat' }, 108, 2)!.mass.roof).toBe('flat');
    expect(raiseMass(plain, [], minAreaRect(plain), 'house', { building: 'house', 'roof:shape': 'hipped' }, 108, 2)!.mass.roof).toBe('hip');
  });

  it('raises a tower in stone under a steep pyramid, an old-town house half-timbered under a pitched roof (V10)', () => {
    const square = ring(-4, -4, 4, -4, 4, 4, -4, 4);
    const tower = raiseMass(square, [], minAreaRect(square), 'apartments', { building: 'yes', height: '52' }, 64, 1)!;
    expect(tower.mass.facade).toBe('stone');
    expect(tower.mass.roof).toBe('hip');
    expect(tower.mass.ridge).toBeGreaterThan(7);
    expect(tower.mass.floors).toBeGreaterThanOrEqual(13);
    // An old-town house whose footprint is a crooked quad still gets its roof over the rectangle
    const crooked = ring(0, 0, 8, 0.6, 7.6, 12, -0.4, 11.4);
    const house = raiseMass(crooked, [], minAreaRect(crooked), 'oldtown', { building: 'yes' }, 88, 4)!;
    expect(house.mass.facade).toBe('timber');
    expect(massPitched(house.mass)).toBe(true);
  });

  it('takes the height from height or the levels, else from the kind and the size', () => {
    expect(massLevels({ height: '14' }, 'apartments', 400)).toEqual({ floors: 5, height: 14 });
    expect(massLevels({ height: '12', 'roof:height': '4' }, 'house', 120).height).toBe(8);
    expect(massLevels({ 'building:levels': '6' }, 'office', 800)).toEqual({ floors: 6, height: 0.4 + 6 * 3.6 });
    expect(massLevels({}, 'apartments', 400).floors).toBe(3);
    expect(massLevels({}, 'apartments', 1200).floors).toBe(4);
    // A hall is one storey, a bigger one a little higher
    expect(massLevels({}, 'industrial', 1000)).toEqual({ floors: 1, height: 7.83 });
    expect(massLevels({}, 'industrial', 30000).height).toBe(11.5);
    expect(massLevels({}, 'church', 600).height).toBe(13);
  });

  it('takes the walls from building:material, else by kind, the tint from building:colour', () => {
    expect(massFacade({ 'building:material': 'brick' }, 'apartments')).toBe('brick');
    expect(massFacade({}, 'industrial')).toBe('metal');
    expect(massFacade({}, 'school')).toBe('concrete');
    expect(massFacade({}, 'church')).toBe('stone');
    expect(massFacade({}, 'civic')).toBe('plaster');
    expect(massTint({ 'building:colour': '#AABBCC' }, 'plaster', 0)).toBe('#aabbcc');
    expect(massTint({ 'building:colour': '#abc' }, 'plaster', 0)).toBe('#aabbcc');
    expect(massTint({ 'building:colour': 'red' }, 'plaster', 0)).toBe('#b0503e');
    // Without one: the facade's own, the same for the same footprint
    expect(massTint({}, 'metal', 3)).toBe(massTint({}, 'metal', 3));
  });

  it('leaves out points on the line of their neighbours, keeps the corners', () => {
    const wobbly = ring(0, 0, 5, 0.1, 10, 0, 10, 5, 10.05, 10, 0, 10);
    expect(simplifyRing(wobbly, 0.35)?.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(simplifyRing(ring(0, 0, 1, 0, 2, 0), 0.35)).toBeNull();
    // A closed ring (the first point repeated) comes out open
    expect(simplifyRing([...ring(0, 0, 10, 0, 10, 10, 0, 10), { x: 0, y: 0 }], 0.35)?.length).toBe(4);
  });

  it('cuts its walls back from a road that reaches in, and gives up when too little is left', () => {
    const mass: MapMass = { rings: [[-10, -5, 10, -5, 10, 5, -10, 5]], height: 9, floors: 3, roof: 'flat', facade: 'plaster' };
    // A road along z = 6, 5 m wide: it reaches 1.5 m into the building
    expect(clipOffRoads(mass, [{ ax: -30, az: 6, bx: 30, bz: 6, half: 2.5 }])).toBe(true);
    expect(Math.max(...mass.rings[0].filter((_, i) => i % 2 === 1))).toBeCloseTo(3.5);
    expect(massArea(mass)).toBeCloseTo(20 * 8.5);
    const small: MapMass = { rings: [[-10, -5, 10, -5, 10, 5, -10, 5]], height: 9, floors: 3, roof: 'flat', facade: 'plaster' };
    expect(clipOffRoads(small, [{ ax: -30, az: 0, bx: 30, bz: 0, half: 4 }])).toBe(false);
    expect(massArea(small)).toBe(200);
    // A road that keeps its distance changes nothing
    const far: MapMass = { rings: [[-10, -5, 10, -5, 10, 5, -10, 5]], height: 9, floors: 3, roof: 'flat', facade: 'plaster' };
    expect(clipOffRoads(far, [{ ax: -30, az: 12, bx: 30, bz: 12, half: 3 }])).toBe(true);
    expect(far.rings[0]).toEqual([-10, -5, 10, -5, 10, 5, -10, 5]);
  });
});
