// Shared portal-preview fixtures, used by map-placement.service.spec.ts,
// game-loop-facade.rotation.scenario.spec.ts and spawn-preview.perf.spec.ts.
// Not app code: import only from specs.

import { Group, Mesh, MeshBasicMaterial, MeshPhongMaterial, PlaneGeometry, Vector3 } from 'three';

/** 0.001 degree = 100 m, +X west, +Z north, like the engine's frame. */
export function makeGeoToLocal(origin: { lat: number; lon: number }) {
  return (lat: number, lon: number, height: number): Vector3 =>
    new Vector3((origin.lon - lon) * 1e5, height, (lat - origin.lat) * 1e5);
}

/** A stand-in for the portal preview: a frame in Phong and a surface in Basic, as createPortalPreview builds it. */
export function fakePortalPreview(color: number): Group {
  const group = new Group();
  group.add(new Mesh(new PlaneGeometry(), new MeshPhongMaterial({ color })));
  group.add(new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ color })));
  return group;
}
