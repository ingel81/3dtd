import { osmProbe } from '../../../../../tools/osm/osm-probe';
import { OsmFrame, parseOsm, type OsmArea, type OsmFeatures, type OsmPoint } from '../osm-parse';
import { convertOsm } from '../import-osm';
import { areaMiddle, findLandmarks, landmarkKind, spawnAnchors } from './anchors';

function features(points: OsmPoint[], areas: OsmArea[] = []): OsmFeatures {
  return { frame: new OsmFrame(49, 9), half: 1200, ways: [], points, areas, stats: {} as OsmFeatures['stats'] };
}

const square = (id: number, x: number, y: number, side: number, tags: Record<string, string>): OsmArea => ({
  id,
  from: 'way',
  tags,
  outer: [[{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }]],
  inner: [],
  area: side * side,
});

describe('OSM world anchors and landmarks', () => {
  it('finds where people arrive: stations first, harbours and large car parks, then stops, named after them', () => {
    const f = features(
      [
        { id: 1, x: 600, y: 0, tags: { railway: 'station', name: 'Miltenberg' } },
        { id: 2, x: 0, y: 700, tags: { highway: 'bus_stop', name: 'Miltenberg, Engelplatz' } },
        { id: 3, x: 0, y: -700, tags: { railway: 'tram_stop' } },
        { id: 4, x: 5000, y: 0, tags: { railway: 'station', name: 'Outside' } },
      ],
      [square(10, -800, 0, 50, { amenity: 'parking', name: 'Mainwiese' }), square(11, -800, 300, 20, { amenity: 'parking' }), square(12, -800, 600, 60, { amenity: 'parking', parking: 'multi-storey' })],
    );
    const anchors = spawnAnchors(f);
    expect(anchors.map((a) => [a.name, a.tier])).toEqual([
      ['Miltenberg station', 0],
      ['Engelplatz stop', 2],
      ['Stop', 2],
      ['Mainwiese car park', 1],
    ]);
    expect(anchors[3].x).toBeCloseTo(-775, 5);
  });

  it('weighs landmarks by kind, renown and size, less far off, and takes a church once', () => {
    const f = features(
      [
        // The altar inside the church and a chapel in a house: no landmarks of their own
        { id: 1, x: 105, y: 105, tags: { amenity: 'place_of_worship', name: 'Altar' } },
        { id: 2, x: -50, y: 0, tags: { amenity: 'place_of_worship', name: 'Hauskapelle' } },
      ],
      [
        square(10, 100, 100, 30, { amenity: 'place_of_worship', building: 'church', religion: 'christian', name: 'Johanneskirche', wikidata: 'Q1' }),
        square(11, 300, 0, 20, { amenity: 'townhall', name: 'Rathaus' }),
        square(12, -900, 0, 15, { historic: 'city_gate', name: 'Würzburger Tor', wikidata: 'Q2' }),
        square(13, 0, -200, 25, { amenity: 'place_of_worship', building: 'mosque', religion: 'muslim' }),
      ],
    );
    const found = findLandmarks(f, { x: 0, y: 0 }, 1000);
    expect(found.map((l) => l.name)).toEqual(['Johanneskirche', 'Rathaus', 'Würzburger Tor', '']);
    expect(found[0]).toMatchObject({ kind: 'church', bells: true });
    expect(found[3]).toMatchObject({ kind: 'place of worship', bells: false });
    expect(findLandmarks(f, { x: 0, y: 0 }, 500).some((l) => l.kind === 'city gate')).toBe(false);
    expect(landmarkKind({ historic: 'memorial', memorial: 'plaque' }, 10)).toBeNull();
    expect(areaMiddle(square(1, 0, 0, 10, {}))).toEqual({ x: 5, y: 5 });
  });

  describe('on the frozen probe', () => {
    let seed = 1;
    beforeEach(() => {
      seed = 1;
      vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
    });
    afterEach(() => vi.restoreAllMocks());

    it('draws most spawns at stops and car parks and names them so', () => {
      const probe = osmProbe();
      const f = parseOsm(probe.overpass, new OsmFrame(probe.lat, probe.lon), 600);
      const anchors = spawnAnchors(f);
      expect(anchors.length).toBeGreaterThan(10);
      const { doc } = convertOsm(probe, { sideM: 1200, splatResolution: 256, now: new Date('2026-10-18T00:00:00Z') });
      const named = doc.spawns.filter((s) => anchors.some((a) => a.name === s.name));
      expect(doc.spawns.length).toBeGreaterThan(1);
      expect(named.length).toBeGreaterThan(0);
      for (const s of named) {
        const a = anchors.find((x) => x.name === s.name)!;
        expect(Math.hypot(a.x - s.x, a.y - s.y)).toBeLessThan(130);
      }
    });
  });
});
