import { BufferAttribute, BufferGeometry } from 'three';
import type { RouteBodyStations } from '../../../utils/route-body';

/** Ground height (local y) at local (x, z), null where nothing is known (the route grid's). */
export type OozeGround = (x: number, z: number) => number | null;

/** Headroom on the bounding sphere for what the shader adds: width, crest, wobble (m). */
const BOUNDS_MARGIN_M = 10;

/**
 * Band geometry along a whole route (RouteBodyStations): a row of `across`
 * vertices per station from the left to the right edge of the covered
 * corridor (`cover` of each side's half width). Built once per path; the
 * body's stretch, shape and wobble come from the shader's uniforms
 * (ooze-band-material.ts), so no frame touches a vertex. Vertices outside
 * the body collapse onto the centre line, their triangles to nothing.
 *
 * - position: the station's centre (x, z) and the ground under the vertex
 *   at rest (y)
 * - aSide: the right vector times the covered half width of the vertex's
 *   side (x, y for local x, z) and its place across, -1 at the left edge,
 *   1 at the right (z)
 * - aS: metres along the route
 */
export function buildOozeBandGeometry(
  stations: RouteBodyStations,
  across: number,
  cover: number,
  ground: OozeGround,
): BufferGeometry {
  const n = stations.count;
  const count = n * across;
  const position = new Float32Array(count * 3);
  const side = new Float32Array(count * 3);
  const along = new Float32Array(count);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < across; j++) {
      const v = k * across + j;
      const a = across > 1 ? (2 * j) / (across - 1) - 1 : 0;
      const half = (a < 0 ? stations.left[k] : stations.right[k]) * cover;
      position[v * 3] = stations.x[k];
      position[v * 3 + 2] = stations.z[k];
      side[v * 3] = stations.rightX[k] * half;
      side[v * 3 + 1] = stations.rightZ[k] * half;
      side[v * 3 + 2] = a;
      along[v] = stations.s[k];
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aSide', new BufferAttribute(side, 3));
  geometry.setAttribute('aS', new BufferAttribute(along, 1));

  // Two triangles per quad between neighbouring stations and places across
  const indices = count > 65535 ? new Uint32Array((n - 1) * (across - 1) * 6) : new Uint16Array((n - 1) * (across - 1) * 6);
  let w = 0;
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < across - 1; j++) {
      const a = k * across + j;
      const b = a + 1;
      const c = a + across;
      const d = c + 1;
      indices[w++] = a;
      indices[w++] = b;
      indices[w++] = c;
      indices[w++] = b;
      indices[w++] = d;
      indices[w++] = c;
    }
  }
  geometry.setIndex(new BufferAttribute(indices, 1));

  refreshOozeBandHeights(geometry, stations, across, ground, 0, n - 1);
  // A new geometry uploads whole; the ranges are for later refreshes
  (geometry.getAttribute('position') as BufferAttribute).clearUpdateRanges();
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += BOUNDS_MARGIN_M;
  return geometry;
}

/**
 * Ground heights of the vertices of stations `first` to `last` from
 * `ground`. A vertex without ground takes the ground at its station's
 * centre, or keeps its height. Uploads only that stretch.
 * @returns whether any height changed
 */
export function refreshOozeBandHeights(
  geometry: BufferGeometry,
  stations: RouteBodyStations,
  across: number,
  ground: OozeGround,
  first: number,
  last: number,
): boolean {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const side = geometry.getAttribute('aSide') as BufferAttribute;
  const p = position.array as Float32Array;
  const s = side.array as Float32Array;
  let changed = false;
  for (let k = Math.max(0, first); k <= Math.min(stations.count - 1, last); k++) {
    const centre = ground(stations.x[k], stations.z[k]);
    for (let j = 0; j < across; j++) {
      const v = k * across + j;
      const a = s[v * 3 + 2];
      const y = ground(p[v * 3] + s[v * 3] * a, p[v * 3 + 2] + s[v * 3 + 1] * a) ?? centre;
      if (y !== null && p[v * 3 + 1] !== Math.fround(y)) {
        p[v * 3 + 1] = y;
        changed = true;
      }
    }
  }
  if (changed) {
    const from = Math.max(0, first) * across * 3;
    const to = (Math.min(stations.count - 1, last) + 1) * across * 3;
    position.addUpdateRange(from, to - from);
    position.needsUpdate = true;
  }
  return changed;
}
