import { describe, expect, it } from 'vitest';
import { UNNAMED_STREET, type Street, type StreetNetwork, type StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { SPAWN_LABEL_FALLBACK, spawnLabel } from './spawn-label';

const ORIGIN = { lat: 52.37, lon: 4.89 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
const geoAt = (x: number, z: number) => ({
  lat: ORIGIN.lat + z / METERS_PER_DEGREE_LAT,
  lon: ORIGIN.lon + x / M_PER_DEG_LON,
});

let nextNode = 1;
/** An east-west street at z metres north of the origin, 400 m long. */
function street(id: number, name: string, z: number): Street {
  const nodes: StreetNode[] = [-200, 0, 200].map((x) => ({ id: nextNode++, ...geoAt(x, z) }));
  return { id, name, type: 'residential', nodes };
}

function network(streets: Street[]): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  for (const s of streets) for (const n of s.nodes) nodes.set(n.id, n);
  return { streets, nodes, bounds: { minLat: 52, maxLat: 53, minLon: 4, maxLon: 5 } };
}

describe('spawnLabel', () => {
  it('names the street the spawn stands on', () => {
    const net = network([street(1, 'Damrak', 0), street(2, 'Rokin', 60)]);
    const at = geoAt(10, 2);
    expect(spawnLabel(net, at.lat, at.lon)).toBe('Damrak');
  });

  it('on an unnamed way takes the nearest named street within about a block', () => {
    const net = network([street(1, UNNAMED_STREET, 0), street(2, '', 20), street(3, 'Rokin', 100)]);
    const at = geoAt(10, 0);
    expect(spawnLabel(net, at.lat, at.lon)).toBe('Rokin');
  });

  it('falls back to "Spawn" when the nearest named street is too far to be meant', () => {
    const net = network([street(1, UNNAMED_STREET, 0), street(2, 'Rokin', 400)]);
    const at = geoAt(10, 0);
    expect(spawnLabel(net, at.lat, at.lon)).toBe(SPAWN_LABEL_FALLBACK);
  });

  it('falls back to "Spawn" on a network without streets', () => {
    const at = geoAt(0, 0);
    expect(spawnLabel(network([]), at.lat, at.lon)).toBe(SPAWN_LABEL_FALLBACK);
  });
});
