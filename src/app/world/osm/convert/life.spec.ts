import { osmProbe } from '../../../../../tools/osm/osm-probe';
import { convertOsm } from '../import-osm';
import { validateMapDocument } from '../../custom-map/map-file';
import { insideOutline, lifeProblems } from '../../custom-map/map-life';
import type { MapPoint, MapTerrain } from '../../custom-map/map-document';
import { introPoseAt, emptyPose } from '../../custom-map/map-intro';
import { heightAt } from '../../../map-ops/grid';

/** Whether a map point lies in one of the map's bodies of water (their masks on the height samples) */
function onWater(t: MapTerrain, p: MapPoint): boolean {
  const g = t.grid;
  const i = Math.round((p.x + t.width / 2) / g.cellSize);
  const j = Math.round((p.y + t.depth / 2) / g.cellSize);
  return [t.water, ...(t.waterBodies ?? [])].some((w) => !!w && w.mask[j * g.columns + i] > 0);
}

describe('OSM world life from data (frozen probe Miltenberg)', () => {
  let seed = 1;
  beforeEach(() => {
    seed = 1;
    vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  });
  afterEach(() => vi.restoreAllMocks());

  it('puts boats and gulls on the river, crows and the bell at the church, and flies the intro over a landmark', () => {
    const { doc, report } = convertOsm(osmProbe(), { sideM: 1200, splatResolution: 256, now: new Date('2026-10-18T00:00:00Z') });
    expect(validateMapDocument(doc)).toEqual([]);
    expect(lifeProblems(doc.life)).toEqual([]);
    const areas = doc.life!.areas!;
    expect(doc.life!.ambience).toEqual({ sound: 'biome', volume: 0.5 });

    // The Main with its seamarks: a waterway with ships, the boats on its water
    const river = areas.find((a) => a.kind === 'boats' && a.shape === 'route')!;
    expect(river.asset).toBe('fishing-boat');
    const inWater = river.points.filter((p) => onWater(doc.terrain, p)).length;
    expect(inWater / river.points.length).toBeGreaterThan(0.9);
    expect(areas.some((a) => a.kind === 'birds' && a.species === 'gulls')).toBe(true);
    expect(areas.some((a) => a.kind === 'boats' && a.shape === 'area')).toBe(true);

    // The bell rings from the crows' circle round the church
    const ws = doc.life!.waveSound!;
    expect(ws.sound).toBe('bell');
    const crows = areas.find((a) => a.id === ws.area)!;
    expect(crows).toMatchObject({ kind: 'birds', species: 'crows' });
    expect(report.life.waveSound).toBe('bell at Johanneskirche');
    expect(Math.hypot(crows.points[0].x - doc.hq.x, crows.points[0].y - doc.hq.y)).toBeLessThan(950);
    expect(insideOutline(crows.points, crows.points.reduce((s, p) => s + p.x, 0) / crows.points.length, crows.points.reduce((s, p) => s + p.y, 0) / crows.points.length)).toBe(true);

    // The intro ends looking at the HQ, every pose above the ground
    expect(report.life.intro).toBeTruthy();
    const intro = doc.intro!;
    expect(intro.kind).toBe('path');
    const pose = emptyPose();
    for (let s = 0; s <= intro.seconds; s += 0.5) {
      introPoseAt(intro, { ...doc.hq, h: 0 }, s, pose);
      expect(pose.h).toBeGreaterThan(heightAt(doc.terrain, Math.max(-590, Math.min(590, pose.x)), Math.max(-590, Math.min(590, pose.y))) + 20);
    }
    const last = intro.kind === 'path' ? intro.views[intro.views.length - 1] : null;
    expect(last!.lookX).toBeCloseTo(doc.hq.x, 0);
    expect(last!.lookY).toBeCloseTo(doc.hq.y, 0);
  });
});
