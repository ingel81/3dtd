import { describe, it, expect } from 'vitest';
import { BoxGeometry, Float32BufferAttribute } from 'three';
import {
  PORTAL_SHADER_LAYOUT,
  createPortalGateGeometry,
  createPortalGlowGeometry,
} from './spawn-portal-geometry';
import { SPAWN_PORTAL_LOOK } from '../../../configs/visual-effects.config';
import {
  PORTAL_DEPTH,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
} from '../../../configs/marker-geometry.config';

// The frame is an asset: spawn-portal-frame.spec.ts reads it and holds it
// to the extents, the opening and the volume.

describe('Spawn-Portal-Geometrie', () => {
  it('schließt die Öffnung vorn und hinten mit der Leere (aPart 1), PORTAL_DEPTH auseinander, bis in den Stein', () => {
    const geometry = createPortalGateGeometry(null);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const part = geometry.getAttribute('aPart');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let front = 0;
    let back = 0;
    for (let i = 0; i < part.count; i++) {
      expect(part.getX(i)).toBe(1);
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
      // Die vordere Fläche schaut nach vorn, die hintere nach hinten
      if (normal.getZ(i) > 0.99) {
        expect(position.getZ(i)).toBeCloseTo(PORTAL_DEPTH / 2);
        front++;
      }
      if (normal.getZ(i) < -0.99) {
        expect(position.getZ(i)).toBeCloseTo(-PORTAL_DEPTH / 2);
        back++;
      }
    }
    expect(front).toBe(6);
    expect(back).toBe(6);
    expect(minX).toBeLessThan(-PORTAL_OPENING_WIDTH / 2);
    expect(maxX).toBeGreaterThan(PORTAL_OPENING_WIDTH / 2);
    expect(minY).toBeLessThan(0);
    expect(maxY).toBeGreaterThan(PORTAL_OPENING_HEIGHT);
  });

  it('hängt die Leere an den Rahmen (aPart 0), ohne ihn zu ändern', () => {
    const frame = new BoxGeometry(2, 2, 2);
    const vertices = frame.getAttribute('position').count;
    frame.setAttribute('tangent', new Float32BufferAttribute(new Float32Array(vertices * 4), 4));
    const gate = createPortalGateGeometry(frame);
    const part = gate.getAttribute('aPart');
    expect(part.count).toBe(vertices + 12);
    for (let i = 0; i < vertices; i++) expect(part.getX(i)).toBe(0);
    expect(gate.getIndex()!.count).toBe(frame.getIndex()!.count + 12);
    expect(frame.getAttribute('aPart')).toBeUndefined();
  });

  it('legt das Bodenlicht knapp über den Boden, vor die vordere und hinter die hintere Fläche', () => {
    const position = createPortalGlowGeometry().getAttribute('position');
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeGreaterThan(0);
      minZ = Math.min(minZ, position.getZ(i));
      maxZ = Math.max(maxZ, position.getZ(i));
    }
    expect(maxZ).toBeGreaterThan(PORTAL_DEPTH / 2 + 5);
    expect(minZ).toBeLessThan(-PORTAL_DEPTH / 2 - 2);
  });

  it('legt den Beschwörungskreis ganz in das Bodenlicht vor der vorderen Fläche', () => {
    // Der Kreis misst ab der vorderen Fläche; die Tiefe wächst nie
    // langsamer als die Breite (portalDepthScale), so bleibt er auf jeder
    // Skala im Fleck
    const L = PORTAL_SHADER_LAYOUT;
    const C = SPAWN_PORTAL_LOOK.circle;
    expect(C.centre - C.radius).toBeGreaterThan(0);
    expect(C.centre + C.radius).toBeLessThan(L.groundFront);
    expect(C.radius).toBeLessThan(L.groundHalfWidth);
  });
});
