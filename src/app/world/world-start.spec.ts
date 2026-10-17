import '@angular/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { UrlLocationService } from '../services/location/url-location.service';
import { DevWorldService } from '../devworld/devworld.service';
import { PLAIN_START, WorldStartService, addressWithoutLink, orderHere, pageTakesLinks, worldStartFromSearch } from './world-start';

/**
 * The start order (docs/WORLDS_NAVIGATION_PLAN.md, phase 1): a link is read
 * once into a WorldStart, its parameters leave the address, the switches of
 * development stay.
 */
describe('WorldStart', () => {
  const urls = new UrlLocationService();
  const place = (search: string) => urls.parseLink(search);
  const open = (search: string) => window.history.replaceState({}, '', `/${search}`);

  /** A page's root services, as a fresh load makes them */
  const page = () => Injector.create({ providers: [WorldStartService, DevWorldService] });

  afterEach(() => open(''));

  it('reads place, world, save, room, spawn limit and start wave from a link', () => {
    const order = worldStartFromSearch('?l=48.77580,9.18290&s=48.78000,9.19000&world=map:demo&resume=slot-2&room=ABC123&lane=s2&spawns=2&fromWave=5', place, true);
    expect(order).toEqual({
      world: { kind: 'custom-map', mapId: 'demo', contentHash: '' },
      place: { hq: { lat: 48.7758, lon: 9.1829 }, spawns: [{ lat: 48.78, lon: 9.19 }] },
      resume: 'slot-2',
      room: { code: 'ABC123', lane: 's2' },
      spawnLimit: 2,
      startWave: 5,
      benchmark: null,
      trial: null,
      // A link only picks: never played at once (docs/WORLDS_NAVIGATION_PLAN.md, 3.8)
      play: false,
      label: null,
    });
    // The bot's check of a map by link: the order's trial
    expect(worldStartFromSearch('?world=map:demo&bot=trial&trialWaves=3', place, true).trial).toEqual({ bot: 3 });
  });

  it("reads a benchmark link's flag once: the load benchmark in DevWorld, the graphics one anywhere", () => {
    expect(worldStartFromSearch('?devworld&bot=manual&benchmark', place, true).benchmark).toEqual({ kind: 'load', back: null });
    expect(worldStartFromSearch('?world=map:demo&benchmark=render', place, true).benchmark).toEqual({ kind: 'render', back: null });
    expect(worldStartFromSearch('?benchmark', place, true).benchmark).toBeNull();
    expect(addressWithoutLink('http://h/?devworld=&bot=manual&benchmark=')).toBe('http://h/?devworld=&bot=manual');
  });

  it('makes the order of the world open now at its place: the tiles are the null world', () => {
    const hq = { lat: 48.7758, lon: 9.1829 };
    expect(orderHere({ kind: 'tiles', source: 'cesium' }, hq, [])).toEqual({ ...PLAIN_START, place: { hq, spawns: [] } });
    const map = { kind: 'custom-map', mapId: 'demo', contentHash: 'h' } as const;
    expect(orderHere(map, null, [])).toEqual({ ...PLAIN_START, world: map });
  });

  it('is the plain start without a link, and the real places for a map link before the maps are open', () => {
    expect(worldStartFromSearch('', place, true)).toEqual(PLAIN_START);
    expect(worldStartFromSearch('?world=map:demo', place, false).world).toBeNull();
    expect(worldStartFromSearch('?world=tileset:campus', place, false).world).toEqual({ kind: 'tileset', id: 'campus' });
  });

  it("takes the link's parameters out of the address and leaves the switches of development", () => {
    expect(addressWithoutLink('http://h/?l=1,2&s=3,4&world=map:x&resume=a&room=R&lane=s1&bot=trial&fromWave=3&relay=ws%3A%2F%2Fh&quality=low'))
      .toBe('http://h/?bot=trial&fromWave=3&relay=ws%3A%2F%2Fh&quality=low');
    expect(addressWithoutLink('http://h/editor?map=demo')).toBe('http://h/editor');
    expect(addressWithoutLink('http://h/?devworld&terrain=flat')).toBe('http://h/?devworld&terrain=flat');
  });

  it('reads the address once at the start: a reload after it carries no order out again', () => {
    open('?l=48.77580,9.18290&world=tileset:campus&resume=slot-1&waves=budget');
    const start = page().get(WorldStartService);

    expect(window.location.search).toBe('?waves=budget');
    expect(start.current().place?.hq).toEqual({ lat: 48.7758, lon: 9.1829 });
    expect(start.current().world).toEqual({ kind: 'tileset', id: 'campus' });
    // The save loads once, the next menu of the same world does not load it again
    expect(start.takeResume()).toBe('slot-1');
    expect(start.takeResume()).toBeNull();

    // A reload: the same page without the link
    expect(page().get(WorldStartService).current()).toEqual(PLAIN_START);
  });

  it('leaves the address of a page of its own as it is: /map-preview keeps its map', () => {
    window.history.replaceState({}, '', '/map-preview?map=mountain-pass&l=1,2');
    expect(page().get(WorldStartService).current()).toEqual(PLAIN_START);
    expect(window.location.search).toBe('?map=mountain-pass&l=1,2');
    expect(pageTakesLinks('http://h/', 'http://h/')).toBe(true);
    expect(pageTakesLinks('http://h/editor?map=x', 'http://h/')).toBe(true);
    expect(pageTakesLinks('http://h/play/?l=1,2', 'http://h/play/')).toBe(true);
    expect(pageTakesLinks('http://h/play', 'http://h/play/')).toBe(true);
    expect(pageTakesLinks('http://h/play/map-preview?map=x', 'http://h/play/')).toBe(false);
    expect(pageTakesLinks('http://h/engine-test', 'http://h/')).toBe(false);
  });

  it("has DevWorld's ref as the world of a `?devworld` start", () => {
    open('?devworld&seed=7');
    const injector = page();
    expect(injector.get(WorldStartService).current().world).toMatchObject({ kind: 'devworld', seed: 7 });
    expect(injector.get(DevWorldService).inUrl).toBe(true);
  });

  it('takes a new order with its own save', () => {
    const start = page().get(WorldStartService);
    start.set({ ...PLAIN_START, world: { kind: 'tileset', id: 'campus' }, resume: 'slot-3' });
    expect(start.current().world).toEqual({ kind: 'tileset', id: 'campus' });
    expect(start.takeResume()).toBe('slot-3');
  });
});
