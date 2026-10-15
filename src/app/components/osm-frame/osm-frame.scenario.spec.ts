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
    expect(root.textContent).toContain('Downloading the streets and heights');
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
    expect(root.textContent).toContain('is among your maps');

    root.querySelector<HTMLButtonElement>('[data-test=osm-play]')!.click();
    expect(done).toEqual([{ summary: expect.objectContaining({ id: 'osm-miltenberg' }), then: 'play' }]);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('overpass'), expect.anything());
  });
});
