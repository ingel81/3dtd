import { answerCutShort, mergeAnswers, osmQueryBox, osmWorldQuery, quarters } from './osm-query';

describe('OSM world query', () => {
  it('asks for the map square plus margin, ways, multipolygons and tagged points, with geometry cut at the box', () => {
    const box = osmQueryBox(49.7, 9.26, 2400, 100);
    // 1300 m north and south of the centre
    expect((box.maxLat - box.minLat) * 111320).toBeCloseTo(2600, 0);
    const q = osmWorldQuery(box);
    expect(q).toContain(`[bbox:${box.minLat.toFixed(6)},${box.minLon.toFixed(6)},${box.maxLat.toFixed(6)},${box.maxLon.toFixed(6)}]`);
    for (const key of ['highway', 'building', 'landuse', 'natural', 'waterway', 'railway', 'barrier']) expect(q).toContain(`way["${key}"];`);
    expect(q).toContain('relation["type"="multipolygon"];');
    expect(q).toContain('node["natural"="tree"];');
    expect(q).toMatch(/out body geom\([\d.,]+\);$/);
    expect(q).not.toContain('maxsize:4194304');
  });

  it('splits a box into four quarters that cover it', () => {
    const box = { minLat: 1, maxLat: 3, minLon: 10, maxLon: 14 };
    const q = quarters(box);
    expect(q).toHaveLength(4);
    expect(Math.min(...q.map((b) => b.minLat))).toBe(1);
    expect(Math.max(...q.map((b) => b.maxLon))).toBe(14);
    expect(q[3]).toEqual({ minLat: 2, maxLat: 3, minLon: 12, maxLon: 14 });
  });

  it('tells a cut-short answer from a note', () => {
    expect(answerCutShort('runtime error: Query run out of memory using about 2048 MB of RAM.')).toBe(true);
    expect(answerCutShort('runtime error: Query timed out in "query" at line 3 after 91 seconds.')).toBe(true);
    expect(answerCutShort(undefined)).toBe(false);
    expect(answerCutShort('some note')).toBe(false);
  });

  it('merges the answers of quarters: every element once, a way with the points of both', () => {
    const p = (lat: number) => ({ lat, lon: 9 });
    const merged = mergeAnswers([
      { elements: [{ type: 'way', id: 1, nodes: [10, 11, 12], geometry: [p(1), p(2), null] }, { type: 'node', id: 5, lat: 1, lon: 2 }] },
      { elements: [{ type: 'way', id: 1, nodes: [10, 11, 12], geometry: [null, p(2), p(3)] }, { type: 'node', id: 5, lat: 1, lon: 2 }] },
    ]);
    expect(merged.elements).toHaveLength(2);
    expect(merged.elements[0].geometry).toEqual([p(1), p(2), p(3)]);
  });
});
