import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { createPortalEnergyGeometry, createPortalFrameGeometry } from './spawn-portal-geometry';
import {
  PORTAL_FRAME_TOP,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_RADIUS,
} from '../../../configs/marker-geometry.config';

describe('Spawn-Portal-Geometrie', () => {
  it('bleibt in den Maßen, mit denen Intro und Totale rechnen', () => {
    const position = createPortalFrameGeometry().getAttribute('position');
    let top = -Infinity;
    let radius = 0;
    for (let i = 0; i < position.count; i++) {
      top = Math.max(top, position.getY(i));
      radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
    }
    expect(top).toBeCloseTo(PORTAL_FRAME_TOP, 5);
    expect(radius).toBeLessThanOrEqual(PORTAL_RADIUS);
    // Nicht bloß darunter: der Radius liegt dicht an den Plinthen
    expect(radius).toBeGreaterThan(PORTAL_RADIUS - 0.5);
  });

  it('lässt die Öffnung frei: kein Rahmenteil zwischen den Pfeilern unterhalb des Sturzes', () => {
    const geometry = createPortalFrameGeometry();
    const position = geometry.getAttribute('position');
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const centroid = new Vector3();
    for (let i = 0; i < position.count; i += 3) {
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, i + 1);
      c.fromBufferAttribute(position, i + 2);
      centroid.copy(a).add(b).add(c).divideScalar(3);
      const inOpening = Math.abs(centroid.x) < PORTAL_OPENING_WIDTH / 2 - 0.2
        && centroid.y > 1.5 && centroid.y < PORTAL_OPENING_HEIGHT - 0.1;
      expect(inOpening).toBe(false);
    }
  });

  it('dreht die Flächen nach außen (Wicklung gegen den Uhrzeigersinn)', () => {
    // Die Normalen kommen aus der Wicklung. Unterseiten im Boden (y = -2)
    // müssen nach unten zeigen, die Deckfläche des Sturzes nach oben, die
    // Innenseiten der Pfeiler zur Öffnung: dann ist die Wicklung außen.
    const geometry = createPortalFrameGeometry();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const n = new Vector3();
    let bottoms = 0;
    let lintelTops = 0;
    let innerSides = 0;
    for (let i = 0; i < position.count; i += 3) {
      n.fromBufferAttribute(normal, i);
      expect(n.length()).toBeCloseTo(1, 5);
      const ys = [position.getY(i), position.getY(i + 1), position.getY(i + 2)];
      const xs = [position.getX(i), position.getX(i + 1), position.getX(i + 2)];
      if (ys.every((y) => y === -2)) {
        expect(n.y).toBeCloseTo(-1, 5);
        bottoms++;
      }
      if (ys.every((y) => Math.abs(y - (PORTAL_OPENING_HEIGHT + 2.6)) < 1e-4) && xs.some((x) => Math.abs(x) > 3)) {
        expect(n.y).toBeCloseTo(1, 5);
        lintelTops++;
      }
      if (xs.every((x) => Math.abs(Math.abs(x) - PORTAL_OPENING_WIDTH / 2) < 1e-4) && ys.some((y) => y > 5)) {
        expect(Math.sign(n.x)).toBe(-Math.sign(xs[0]));
        innerSides++;
      }
    }
    expect(bottoms).toBeGreaterThan(0);
    expect(lintelTops).toBeGreaterThan(0);
    expect(innerSides).toBe(4);
  });

  it('teilt die Energie in Fläche (aPart 0) und Bodenlicht (aPart 1)', () => {
    const geometry = createPortalEnergyGeometry();
    const position = geometry.getAttribute('position');
    const part = geometry.getAttribute('aPart');
    for (let i = 0; i < part.count; i++) {
      if (part.getX(i) === 0) expect(position.getZ(i)).toBe(0);
      else expect(position.getY(i)).toBeGreaterThan(0);
    }
  });
});
