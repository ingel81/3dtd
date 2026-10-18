/**
 * The frame of an OSM world on the frozen probe (real template read from disk) (Miltenberg, 1.2 km): it
 * opens the place from the frame store without fetching, lists the spawns
 * drawn as on a real place, rolls one again, removes one, makes the map in
 * the session (on the calling thread here) and stores it as an own map; Play
 * hands the stored map on. The flat map (MapLibre) does not run in jsdom: the
 * frame says so and works from the list.
 */
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, Output, input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MapStore, MemoryMapBackend, type MapSummary } from '../../world/custom-map/map-store';
import { MAP_STORE } from '../../world/world-choice.service';
import { OsmFrameCore } from '../../world/osm/osm-frame-core';
import { MemoryFrameBackend, OsmFrameStore } from '../../world/osm/osm-frame-store';
import { OsmFrameSession } from '../../world/osm/osm-frame-session';
import { OSM_PROBE_SIDE, osmProbe } from '../../../../tools/osm/osm-probe';
import { OSM_FRAME_SESSION, OsmFrameComponent } from './osm-frame.component';
import { overpassFailure } from '../../world/osm/import-osm';

const template = readFileSync(resolve('src/app/components/osm-frame/osm-frame.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
Input({ alias: 'name', isSignal: true } as Input)(IconStub.prototype, 'name');
Input({ alias: 'size', isSignal: true } as Input)(IconStub.prototype, 'size');

// The annotations the JIT transform adds for input() and output(); plain vitest runs without them
Input({ alias: 'place', required: true, isSignal: true } as Input)(OsmFrameComponent.prototype, 'place');
Input({ alias: 'spawnsAt', isSignal: true } as Input)(OsmFrameComponent.prototype, 'spawnsAt');
Input({ alias: 'context', isSignal: true } as Input)(OsmFrameComponent.prototype, 'context');
Output('back')(OsmFrameComponent.prototype, 'back');
Output('done')(OsmFrameComponent.prototype, 'done');

describe('OSM world frame', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  let seed = 1;
  beforeEach(() => {
    seed = 1;
    vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function open() {
    const input = osmProbe();
    const frames = new OsmFrameStore(new MemoryFrameBackend());
    await frames.save({ lat: input.lat, lon: input.lon, sideM: OSM_PROBE_SIDE, fetchedAt: input.fetchedAt, overpass: input.overpass, dem: input.dem, demFailed: [] });
    const maps = new MapStore({ backend: new MemoryMapBackend(), fetch: async () => new Response('{"maps":[]}') });
    const fetch = vi.spyOn(globalThis, 'fetch');
    TestBed.configureTestingModule({
      providers: [
        { provide: MAP_STORE, useValue: maps },
        { provide: OSM_FRAME_SESSION, useValue: () => new OsmFrameSession({ createWorker: () => null, core: new OsmFrameCore({ store: frames, sideM: OSM_PROBE_SIDE }) }) },
      ],
    });
    TestBed.overrideComponent(OsmFrameComponent, { set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] } });
    const fixture = TestBed.createComponent(OsmFrameComponent);
    fixture.componentRef.setInput('place', { lat: input.lat, lon: input.lon, name: 'Miltenberg', address: 'Miltenberg, Bayern' });
    const done: { summary: MapSummary; then: string }[] = [];
    fixture.componentInstance.done.subscribe((d) => done.push(d));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 0));
      fixture.detectChanges();
    };
    const button = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent!.trim() === text);
    return { fixture, root, settle, button, maps, done, fetch };
  }

  it('opens the place without fetching, lists its spawns, rolls and removes one, makes and stores the map, Play hands it on', async () => {
    const { fixture, root, settle, button, maps, done, fetch } = await open();
    fixture.detectChanges();
    expect(root.querySelector('[data-test=osm-loading]')!.textContent).toContain('Opening the data kept on this device');
    await settle();
    expect(root.textContent).toContain('A map of Miltenberg');
    expect(root.textContent).toContain('kept on this device');
    expect(root.textContent).toContain('Map data © OpenStreetMap contributors, heights: Mapterhorn');
    const rows = () => root.querySelectorAll('[data-test=osm-spawns] li');
    const count = rows().length;
    expect(count).toBeGreaterThan(1);
    expect(rows()[0].textContent).toContain('open from the start');
    expect(rows()[1].textContent).toContain('the player may close it');

    button('Remove')[1].click();
    await settle();
    expect(rows().length).toBe(count - 1);
    button('Roll again')[0].click();
    await settle();
    expect(rows().length).toBe(count - 1);
    const names = fixture.componentInstance.spawns().map((s) => s.name);

    root.querySelector<HTMLButtonElement>('[data-test=osm-make]')!.click();
    await settle();
    await vi.waitFor(async () => {
      await settle();
      expect(root.querySelector('[data-test=osm-made]')).not.toBeNull();
    });
    const own = await maps.listOwn();
    expect(own.map((m) => m.id)).toEqual(['osm-miltenberg']);
    const { doc } = await maps.load('osm-miltenberg');
    expect(doc.spawns.map((s) => s.name)).toEqual(names);
    expect(doc.meta.source).toMatchObject({ kind: 'osm', address: 'Miltenberg, Bayern' });
    expect(doc.meta.name).toBe('Miltenberg');
    expect(root.textContent).toContain('is one of your Recent worlds');

    root.querySelector<HTMLButtonElement>('[data-test=osm-play]')!.click();
    expect(done).toEqual([{ summary: expect.objectContaining({ id: 'osm-miltenberg' }), then: 'play' }]);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('overpass'), expect.anything());
  });

  it('moves the HQ to a landmark near the address and back, and makes the map with the HQ there', async () => {
    const { fixture, root, settle } = await open();
    await settle();
    const c = fixture.componentInstance;
    expect(root.querySelector('[data-test=osm-hq-at]')!.textContent).toContain('On the address');
    const offered = c.landmarks();
    expect(offered.length).toBeGreaterThan(0);
    const first = root.querySelector<HTMLButtonElement>('[data-test=osm-hq-landmark]')!;
    expect(first.textContent).toContain(c.landmarkLabel(offered[0]));
    const before = c.frame()!.hq!;
    first.click();
    await settle();
    await vi.waitFor(async () => {
      await settle();
      expect(c.phase()).toBe('ready');
    });
    expect(root.querySelector('[data-test=osm-hq-at]')!.textContent).toContain(`On ${c.landmarkLabel(offered[0])}`);
    const hq = c.frame()!.hq!;
    expect(hq).not.toEqual(before);
    // The HQ stands on the road nearest the landmark (within the HQ's reach for a road)
    expect(Math.hypot((hq.lat - offered[0].lat) * 111320, (hq.lon - offered[0].lon) * 111320 * Math.cos((hq.lat * Math.PI) / 180))).toBeLessThan(260);
    // Still the landmarks round the address, the one in use not offered again
    expect(c.landmarks()).toEqual(offered);
    expect(root.querySelector('[data-test=osm-hq-address]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-test=osm-make]')!.click();
    await settle();
    await vi.waitFor(async () => {
      await settle();
      expect(root.querySelector('[data-test=osm-made]')).not.toBeNull();
    });
    expect(c.made()!.report.layout.hqShiftM).toBeLessThan(260);

  });

  it('puts the HQ back on the address', async () => {
    const { fixture, root, settle } = await open();
    await settle();
    const c = fixture.componentInstance;
    const home = c.frame()!.hq;
    c.moveHq(c.landmarks()[0]);
    await vi.waitFor(async () => {
      await settle();
      expect(c.phase()).toBe('ready');
      expect(c.hqAt()).not.toBeNull();
    });
    root.querySelector<HTMLButtonElement>('[data-test=osm-hq-address]')!.click();
    await vi.waitFor(async () => {
      await settle();
      expect(c.phase()).toBe('ready');
      expect(c.frame()!.hq).toEqual(home);
    });
    expect(root.querySelector('[data-test=osm-hq-at]')!.textContent).toContain('On the address');
  });

  it('says while the OSM servers are asked again, then the failure with Try again, which loads anew', async () => {
    type Open = OsmFrameSession['open'];
    const opens: { onRetry?: Parameters<Open>[3]; reject: (e: Error) => void }[] = [];
    const session = {
      open: vi.fn((...args: Parameters<Open>) => {
        // The OpenStreetMap servers are asked: the row says so until the first bytes come
        args[1]?.({ step: 'overpass' });
        return new Promise((_, reject) => opens.push({ onRetry: args[3], reject }));
      }),
      dispose: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: MAP_STORE, useValue: new MapStore({ backend: new MemoryMapBackend(), fetch: async () => new Response('{"maps":[]}') }) },
        { provide: OSM_FRAME_SESSION, useValue: () => session },
      ],
    });
    TestBed.overrideComponent(OsmFrameComponent, { set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] } });
    const fixture = TestBed.createComponent(OsmFrameComponent);
    fixture.componentRef.setInput('place', { lat: 49.7, lon: 9.26, name: 'Miltenberg' });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const status = () => root.querySelector('[role=status]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    fixture.detectChanges();
    expect(status()).toMatch(/Streets, water and buildings from OpenStreetMap ?asking \(0 s\)/);

    // A slow first answer: the frame says it still waits, and offers to ask again
    const frame = fixture.componentInstance;
    frame.now.set(Date.now() + 20_000);
    fixture.detectChanges();
    expect(status()).toMatch(/Still waiting for the OpenStreetMap server \((19|20) s\)/);
    expect(root.querySelector('[data-test=osm-retry-now]')).not.toBeNull();

    opens[0].onRetry!({ attempt: 2, of: 4, waitMs: 3000, kind: 'busy' });
    frame.now.set(Date.now());
    fixture.detectChanges();
    expect(status()).toContain('The map server is busy, trying again in 3 s (2 of 4)');
    frame.now.set(Date.now() + 5000);
    fixture.detectChanges();
    expect(status()).toContain('The map server is busy, asking again (2 of 4)');

    // Try again now: a fresh load; the old one ending late changes nothing
    root.querySelector<HTMLButtonElement>('[data-test=osm-retry-now]')!.click();
    fixture.detectChanges();
    expect(session.open).toHaveBeenCalledTimes(2);
    opens[0].onRetry!({ attempt: 3, of: 4, waitMs: 3000, kind: 'busy' });
    opens[0].reject(new Error('cancelled'));
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(root.querySelector('[role=alert]')).toBeNull();
    expect(status()).toMatch(/Streets, water and buildings from OpenStreetMap ?asking/);
    expect(status()).not.toContain('busy');
    opens.shift();

    opens[0].reject(new Error(overpassFailure('overpass-api.de: HTTP 502; overpass.private.coffee: HTTP 500; 4 tries')));
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const alert = root.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('The OpenStreetMap servers did not answer (overpass-api.de: HTTP 502');

    Array.from(alert.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === 'Try again')!.click();
    fixture.detectChanges();
    expect(session.open).toHaveBeenCalledTimes(3);
    expect(root.querySelector('[role=alert]')).toBeNull();
    // A fresh cycle: no retry line left from the one before
    fixture.detectChanges();
    expect(status()).toMatch(/Streets, water and buildings from OpenStreetMap ?asking/);
    expect(status()).not.toContain('busy');
    fixture.destroy();
  });

  it('asks again now for the square that was moved, not for the default one round the place; no spawn moves meanwhile', async () => {
    type Open = OsmFrameSession['open'];
    const requests: Parameters<Open>[0][] = [];
    const info = {
      area: { lat: 49.7, lon: 9.26, sideM: 2400 },
      data: { lat: 49.7, lon: 9.26, sideM: 2400 },
      hq: { lat: 49.7, lon: 9.26 },
      hqShiftM: 0,
      spawns: [{ lat: 49.705, lon: 9.265, name: 'North', distanceM: 600, routeM: 700, route: [] }],
      fetchedAt: '2026-10-17T00:00:00Z',
      download: { stored: true, osmMs: 0, osmChars: 0, osmRequests: 0, demMs: 0, demTiles: 0, demBytes: 0 },
      roads: { edges: 10, roadKm: 1, pathKm: 1, bridges: 0, tunnels: 0 },
      dem: null,
    };
    const session = {
      // The first opening stands at once; every later one waits (the servers are slow)
      open: vi.fn((request: Parameters<Open>[0]) => {
        requests.push(request);
        return requests.length === 1 ? Promise.resolve(info) : new Promise(() => undefined);
      }),
      dispose: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: MAP_STORE, useValue: new MapStore({ backend: new MemoryMapBackend(), fetch: async () => new Response('{"maps":[]}') }) },
        { provide: OSM_FRAME_SESSION, useValue: () => session },
      ],
    });
    TestBed.overrideComponent(OsmFrameComponent, { set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] } });
    const fixture = TestBed.createComponent(OsmFrameComponent);
    fixture.componentRef.setInput('place', { lat: 49.7, lon: 9.26, name: 'Miltenberg' });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    const frame = fixture.componentInstance;
    expect(frame.phase()).toBe('ready');
    const moved = { lat: 49.703, lon: 9.262, sideM: 1800 };
    frame.reframe(moved);
    frame.retryNow();
    expect(requests.map((r) => r.area)).toEqual([undefined, moved, moved]);
    expect(requests[2]).toMatchObject({ topUp: true, spawnsAt: [{ lat: 49.705, lon: 9.265 }] });
    // While the square loads a spawn cannot be dragged: the map takes no press, a drop changes nothing
    expect(frame.canEdit()).toBe(false);
    const drop = vi.fn();
    (session as unknown as { drop: typeof drop }).drop = drop;
    await frame.dropSpawn(0, { lat: 49.71, lon: 9.27 });
    expect(drop).not.toHaveBeenCalled();
    expect(frame.spawns()).toEqual(info.spawns);
    fixture.destroy();
  });
});
