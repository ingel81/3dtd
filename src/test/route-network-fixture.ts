// Shared street-network fixture for corridor specs, used by
// corridor-pick-devworld.scenario.spec.ts and relocation-corridor.scenario.spec.ts.
// Not app code: import only from specs.

import type { StreetNetwork, StreetNode } from '../app/services/location/osm-street.service';

/** The L-shaped street of path-route.service.spec: south to north, then east. */
export function makeNetwork(): StreetNetwork {
  const n10 = { id: 10, lat: 47.999, lon: 9.0 };
  const n1 = { id: 1, lat: 48.0, lon: 9.0 };
  const n2 = { id: 2, lat: 48.001, lon: 9.0 };
  const n3 = { id: 3, lat: 48.001, lon: 9.0015 };
  const n30 = { id: 30, lat: 48.001, lon: 9.003 };
  const streets = [
    { id: 100, nodes: [n10, n1] },
    { id: 200, nodes: [n1, n2, n3] },
    { id: 300, nodes: [n3, n30] },
  ];
  const nodes = new Map<number, StreetNode>();
  for (const s of streets) for (const n of s.nodes) nodes.set(n.id, n);
  return {
    streets: streets.map((s) => ({ ...s, name: `Way ${s.id}`, type: 'residential' })),
    nodes,
    bounds: { minLat: 47.99, maxLat: 48.01, minLon: 8.99, maxLon: 9.01 },
  } as StreetNetwork;
}
