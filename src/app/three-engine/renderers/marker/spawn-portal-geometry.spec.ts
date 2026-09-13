import { describe, it, expect } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import {
  createPortalFrameGeometry,
  createPortalGateGeometry,
  createPortalGlowGeometry,
} from './spawn-portal-geometry';
import {
  PORTAL_FRAME_TOP,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_RADIUS,
  PORTAL_SETBACK,
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

  it('füllt die Öffnung mit der Leere (aPart 1), nach beiden Seiten, bis in den Stein', () => {
    const geometry = createPortalGateGeometry();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const part = geometry.getAttribute('aPart');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let front = 0;
    let back = 0;
    for (let i = 0; i < part.count; i++) {
      if (part.getX(i) === 0) continue;
      expect(position.getZ(i)).toBe(0);
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
      if (normal.getZ(i) > 0.99) front++;
      if (normal.getZ(i) < -0.99) back++;
    }
    expect(front).toBe(6);
    expect(back).toBe(6);
    expect(minX).toBeLessThan(-PORTAL_OPENING_WIDTH / 2);
    expect(maxX).toBeGreaterThan(PORTAL_OPENING_WIDTH / 2);
    expect(minY).toBeLessThan(0);
    expect(maxY).toBeGreaterThan(PORTAL_OPENING_HEIGHT);
    // Der Steinteil ist der Rahmen der Vorschau
    const stone = createPortalFrameGeometry().getAttribute('position').count;
    expect(part.count).toBe(stone + 12);
  });

  it('legt das Bodenlicht knapp über den Boden', () => {
    const position = createPortalGlowGeometry().getAttribute('position');
    for (let i = 0; i < position.count; i++) expect(position.getY(i)).toBeGreaterThan(0);
  });
});

describe('Spawn-Portal: Gegner treten aus der Fläche', () => {
  /** Portal wie im Spiel: Tor auf der Pose, Spawn PORTAL_SETBACK hinter der Fläche. */
  function gate(scale: number): Mesh {
    const mesh = new Mesh(createPortalGateGeometry(), new MeshBasicMaterial({ side: DoubleSide }));
    mesh.scale.setScalar(scale);
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  /**
   * Punkte eines Gegnerkörpers am Spawn in Metern, Portalraum: quer bis an
   * die Spur am Rand (Korridor-Halbbreite minus edgeMargin, höchstens die
   * halbe Öffnung minus 1,5 m), 0,4 m Körperradius, bis 2,2 m hoch.
   */
  function bodyAtSpawn(scale: number): Vector3[] {
    const lane = (PORTAL_OPENING_WIDTH / 2) * scale - 1.5;
    const points: Vector3[] = [];
    for (const x of [-lane - 0.4, 0, lane + 0.4]) {
      for (const y of [0.2, 1.2, 2.2]) {
        for (const dz of [-0.4, 0, 0.4]) points.push(new Vector3(x, y, -PORTAL_SETBACK + dz));
      }
    }
    return points;
  }

  /** Kamerarichtungen vor dem Portal: seitlich bis 80°, flach bis steil von oben. */
  function frontCameras(): Vector3[] {
    const dirs: Vector3[] = [];
    for (const azimuth of [-80, -60, -30, 0, 30, 60, 80]) {
      for (const elevation of [5, 30, 60, 80]) {
        const a = (azimuth * Math.PI) / 180;
        const e = (elevation * Math.PI) / 180;
        dirs.push(new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)));
      }
    }
    dirs.push(new Vector3(0, 1, 0));
    return dirs;
  }

  for (const scale of [PORTAL_MIN_SCALE, 1, PORTAL_MAX_SCALE]) {
    it(`verdeckt den Gegner am Spawn vor und über dem Portal (Skala ${scale})`, () => {
      const mesh = gate(scale);
      const raycaster = new Raycaster();
      const visible: string[] = [];
      for (const point of bodyAtSpawn(scale)) {
        expect(point.z).toBeLessThan(0);
        for (const dir of frontCameras()) {
          raycaster.set(point, dir);
          raycaster.far = 200;
          if (raycaster.intersectObject(mesh).length === 0) {
            visible.push(`${point.toArray().map((v) => v.toFixed(1))} -> ${dir.toArray().map((v) => v.toFixed(2))}`);
          }
        }
      }
      expect(visible).toEqual([]);
    });
  }

  it('liegt der Spawn in der Tiefe des Rahmens, auch beim kleinsten Portal', () => {
    // Die Pfeiler reichen vor und hinter die Fläche; ein Spawn weiter
    // hinten stünde hinter dem Tor frei sichtbar.
    const position = createPortalFrameGeometry().getAttribute('position');
    let minZ = 0;
    for (let i = 0; i < position.count; i++) minZ = Math.min(minZ, position.getZ(i));
    expect(PORTAL_SETBACK + 0.4).toBeLessThan(-minZ * PORTAL_MIN_SCALE);
  });
});
