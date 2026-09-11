import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitGroundBox, type GroundBoxFit } from './camera-fit';
import { DEG_TO_RAD } from './geo-utils';

/**
 * Stellt die Kamera wie CameraFramingService auf (Blick nach +Z, um `pitch` nach
 * unten geneigt, Ziel bei z = targetOffset) und projiziert die vier Boxecken in NDC.
 */
function projectCorners(
  fit: GroundBoxFit,
  halfWidth: number,
  halfDepth: number,
  fov: number,
  aspect: number,
  pitch: number,
): Vector3[] {
  const camera = new PerspectiveCamera(fov, aspect, 0.1, 1e7);
  const s = Math.sin(pitch * DEG_TO_RAD);
  const c = Math.cos(pitch * DEG_TO_RAD);
  camera.position.set(0, fit.distance * s, fit.targetOffset - fit.distance * c);
  camera.lookAt(0, 0, fit.targetOffset);
  camera.updateMatrixWorld();

  const corners: Vector3[] = [];
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      corners.push(new Vector3(x, 0, z).project(camera));
    }
  }
  return corners;
}

const EDGE = 0.03;
const LIMIT = 1 - 2 * EDGE;

describe('fitGroundBox', () => {
  it.each([
    // [Name, halfWidth, halfDepth, fov, aspect, pitch]
    ['Querformat, tiefe Box (vertikal bindend)', 150, 300, 60, 16 / 9, 70],
    ['Querformat, breite Box (horizontal bindend)', 900, 100, 60, 16 / 9, 70],
    ['Hochformat, quadratische Box', 200, 200, 60, 9 / 16, 70],
    ['Hochformat, tiefe Box', 60, 500, 60, 9 / 16, 70],
    ['kleine Box, flachere Neigung', 25, 25, 60, 4 / 3, 45],
    ['große Box, fast senkrecht', 1500, 1200, 75, 16 / 9, 85],
  ])('%s: Box liegt im Bild, oben und unten gleicher Rand, eine Richtung füllt bis zum Rand', (_name, hw, hd, fov, aspect, pitch) => {
    const fit = fitGroundBox(hw, hd, fov, aspect, pitch, EDGE);
    const ndc = projectCorners(fit, hw, hd, fov, aspect, pitch);

    // Alle Ecken vor der Kamera und innerhalb von near/far
    for (const p of ndc) {
      expect(p.z).toBeGreaterThan(-1);
      expect(p.z).toBeLessThan(1);
    }

    const maxX = Math.max(...ndc.map(p => Math.abs(p.x)));
    const minY = Math.min(...ndc.map(p => p.y));
    const maxY = Math.max(...ndc.map(p => p.y));

    expect(maxX).toBeLessThanOrEqual(LIMIT + 1e-9);
    expect(maxY).toBeLessThanOrEqual(LIMIT + 1e-9);
    expect(minY).toBeCloseTo(-maxY, 9);
    expect(Math.max(maxX, maxY)).toBeCloseTo(LIMIT, 9);
  });

  it('bindet vertikal bei tiefer und horizontal bei breiter Box', () => {
    const deep = fitGroundBox(150, 300, 60, 16 / 9, 70, EDGE);
    const deepNdc = projectCorners(deep, 150, 300, 60, 16 / 9, 70);
    expect(Math.max(...deepNdc.map(p => p.y))).toBeCloseTo(LIMIT, 9);

    const wide = fitGroundBox(900, 100, 60, 16 / 9, 70, EDGE);
    const wideNdc = projectCorners(wide, 900, 100, 60, 16 / 9, 70);
    expect(Math.max(...wideNdc.map(p => Math.abs(p.x)))).toBeCloseTo(LIMIT, 9);
  });

  it('skaliert linear mit der Boxgröße', () => {
    const small = fitGroundBox(100, 80, 60, 16 / 9, 70, EDGE);
    const large = fitGroundBox(1000, 800, 60, 16 / 9, 70, EDGE);
    expect(large.distance).toBeCloseTo(small.distance * 10, 6);
    expect(large.targetOffset).toBeCloseTo(small.targetOffset * 10, 6);
  });

  it('rückt das Ziel bei Neigung zur Kamera und lässt es senkrecht auf der Mitte', () => {
    expect(fitGroundBox(200, 200, 60, 16 / 9, 70, EDGE).targetOffset).toBeLessThan(0);

    const straightDown = fitGroundBox(200, 300, 60, 16 / 9, 90, EDGE);
    const tanHalfV = Math.tan(30 * DEG_TO_RAD);
    expect(straightDown.targetOffset).toBeCloseTo(0, 9);
    expect(straightDown.distance).toBeCloseTo(
      Math.max(300 / (LIMIT * tanHalfV), 200 / (LIMIT * (16 / 9) * tanHalfV)),
      6,
    );
  });

  it('holt die Kamera beim Spiel-Setup (70°, FOV 60, 16:9) auf rund 0,83 × Boxtiefe heran', () => {
    // Vorher erzwang minDistForZCoverage mit dem Faktor 1,15 etwa 1,68 × Boxtiefe.
    const fit = fitGroundBox(250, 250, 60, 16 / 9, 70, EDGE);
    expect(fit.distance / 500).toBeCloseTo(0.83, 2);
  });

  it('lehnt eine Neigung ab, bei der die obere Bildkante über dem Horizont liegt', () => {
    expect(() => fitGroundBox(100, 100, 60, 16 / 9, 20, EDGE)).toThrow(RangeError);
  });
});
