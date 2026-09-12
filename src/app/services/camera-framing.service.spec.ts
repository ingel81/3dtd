import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraFramingService, type CameraFrame, type GeoPoint } from './camera-framing.service';
import {
  HQ_MARKER_SCALE,
  MARKER_FLOAT_HEIGHT,
  MARKER_LABEL_TOP,
  MARKER_RING_RADIUS,
  PORTAL_LABEL_TOP,
  PORTAL_MAX_RADIUS,
  PORTAL_MAX_TOP,
} from '../configs/marker-geometry.config';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';

const HQ: GeoPoint = { lat: 48.9, lon: 9.2 };
const EDGE = 0.03;
const LIMIT = 1 - 2 * EDGE;

/** Geo point `x` m west (+X) and `z` m north (+Z) of the HQ, as geoToLocalApproximate reads it. */
function at(x: number, z: number): GeoPoint {
  const perLon = METERS_PER_DEGREE_LAT * Math.cos((HQ.lat * Math.PI) / 180);
  return { lat: HQ.lat + z / METERS_PER_DEGREE_LAT, lon: HQ.lon - x / perLon };
}

function cameraFor(frame: CameraFrame, fov: number, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, aspect, 0.1, 1e6);
  camera.position.set(frame.camX, frame.camY, frame.camZ);
  camera.lookAt(frame.lookAtX, frame.lookAtY, frame.lookAtZ);
  camera.updateMatrixWorld();
  return camera;
}

/** Four points `r` out from (x, z) at height y, plus a label top straight above. */
function parts(x: number, z: number, r: number, y: number, labelTop: number): Vector3[] {
  return [
    new Vector3(x + r, y, z),
    new Vector3(x - r, y, z),
    new Vector3(x, y, z + r),
    new Vector3(x, y, z - r),
    new Vector3(x, labelTop, z),
  ];
}

/** Ring extremes and label top of the HQ diamond, terrain at y = 0. */
const hqParts = (x: number, z: number) =>
  parts(x, z, MARKER_RING_RADIUS * HQ_MARKER_SCALE, MARKER_FLOAT_HEIGHT, MARKER_FLOAT_HEIGHT + MARKER_LABEL_TOP);

/** Reach of the largest portal at its crown and its label top, terrain at y = 0. */
const portalParts = (x: number, z: number) => parts(x, z, PORTAL_MAX_RADIUS, PORTAL_MAX_TOP, PORTAL_LABEL_TOP);

describe('CameraFramingService: Totale mit HQ-Diamant und Spawn-Portal', () => {
  it.each([
    // [Name, fov, aspect, Spawn x, Spawn z]
    ['Querformat wie im Playtest, Spawn in der fernen Ecke', 60, 1.8635, 327.5, 243.8],
    ['Querformat, Spawn nah am HQ', 60, 1.8635, -80, 60],
    ['Hochformat, lange Route nach Norden', 60, 0.6, 150, 400],
  ])('%s: HQ, Spawn und Route bleiben im Bild', (_name, fov, aspect, sx, sz) => {
    const local: [number, number][] = [[0, 0], [sx / 2, 0], [sx, sz / 2], [sx, sz]];
    const frame = new CameraFramingService().computeInitialFrame(HQ, [at(sx, sz)], {
      fov,
      aspectRatio: aspect,
      routePoints: local.map(([x, z]) => at(x, z)),
      edgeMargin: EDGE,
      // Ohne Zugaben muss das äußerste Teil genau am Rand liegen.
      padding: 0,
      markerRadius: 0,
    });
    const camera = cameraFor(frame, fov, aspect);

    const parts = [
      ...hqParts(0, 0),
      ...portalParts(sx, sz),
      ...local.map(([x, z]) => new Vector3(x, 0, z)),
    ];
    let outermost = 0;
    for (const part of parts) {
      const ndc = part.clone().project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(LIMIT + 1e-3);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(LIMIT + 1e-3);
      outermost = Math.max(outermost, Math.abs(ndc.x), Math.abs(ndc.y));
    }
    // Eingepasst, nicht bloß weit weg: das äußerste Teil liegt am Rand. Die
    // Labels rechnet der Fit etwas breiter als hier geprüft, daher die Toleranz.
    expect(outermost).toBeGreaterThan(LIMIT - 0.05);
  });

  it('setzt die Totale auf den Median der Zellen, nicht auf ein Loch unter dem HQ', () => {
    const service = new CameraFramingService();
    service.setEngine({
      sync: { geoToLocalSimple: (lat: number, lon: number) => ({ x: (lon - HQ.lon) * 1e5, y: 0, z: (lat - HQ.lat) * 1e5 }) },
      // Einzelprobe unter dem HQ im Mesh-Loch, wie im Playtest in Stuttgart
      getTerrainHeightAtGeo: () => -748.8,
      getCamera: () => new PerspectiveCamera(60, 1.8635, 1, 8000),
    } as never);
    const route = [at(0, 0), at(50, 200), at(100, 400)];
    // Zellen um 296 m, eine davon ebenfalls im Loch
    let calls = 0;
    const groundAt = () => ({ y: calls++ === 1 ? -780 : 296, reliable: true });

    const withCells = service.computeFrameWithEngine(HQ, [at(100, 400)], { routePoints: route, groundAt })!;
    expect(withCells.lookAtY).toBe(296);
    expect(withCells.camY).toBeGreaterThan(296);

    // Ohne Zellen bleibt nur die Probe unter dem HQ
    const withoutCells = service.computeFrameWithEngine(HQ, [at(100, 400)], { routePoints: route })!;
    expect(withoutCells.lookAtY).toBe(-748.8);
  });

  it('nimmt verlässliche Zellen vor groben, und alle, wenn zu wenige verlässlich sind', () => {
    const service = new CameraFramingService();
    service.setEngine({
      sync: { geoToLocalSimple: (lat: number, lon: number) => ({ x: (lon - HQ.lon) * 1e5, y: 0, z: (lat - HQ.lat) * 1e5 }) },
      getTerrainHeightAtGeo: () => null,
      getCamera: () => new PerspectiveCamera(60, 1.8635, 1, 8000),
    } as never);
    const route = [at(0, 0), at(30, 100), at(60, 200), at(90, 300), at(120, 400)];
    const spawn = [at(120, 400)];

    // Kalter Cache: die meisten Zellen von groben Tiles, weit unter dem Boden
    let i = 0;
    const mostlyCoarse = () => (i++ % 2 === 0 ? { y: 296, reliable: true } : { y: -500, reliable: false });
    expect(service.computeFrameWithEngine(HQ, spawn, { routePoints: route, groundAt: mostlyCoarse })!.lookAtY).toBe(296);

    // Unter drei verlässlichen zählen alle Zellen
    let j = 0;
    const fewReliable = () => (j++ === 0 ? { y: 296, reliable: true } : { y: 280, reliable: false });
    expect(service.computeFrameWithEngine(HQ, spawn, { routePoints: route, groundAt: fewReliable })!.lookAtY).toBe(280);

    // Weder Zellen noch Probe: kein Frame statt einer geratenen Pose
    expect(service.computeFrameWithEngine(HQ, spawn, { routePoints: route, groundAt: () => null })).toBeNull();
  });

  it('rechnet mit der übergebenen Linse: kleineres FOV heißt größerer Abstand', () => {
    const service = new CameraFramingService();
    const route = [at(0, 0), at(300, 200)];
    const wide = service.computeInitialFrame(HQ, [at(300, 200)], { fov: 75, aspectRatio: 16 / 9, routePoints: route });
    const narrow = service.computeInitialFrame(HQ, [at(300, 200)], { fov: 60, aspectRatio: 16 / 9, routePoints: route });
    expect(narrow.cameraDistance).toBeGreaterThan(wide.cameraDistance * 1.2);
  });
});
