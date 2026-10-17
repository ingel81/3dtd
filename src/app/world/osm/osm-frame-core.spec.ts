import { contentHash, unpackMapFile } from '../custom-map/map-file';
import { routeBetween } from '../../map-ops/path-graph';
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

  it('makes the map with the spawns the frame chose, the first open, and packs it with its identity and content hash', async () => {
    const { core, frame } = opened();
    const chosen = frame.spawns.slice(0, 2);
    const steps: string[] = [];
    const shares: string[] = [];
    const made = await core.make(chosen, { ...options, id: 'osm-test' }, (p) => {
      steps.push(p.step);
      if (p.share !== undefined) shares.push(p.step);
    });
    // The long loops say how far they are: the footprints, the plants by land class, the packing
    expect(new Set(shares)).toEqual(new Set(['buildings', 'plants', 'pack']));
    // Each step reports its beginning in the order of the making (OSM_MAKE_STEPS); packing twice, the file then hash and sketch
    expect([...new Set(steps)]).toEqual(['parse', 'terrain', 'roads', 'water', 'level', 'ground', 'shores', 'paint', 'layout', 'buildings', 'furniture', 'plants', 'pack']);
    expect(made.hash).toBe(await contentHash(made.doc));
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

  it('lays out a square moved off the place and sized down from the data in hand: nothing fetched, the HQ on the place', async () => {
    const store = new OsmFrameStore(new MemoryFrameBackend());
    const input = osmProbe();
    await store.save({ lat: input.lat, lon: input.lon, sideM: OSM_PROBE_SIDE, fetchedAt: input.fetchedAt, overpass: input.overpass, dem: input.dem, demFailed: [] });
    const core = new OsmFrameCore({ store, sideM: OSM_PROBE_SIDE });
    const first = await core.open({ place: input, count: 2 });
    expect(first.area).toEqual({ lat: input.lat, lon: input.lon, sideM: OSM_PROBE_SIDE });
    const geo = new OsmFrame(input.lat, input.lon);
    const fetch = vi.spyOn(globalThis, 'fetch');
    // 1000 m, its centre 80 m east and 60 m north of the place: within the 1.2 km of data
    const area = { ...geo.geo({ x: 80, y: 60 }), sideM: 1000 };
    const moved = await core.open({ place: input, count: 2, spawnsAt: first.spawns, topUp: true, area });
    expect(fetch).not.toHaveBeenCalled();
    expect(moved.area).toEqual(area);
    expect(moved.data).toEqual(first.data);
    expect(moved.spawns.length).toBe(2);
    // The HQ stays by the place, not by the square's middle
    const hq = geo.point(moved.hq!);
    expect(Math.hypot(hq.x, hq.y)).toBeLessThanOrEqual(Math.hypot(geo.point(first.hq!).x, geo.point(first.hq!).y) + 1);
    const made = await core.make(moved.spawns, options);
    expect(made.doc.terrain.width).toBe(1000);
    expect(made.doc.meta.source).toMatchObject({ kind: 'osm', sideM: 1000, lat: area.lat, lon: area.lon });
    // The map's HQ is the place's, in the map's own metres round the square's middle
    const mapGeo = new OsmFrame(area.lat, area.lon);
    const placeOnMap = mapGeo.point(input);
    expect(Math.hypot(made.doc.hq.x - placeOnMap.x, made.doc.hq.y - placeOnMap.y)).toBeLessThan(260);
    fetch.mockRestore();
  });

  it('runs on the calling thread without workers and opens the place again from the store after a cancel', async () => {
    const store = new OsmFrameStore(new MemoryFrameBackend());
    const input = osmProbe();
    await store.save({ lat: input.lat, lon: input.lon, sideM: OSM_PROBE_SIDE, fetchedAt: input.fetchedAt, overpass: input.overpass, dem: input.dem, demFailed: [] });
    const session = new OsmFrameSession({ createWorker: () => null, core: new OsmFrameCore({ store, sideM: OSM_PROBE_SIDE }) });
    const steps: string[] = [];
    const frame = await session.open({ place: input, count: 2 }, (p) => steps.push(`${p.step} ${p.state ?? 'active'}`));
    expect(steps).toEqual(['stored active', 'stored done', 'streets active', 'streets done']);
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
    expect(overpassFailure('overpass-api.de: HTTP 429; overpass.private.coffee: HTTP 429; 4 tries')).toMatch(/too many requests/);
    expect(overpassFailure('overpass-api.de: HTTP 502; 4 tries')).toMatch(/did not answer \(overpass-api.de: HTTP 502; 4 tries\).*try again/);
  });
});
