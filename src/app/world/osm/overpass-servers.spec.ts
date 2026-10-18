import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boxAround } from '../../services/location/street-box';
import { OVERPASS_SERVERS, serverCovers, serversFor } from './overpass-servers';

/** Which servers a query box gets, and that the page may reach every one of them */

const STREETS_M = 2000;
const hostsFor = (lat: number, lon: number) => serversFor(OVERPASS_SERVERS, boxAround(lat, lon, STREETS_M)).map((s) => new URL(s.url).host);
const GLOBAL = ['overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru'];

describe('overpass-servers', () => {
  it.each<[string, number, number, string | null]>([
    ['Zürich', 47.3769, 8.5417, 'overpass.osm.ch'],
    ['Bern', 46.948, 7.4474, 'overpass.osm.ch'],
    ['Geneva', 46.2044, 6.1432, 'overpass.osm.ch'],
    ['Lugano', 46.0037, 8.9511, 'overpass.osm.ch'],
    ['London', 51.5074, -0.1278, 'overpass.atownsend.org.uk'],
    ['Edinburgh', 55.9533, -3.1883, 'overpass.atownsend.org.uk'],
    ['Dublin', 53.3498, -6.2603, 'overpass.atownsend.org.uk'],
    ['Miltenberg', 49.7036, 9.2647, null],
    ['Calais', 50.9513, 1.8587, null],
    ['Konstanz', 47.6603, 9.1758, null],
    ['Richmond', 37.5407, -77.436, null],
  ])('%s: the regional server where one holds the whole box, then the global ones', (_place, lat, lon, regional) => {
    expect(hostsFor(lat, lon)).toEqual(regional ? [regional, ...GLOBAL] : GLOBAL);
  });

  it('takes a regional server only for a box wholly inside one of its boxes, and for no query without a box', () => {
    const ch = OVERPASS_SERVERS.find((s) => s.url.includes('osm.ch'))!;
    expect(serverCovers(ch, { minLat: 47.3, minLon: 8.5, maxLat: 47.4, maxLon: 8.6 })).toBe(true);
    // From Zürich across the Rhine to Germany
    expect(serverCovers(ch, { minLat: 47.3, minLon: 8.5, maxLat: 47.8, maxLon: 8.6 })).toBe(false);
    expect(serverCovers(ch, undefined)).toBe(false);
    expect(serversFor(OVERPASS_SERVERS, undefined).every((s) => s.coverage === null)).toBe(true);
  });

  it('lists only origins the web CSP lets the page reach', () => {
    const htaccess = readFileSync(join(process.cwd(), 'public/.htaccess'), 'utf8');
    const policies = htaccess.split('\n').filter((line) => line.includes('connect-src') && line.includes('nominatim'));
    expect(policies.length).toBeGreaterThan(0);
    for (const server of OVERPASS_SERVERS) {
      const origin = new URL(server.url).origin;
      for (const policy of policies) expect(policy.split(/[\s;"]+/), origin).toContain(origin);
    }
  });
});
