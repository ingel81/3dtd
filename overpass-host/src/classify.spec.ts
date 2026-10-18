// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { browserFamily, clientInfo, queryKind } from './classify.ts';
import { boxAround, buildingQuery, osmQueryBox, osmWorldQuery, OSM_QUERY_MARGIN, OSM_WORLD_SIDE, route, STREET_RADIUS_M, streetQuery } from './testing/game-queries.ts';

describe('queryKind', () => {
  it('knows the game\'s three queries', () => {
    expect(queryKind(streetQuery([boxAround(49.79, 9.95, STREET_RADIUS_M)]))).toBe('streets');
    const b = boxAround(49.79, 9.95, STREET_RADIUS_M);
    expect(queryKind(streetQuery([{ ...b, minLon: b.maxLon - 0.01 }, { ...b, minLat: b.maxLat - 0.01 }]))).toBe('streets');
    expect(queryKind(buildingQuery([route(49.79, 9.95, 1.5, 40, 1, 0), route(49.79, 9.95, 1.5, 40, 0, 1)], 25))).toBe('buildings');
    expect(queryKind(osmWorldQuery(osmQueryBox(49.7036, 9.2636, OSM_WORLD_SIDE, OSM_QUERY_MARGIN)))).toBe('osm-world');
  });

  it('calls anything else other, and is not fooled by a comment', () => {
    expect(queryKind('[out:json];node(1);out;')).toBe('other');
    expect(queryKind('[out:json];way["highway"](49.79,9.93,49.81,9.96);out geom;')).toBe('other');
    expect(queryKind('// way["building"](around:25,1,2)\n[out:json];node(1);out;')).toBe('other');
  });
});

describe('clientInfo', () => {
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const EDGE = `${CHROME} Edg/141.0.0.0`;
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
  const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

  it('tells the browser families apart', () => {
    expect(browserFamily(CHROME)).toBe('chrome');
    expect(browserFamily(EDGE)).toBe('edge');
    expect(browserFamily(FIREFOX)).toBe('firefox');
    expect(browserFamily(SAFARI)).toBe('safari');
    expect(browserFamily('curl/8.11.1')).toBe('other');
  });

  it('takes the desktop app by its page or its own User-Agent, with its version', () => {
    expect(clientInfo('app://app', '3DTD/0.8.0 (+https://github.com/ingel81/3dtd)')).toEqual({ client: 'desktop', version: '0.8.0', browser: 'electron' });
    expect(clientInfo(undefined, '3DTD/0.8.1-beta.2 (+https://github.com/ingel81/3dtd)')).toEqual({ client: 'desktop', version: '0.8.1-beta.2', browser: 'electron' });
    expect(clientInfo('app://app', CHROME)).toEqual({ client: 'desktop', version: null, browser: 'electron' });
  });

  it('takes any other page as the web game and no page as other', () => {
    expect(clientInfo('https://3dtd.sgeht.net', FIREFOX)).toEqual({ client: 'web', version: null, browser: 'firefox' });
    expect(clientInfo(undefined, 'curl/8.11.1')).toEqual({ client: 'other', version: null, browser: 'other' });
    expect(clientInfo(undefined, undefined)).toEqual({ client: 'other', version: null, browser: 'other' });
  });
});
