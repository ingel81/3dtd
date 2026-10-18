import { createMapDocument } from './map-create';
import { contentHash, packMapFile, unpackMapFile } from './map-file';
import { mapRepairs } from './map-repair';
import type { MapPoint, MapSurface, MapSurfaceMarkingKind } from './map-document';
import { courtOf, fitMarking, markingFrame, markingPoint, parkingBands, parkingRows, STALL, surfaceArea, surfaceProblems } from './map-surfaces';

const rect = (cx: number, cy: number, a: number, b: number, turn = 0): MapPoint[] => {
  const m = { kind: 'parking' as const, x: cx, y: cy, angle: turn, length: a, width: b };
  return [markingPoint(m, -a / 2, -b / 2), markingPoint(m, a / 2, -b / 2), markingPoint(m, a / 2, b / 2), markingPoint(m, -a / 2, b / 2)];
};

describe('map surfaces', () => {
  it('fits a marking to the smallest turned rectangle, the long side along', () => {
    const m = fitMarking('tennis', rect(10, -4, 18, 36, 0.4))!;
    expect(m.kind).toBe('tennis');
    expect(m.length).toBeCloseTo(36, 1);
    expect(m.width).toBeCloseTo(18, 1);
    expect(m.x).toBeCloseTo(10, 1);
    expect(m.y).toBeCloseTo(-4, 1);
    // The long side runs a quarter turn from the short one given first
    const along = markingPoint(m, 1, 0);
    expect(Math.abs(Math.cos(Math.atan2(along.y - m.y, along.x - m.x) - (0.4 + Math.PI / 2)))).toBeCloseTo(1, 3);
  });

  it('fits none to an outline that fills its rectangle badly (an L)', () => {
    const l = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 40 }];
    expect(fitMarking('parking', l)).toBeNull();
    expect(fitMarking('parking', rect(0, 0, 40, 20))).not.toBeNull();
  });

  it('draws courts in their real measures, smaller in a small rectangle; a pitch takes the rectangle', () => {
    expect(courtOf({ kind: 'tennis', length: 36, width: 18 })).toEqual({ length: 23.77, width: 10.97 });
    // A metre of run-off each side: the length fits 18 m, the width follows
    const small = courtOf({ kind: 'basketball', length: 20, width: 12 });
    expect(small.length).toBeCloseTo(18, 3);
    expect(small.width).toBeCloseTo((15 * 18) / 28, 3);
    const pitch = courtOf({ kind: 'soccer', length: 110, width: 72 });
    expect(pitch.length).toBeCloseTo(110 - 2 * 1.44, 3);
    expect(courtOf({ kind: 'parking', length: 50, width: 30 })).toEqual({ length: 50, width: 30 });
  });

  it('maps points into the marking frame and back', () => {
    const m = { kind: 'soccer' as MapSurfaceMarkingKind, x: 5, y: 7, angle: 1.1, length: 100, width: 60 };
    const p = markingPoint(m, 12, -3);
    const f = markingFrame(m, p);
    expect(f.u).toBeCloseTo(12, 6);
    expect(f.v).toBeCloseTo(-3, 6);
  });

  it('lays car park rows back to back between aisles, a single row in a narrow park, none in a strip', () => {
    expect(parkingRows({ length: 40, width: 4 })).toEqual([]);
    const narrow = parkingRows({ length: 40, width: 12 });
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toMatchObject({ v0: -6, v1: -1, aisle: 1 });
    expect(narrow[0].stalls).toHaveLength(Math.floor(38 / STALL.width));
    const wide = parkingRows({ length: 40, width: 32 });
    expect(parkingBands(32)).toBe(2);
    expect(wide).toHaveLength(4);
    // Two rows meet back to back in the middle
    expect(wide[1].v1).toBeCloseTo(wide[2].v0, 6);
    // The stalls stand centred along the length
    const s = wide[0].stalls;
    expect(s[0] + s[s.length - 1]).toBeCloseTo(0, 6);
  });

  it('names what is wrong with a surface', () => {
    expect(surfaceProblems({ id: 'a', material: 'paving', outer: rect(0, 0, 4, 4) })).toEqual([]);
    expect(surfaceProblems({ id: 'a', material: 'paving', outer: [{ x: 0, y: 0 }] })[0]).toContain('outline');
    expect(surfaceProblems({ id: '', material: 'paving', outer: rect(0, 0, 4, 4) })[0]).toContain('no id');
    expect(surfaceProblems({ id: 'a', material: 'paving', outer: rect(0, 0, 4, 4), marking: { kind: 'curling', x: 0, y: 0, angle: 0, length: 4, width: 4 } })[0]).toContain('unknown');
    expect(surfaceArea({ outer: rect(0, 0, 10, 4), holes: [rect(0, 0, 2, 2)] })).toBeCloseTo(36, 6);
  });
});

describe('surfaces in the map file', () => {
  const surface = (id: string, kind?: MapSurfaceMarkingKind): MapSurface => {
    const outer = rect(0, 0, 40, 20);
    const s: MapSurface = { id, material: 'asphalt', outer, group: 'osm-a1' };
    if (kind) s.marking = fitMarking(kind, outer)!;
    return s;
  };

  it('round-trips the surfaces; a map without them keeps its content hash', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, starter: true, now: new Date(0) });
    const plain = await contentHash(doc);
    doc.surfaces = [surface('a', 'parking'), { ...surface('b'), holes: [rect(0, 0, 4, 4)] }];
    const { doc: back, repaired } = unpackMapFile(packMapFile(doc));
    expect(repaired).toEqual([]);
    expect(back.surfaces).toEqual(doc.surfaces);
    expect(await contentHash(back)).not.toBe(plain);
    delete doc.surfaces;
    expect(await contentHash(doc)).toBe(plain);
  });

  it('reads surfaces softly: a broken one is left out, an unknown marking loses its lines, a twice id goes', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, starter: true, now: new Date(0) });
    const odd = surface('b', 'soccer');
    (odd.marking as unknown as Record<string, unknown>)['kind'] = 'quidditch';
    doc.surfaces = [surface('a'), odd, { id: 'c', material: 'sand', outer: [{ x: 0, y: 0 }] }, surface('a')];
    const { doc: back, repaired } = unpackMapFile(packMapFile(doc));
    expect(repaired).toEqual([
      'surface b: marking quidditch is unknown; it is drawn without lines',
      'surface c needs an outline of 3 to 2048 points; it is left out',
      'surface id "a" is twice; it is left out',
    ]);
    expect(back.surfaces!.map((s) => s.id)).toEqual(['a', 'b']);
    expect(back.surfaces![1].marking).toBeUndefined();
    expect(mapRepairs(back)).toEqual([]);
  });

  it('leaves surfaces that are no list out', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, starter: true, now: new Date(0) });
    (doc as unknown as Record<string, unknown>)['surfaces'] = 'many';
    const { doc: back, repaired } = unpackMapFile(packMapFile(doc));
    expect(repaired).toEqual(['surfaces is not a list; the map has no surfaces']);
    expect(back.surfaces).toBeUndefined();
  });
});
