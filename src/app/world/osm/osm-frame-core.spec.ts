import { unpackMapFile } from '../custom-map/map-file';
import { routeBetween } from '../../editor/ops/path-graph';
import { OSM_PROBE_SIDE, osmProbe } from '../../../../tools/osm/osm-probe';
import { loadOsmInput, overpassFailure, type OsmDownloadStats } from './import-osm';
import { OsmFrameCore, type FrameSpawn } from './osm-frame-core';
import { frameKey, MemoryFrameBackend, OSM_FRAMES_KEPT, OsmFrameStore } from './osm-frame-store';
import { OsmFrameSession } from './osm-frame-session';
import { OsmFrame } from './osm-parse';

const NOTHING_FETCHED: OsmDownloadStats = { stored: true, osmMs: 0, osmChars: 0, osmRequests: 0, demMs: 0, demTiles: 0, demBytes: 0 };

describe('OSM world frame (frozen probe Miltenberg)', () => {
  let seed = 1;
  beforeEach(() => {
    seed = 1;
    vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  });
  afterEach(() => vi.restoreAllMocks());

  const options = { splatResolution: 512, now: new Date('2026-10-15T00:00:00Z') };
  const opened = () => {
    const core = new OsmFrameCore({ sideM: OSM_PROBE_SIDE });
    const input = osmProbe();
    return { core, input, frame: core.read(input, NOTHING_FETCHED, 3) };
  };

  it('draws spawns as on a real place, each with its route to the HQ, apart from each other', () => {
    const { frame } = opened();
    expect(frame.hq).not.toBeNull();
    expect(frame.spawns.length).toBeGreaterThan(1);
    expect(frame.roads.edges).toBeGreaterThan(500);
    for (const s of frame.spawns) {
      expect(s.routeM).toBeGreaterThan(s.distanceM * 0.9);
      // The route ends at the HQ
      const [lon, lat] = s.route[s.route.length - 1];
      expect(Math.hypot((lat - frame.hq!.lat) * 111320, (lon - frame.hq!.lon) * 72000)).toBeLessThan(40);
    }
  });

  it('drops a dragged spawn on the foot of its street, and says why where it may not stand', () => {
    const { core, input, frame } = opened();
    const s = frame.spawns[0];
    const geo = new OsmFrame(input.lat, input.lon);
    const off = geo.geo({ x: geo.x(s.lon) + 12, y: geo.y(s.lat) + 9 });
    const dropped = core.drop(off) as FrameSpawn;
    expect('reason' in dropped).toBe(false);
    expect(dropped.routeM).toBeGreaterThan(0);
    expect(core.drop(frame.hq!)).toEqual({ reason: 'Too close to the HQ' });
    expect(core.drop(geo.geo({ x: 595, y: 0 }))).toMatchObject({ reason: expect.stringMatching(/edge|street/) });
  });

  it('makes the map with the spawns the frame chose, the first open, and packs it with its identity', () => {
    const { core, frame } = opened();
    const chosen = frame.spawns.slice(0, 2);
    const steps: string[] = [];
    const made = core.make(chosen, { ...options, id: 'osm-test' }, (step) => steps.push(step));
    expect(steps).toEqual(['parse', 'terrain', 'roads', 'water', 'level', 'ground', 'shores', 'paint', 'layout', 'plants', 'pack']);
    const { doc } = made;
    expect(doc.meta.id).toBe('osm-test');
    expect(doc.spawns.map((s) => s.name)).toEqual(chosen.map((s) => s.name));
    expect(doc.spawns[0].optional).toBeUndefined();
    expect(doc.spawns[1].optional).toBe(true);
    for (const s of doc.spawns) expect(routeBetween(doc.paths, s, doc.hq)).not.toBeNull();
    const back = unpackMapFile(made.file).doc;
    expect(back.meta.uid).toBe(doc.meta.uid);
    expect(back.meta.uid).toBeTruthy();
    expect(back.spawns.length).toBe(2);
  });

  it('runs on the calling thread without workers and opens the place again from the store after a cancel', async () => {
    const store = new OsmFrameStore(new MemoryFrameBackend());
    const input = osmProbe();
    await store.save({ lat: input.lat, lon: input.lon, sideM: OSM_PROBE_SIDE, fetchedAt: input.fetchedAt, overpass: input.overpass, dem: input.dem, demFailed: [] });
    const session = new OsmFrameSession({ createWorker: () => null, core: new OsmFrameCore({ store, sideM: OSM_PROBE_SIDE }) });
    const steps: string[] = [];
    const frame = await session.open(input, 2, [], (s) => steps.push(s));
    expect(steps).toEqual(['stored']);
    expect(frame.download.stored).toBe(true);
    const more = await session.draw(1, frame.spawns);
    expect(more.length).toBeLessThanOrEqual(1);
    const cancel = new AbortController();
    cancel.abort();
    await expect(session.make(frame.spawns, options, undefined, cancel.signal)).rejects.toThrow('Cancelled');
    const made = await session.make(frame.spawns, options);
    expect(made.doc.spawns.length).toBe(frame.spawns.length);
  });
});

describe('OSM frame store', () => {
  it('keeps the most recently used frames and gives a stored place back without fetching', async () => {
    const backend = new MemoryFrameBackend();
    const store = new OsmFrameStore(backend);
    const frame = (k: number) => ({ lat: 49 + k / 100, lon: 9, sideM: 2400, fetchedAt: 'then', overpass: { elements: [] }, dem: null, demFailed: [] });
    for (let k = 0; k <= OSM_FRAMES_KEPT; k++) {
      vi.spyOn(Date, 'now').mockReturnValue(1000 + k);
      await store.save(frame(k));
    }
    vi.restoreAllMocks();
    expect(backend.frames.size).toBe(OSM_FRAMES_KEPT);
    expect(backend.frames.has(frameKey(49, 9, 2400))).toBe(false);

    const fetch = vi.spyOn(globalThis, 'fetch');
    const stored = { ...frame(3), dem: osmProbe().dem };
    await store.save(stored);
    const { input, download } = await loadOsmInput({ lat: stored.lat, lon: 9 }, { store });
    expect(fetch).not.toHaveBeenCalled();
    expect(download.stored).toBe(true);
    expect(input.dem).not.toBeNull();
    fetch.mockRestore();
  });

  it('says in a sentence why no map came when the OSM servers do not answer', () => {
    expect(overpassFailure('OSM API error: 429')).toMatch(/too many requests/);
    expect(overpassFailure('OSM API error: 502')).toMatch(/did not answer \(OSM API error: 502\).*try again/);
  });
});
