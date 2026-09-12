import { describe, expect, it } from 'vitest';
import { StreetEdgeIndex } from './route-ways';
import type { Street } from '../interfaces/street-network-provider.interface';

// An L: way 1 runs north, way 2 turns east at node 2.
const n1 = { id: 1, lat: 48.0, lon: 9.0 };
const n2 = { id: 2, lat: 48.001, lon: 9.0 };
const n3 = { id: 3, lat: 48.001, lon: 9.0015 };
const streets: Street[] = [
  { id: 1, name: 'North', type: 'residential', nodes: [n1, n2] },
  { id: 2, name: 'East', type: 'primary', nodes: [n2, n3] },
];

describe('StreetEdgeIndex', () => {
  const index = new StreetEdgeIndex(streets);

  it('matches segments that are exact way edges, in either direction', () => {
    expect(index.match([n1, n2, n3]).map((s) => s?.id)).toEqual([1, 2]);
    expect(index.match([n3, n2, n1]).map((s) => s?.id)).toEqual([2, 1]);
  });

  it('matches pieces of an edge that share no node with it', () => {
    // DevWorld subdivides into 2 m pieces; tile measurement splits segments.
    const path = [n1, { lat: 48.0004, lon: 9.0 }, { lat: 48.0008, lon: 9.0 }, n2, { lat: 48.001, lon: 9.0007 }];
    expect(index.match(path).map((s) => s?.id)).toEqual([1, 1, 1, 2]);
  });

  it('leaves a segment off the network unmatched', () => {
    // The last leg to an HQ 20 m off the street.
    const hq = { lat: 48.00118, lon: 9.0007 };
    expect(index.match([n2, { lat: 48.001, lon: 9.0007 }, hq]).map((s) => s?.id ?? null)).toEqual([2, null]);
  });

  it('does not match a segment that continues past the end of an edge', () => {
    // Collinear with way 1, but 50 m beyond node 2.
    expect(index.match([n2, { lat: 48.00145, lon: 9.0 }])).toEqual([null]);
  });
});
