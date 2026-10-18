import { heightAt } from '../../../map-ops/grid';
import { createMapDocument } from '../../custom-map/map-create';
import type { MapPaths, MapPoint, MapTerrain } from '../../custom-map/map-document';
import { landClassOf, waterClassOf, waterwayOf } from '../land-tags';
import { OsmFrame, type OsmArea, type OsmFeatures, type OsmWay } from '../osm-parse';
import { ringArea } from '../square-clip';
import { carveWater, coastMask, isQuayWater, settleWater } from './water';
import { sampleGrid } from './raster';

const SIDE = 400;

function terrain(ground: (x: number, y: number) => number): MapTerrain {
  const doc = createMapDocument({ id: 't', name: 't', width: SIDE, depth: SIDE, cellSize: 2, baseMaterial: 'grass', splatResolution: 128, starter: false });
  const t = doc.terrain;
  const n = t.grid.columns;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t.grid.heights[j * n + i] = ground(-SIDE / 2 + i * 2, -SIDE / 2 + j * 2);
  return t;
}

function features(o: { ways?: Partial<OsmWay>[]; areas?: Partial<OsmArea>[] }): OsmFeatures {
  const areas = (o.areas ?? []).map((a, k) => ({ id: k + 1, from: 'way' as const, tags: {}, outer: [], inner: [], ...a, area: Math.abs(ringArea(a.outer![0])) }));
  const ways = (o.ways ?? []).map((w, k) => ({ id: 100 + k, tags: {}, nodes: [], points: [], ...w }));
  return { frame: new OsmFrame(50, 10), half: SIDE / 2, ways, areas, points: [], stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 } };
}

const square = (x: number, y: number, r: number): MapPoint[] => [
  { x: x - r, y: y - r },
  { x: x + r, y: y - r },
  { x: x + r, y: y + r },
  { x: x - r, y: y + r },
];
const noPaths: MapPaths = { nodes: [], edges: [] };

describe('OSM world water', () => {
  it('reads the tags as the plan maps them', () => {
    expect(waterClassOf({ natural: 'water', water: 'river' })).toBe('river');
    expect(waterClassOf({ waterway: 'riverbank' })).toBe('river');
    expect(waterClassOf({ natural: 'water', water: 'pond' })).toBe('lake');
    expect(waterClassOf({ landuse: 'reservoir' })).toBe('lake');
    expect(waterClassOf({ leisure: 'swimming_pool' })).toBe('pool');
    expect(waterClassOf({ leisure: 'swimming_pool', indoor: 'yes' })).toBeNull();
    expect(waterClassOf({ natural: 'water', covered: 'yes' })).toBeNull();
    expect(waterwayOf({ waterway: 'stream' })?.width).toBe(2.5);
    expect(waterwayOf({ waterway: 'river', width: '20' })?.width).toBe(20);
    expect(waterwayOf({ waterway: 'drain', tunnel: 'culvert' })).toBeNull();
    expect(landClassOf({ landuse: 'forest', leaf_type: 'needleleaved' })).toBe('conifers');
    expect(landClassOf({ natural: 'mountain_range' })).toBeNull();
    expect(landClassOf({ landuse: 'residential' })).toBeNull();
  });

  it('walls a canal in with quays: the bed drops at the wall and the land stands a quay over the water, a pond keeps its bank', () => {
    expect(isQuayWater({ natural: 'water', water: 'canal' })).toBe(true);
    expect(isQuayWater({ natural: 'water', water: 'harbour' })).toBe(true);
    expect(isQuayWater({ natural: 'water', water: 'pond' })).toBe(false);
    // A canal 20 m wide running north and south, a pond to the east, on flat ground
    const t = terrain(() => 3);
    const canal: MapPoint[] = [{ x: -10, y: -150 }, { x: 10, y: -150 }, { x: 10, y: 150 }, { x: -10, y: 150 }];
    carveWater(t, features({ areas: [{ tags: { natural: 'water', water: 'canal' }, outer: [canal] }, { tags: { natural: 'water', water: 'pond' }, outer: [square(120, 0, 25)] }] }), noPaths, 0);
    const canalWater = [t.water, ...(t.waterBodies ?? [])].find((w) => w && w.mask[Math.round(SIDE / 4) * t.grid.columns + Math.round(SIDE / 4)] > 0) ?? t.water!;
    const level = canalWater.level;
    // A metre and a half in from the wall the canal is already deep; the land beside it a quay over the water
    expect(heightAt(t, -8, 0)).toBeLessThan(level - 2);
    expect(heightAt(t, -12, 0)).toBeGreaterThan(level + 0.8);
    // The pond shelves in from its bank and its rim stands low
    const pond = (t.waterBodies ?? []).concat(t.water ? [t.water] : []).find((w) => w.mask[Math.round(SIDE / 4) * t.grid.columns + Math.round((120 + SIDE / 2) / 2)] > 0)!;
    expect(heightAt(t, 120 - 23, 0)).toBeGreaterThan(pond.level - 1.5);
    expect(heightAt(t, 120 - 27, 0)).toBeLessThan(pond.level + 0.5);
  });

  it('walls a pond in where a street runs beside it, and leaves the bank where nothing is built', () => {
    const t = terrain(() => 3);
    // A street 5 m west of the pond's west shore, running north and south
    const paths: MapPaths = { nodes: [{ id: 'a', x: -35, y: -100 }, { id: 'b', x: -35, y: 100 }], edges: [{ id: 'e', a: 'a', b: 'b', width: 6, kind: 'road' }] };
    carveWater(t, features({ areas: [{ tags: { natural: 'water', water: 'pond' }, outer: [square(0, 0, 27)] }] }), paths, 0);
    const level = (t.water ?? t.waterBodies![0]).level;
    // West, by the street: deep at once and a quay; east, open land: a shelving bank with a low rim
    expect(heightAt(t, -25, 0)).toBeLessThan(level - 2);
    expect(heightAt(t, -28, 0)).toBeGreaterThan(level + 0.8);
    expect(heightAt(t, 25, 0)).toBeGreaterThan(level - 1.5);
    expect(heightAt(t, 28, 0)).toBeLessThan(level + 0.5);
  });

  it('closes a coastline into the sea on its right along the map edge, and puts the map zero on the sea level', () => {
    // The coast runs west to east: land north (left of the line), sea south; the ground falls to the south
    const t = terrain((_, y) => 5 + y * 0.05);
    const coast = { tags: { natural: 'coastline' }, points: [{ x: -260, y: -40 }, { x: 0, y: -30 }, { x: 260, y: -40 }] };
    const f = features({ ways: [coast] });
    const mask = coastMask(f, sampleGrid(SIDE, 2))!;
    const n = t.grid.columns;
    const at = (x: number, y: number) => mask[Math.round((y + SIDE / 2) / 2) * n + Math.round((x + SIDE / 2) / 2)];
    expect(at(0, -150)).toBe(1);
    expect(at(0, 150)).toBe(0);
    expect(at(-190, -60)).toBe(1);

    // The lowest ground was 4 m under the sea level: the map's zero moves onto it
    const result = carveWater(t, f, noPaths, -4);
    expect(result.report.coast).toBe(true);
    expect(result.report.main).toBe('sea');
    expect(result.report.zeroShift).toBe(-4);
    expect(t.water?.kind).toBe('sea');
    expect(t.water?.level).toBe(0);
    expect(heightAt(t, 0, -150)).toBeLessThan(-0.25);
    // Land at the rim stands over the sea
    expect(heightAt(t, 0, 0)).toBeGreaterThan(0);
  });

  it('gives a pond its own body on the level of its water, the bed dug below and the rim over it', () => {
    const t = terrain((x) => 12 + x * 0.01);
    const f = features({ areas: [{ tags: { natural: 'water', water: 'pond' }, outer: [square(40, 40, 30)] }] });
    const result = carveWater(t, f, noPaths, 0);
    expect(result.report.lakes).toBe(1);
    expect(t.water).toBeNull();
    const body = t.waterBodies![0];
    expect(body.level).toBeGreaterThan(11.5);
    expect(body.level).toBeLessThan(13);
    const n = t.grid.columns;
    let wet = 0;
    for (let k = 0; k < body.mask.length; k++) {
      if (!body.mask[k]) continue;
      wet++;
      expect(t.grid.heights[k]).toBeLessThan(body.level);
      const i = k % n;
      for (const q of [k - 1, k + 1, k - n, k + n]) if (q >= 0 && q < body.mask.length && !body.mask[q] && Math.abs((q % n) - i) <= 1) expect(t.grid.heights[q]).toBeGreaterThanOrEqual(body.level);
    }
    expect(wet * 4).toBeGreaterThan(3000);
    expect(result.paint.bed.some((v) => v > 0)).toBe(true);
  });

  it('runs a stream downhill on its course, its channel under its surface, and stops it at a road it crosses without a bridge', () => {
    const t = terrain((x, y) => 20 - y * 0.05 + Math.abs(x) * 0.02);
    // The ground falls to the north, the way is drawn that way
    const stream = { tags: { waterway: 'stream' }, points: [{ x: 0, y: -190 }, { x: 10, y: 0 }, { x: 0, y: 190 }] };
    const road: MapPaths = { nodes: [{ id: 'a', x: -190, y: 0 }, { id: 'b', x: 190, y: 0 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road' }] };
    const result = carveWater(t, features({ ways: [stream] }), road, 0);
    expect(result.report.rivers).toBe(2);
    for (const river of t.rivers!) {
      const pts = river.points;
      expect(pts[0].y).toBeLessThan(pts[pts.length - 1].y);
      for (let k = 1; k < pts.length; k++) expect(pts[k].height).toBeLessThanOrEqual(pts[k - 1].height);
      for (const p of pts) {
        expect(Math.abs(p.y)).toBeGreaterThan(3);
        expect(heightAt(t, p.x, p.y)).toBeLessThan(p.height);
      }
    }
  });

  it('keeps a road through a lake on a dam over the water', () => {
    const t = terrain(() => 8);
    const f = features({ areas: [{ tags: { natural: 'water' }, outer: [square(0, 0, 60)] }] });
    const road: MapPaths = { nodes: [{ id: 'a', x: -190, y: 0 }, { id: 'b', x: 190, y: 0 }], edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road' }] };
    const result = carveWater(t, f, road, 0);
    settleWater(t, result);
    const body = t.waterBodies![0];
    const n = t.grid.columns;
    const k = (SIDE / 2 / 2) * n + SIDE / 2 / 2;
    expect(body.mask[k]).toBe(0);
    expect(t.grid.heights[k]).toBeGreaterThan(body.level);
    expect(body.mask[k + 20 * n]).toBe(255);
  });
});
