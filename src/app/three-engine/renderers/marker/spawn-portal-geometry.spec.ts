import { describe, it, expect } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import {
  PORTAL_SHADER_LAYOUT,
  createPortalFrameGeometry,
  createPortalGateGeometry,
  createPortalGlowGeometry,
} from './spawn-portal-geometry';
import { SPAWN_PORTAL_LOOK } from '../../../configs/visual-effects.config';
import {
  PORTAL_DEPTH,
  PORTAL_FRAME_TOP,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_RADIUS,
  portalDepthScale,
} from '../../../configs/marker-geometry.config';
import { lateralLimit } from '../../../utils/route-corridor';

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
    // und die Unterseite des Sturzes über der Öffnung müssen nach unten
    // zeigen, die Deckflächen der oberen Plinthenstufe (y = 1,9) nach oben,
    // die Innenseiten der Pfeiler zur Öffnung: dann ist die Wicklung außen.
    const geometry = createPortalFrameGeometry();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const n = new Vector3();
    let bottoms = 0;
    let lintelUndersides = 0;
    let plinthTops = 0;
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
      if (ys.every((y) => Math.abs(y - PORTAL_OPENING_HEIGHT) < 1e-4)) {
        expect(n.y).toBeCloseTo(-1, 5);
        lintelUndersides++;
      }
      if (ys.every((y) => Math.abs(y - 1.9) < 1e-4)) {
        expect(n.y).toBeCloseTo(1, 5);
        plinthTops++;
      }
      if (xs.every((x) => Math.abs(Math.abs(x) - PORTAL_OPENING_WIDTH / 2) < 1e-4) && ys.some((y) => y > 5)) {
        expect(Math.sign(n.x)).toBe(-Math.sign(xs[0]));
        innerSides++;
      }
    }
    expect(bottoms).toBeGreaterThan(0);
    expect(lintelUndersides).toBe(2);
    expect(plinthTops).toBe(4);
    expect(innerSides).toBe(4);
  });

  it('kennt an jeder Ecke ihren Platz auf der Fläche, für die Kantenabnutzung', () => {
    const geometry = createPortalFrameGeometry();
    const face = geometry.getAttribute('aFace');
    const width = geometry.getAttribute('aWidth');
    expect(face.count).toBe(geometry.getAttribute('position').count);
    expect(width.count).toBe(face.count);
    /** Abstand zum Rand der Fläche aus aFace und aWidth, wie im Shader */
    const edge = (across: number, up: number, height: number, w0: number, w1: number) =>
      Math.min(0.5 * (w0 + (w1 - w0) * (up / height)) - Math.abs(across), up, height - up);
    for (let i = 0; i < face.count; i += 3) {
      // Jede Ecke liegt auf dem Rand ihrer Fläche ...
      let across = 0, up = 0;
      for (let k = i; k < i + 3; k++) {
        expect(face.getZ(k)).toBeGreaterThan(0);
        expect(Math.abs(edge(face.getX(k), face.getY(k), face.getZ(k), width.getX(k), width.getY(k)))).toBeLessThan(1e-4);
        across += face.getX(k) / 3;
        up += face.getY(k) / 3;
      }
      // ... und der Schwerpunkt jedes Dreiecks in ihr
      expect(edge(across, up, face.getZ(i), width.getX(i), width.getY(i))).toBeGreaterThan(1e-3);
    }
  });

  it('schließt die Öffnung vorn und hinten mit der Leere (aPart 1), PORTAL_DEPTH auseinander, bis in den Stein', () => {
    const geometry = createPortalGateGeometry();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const part = geometry.getAttribute('aPart');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let front = 0;
    let back = 0;
    for (let i = 0; i < part.count; i++) {
      if (part.getX(i) === 0) continue;
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
    // Der Steinteil ist der Rahmen der Vorschau
    const stone = createPortalFrameGeometry().getAttribute('position').count;
    expect(part.count).toBe(stone + 12);
  });

  it('macht den Rahmen tiefer als das Volumen: Pfeiler und Sturz stehen vor und hinter den Flächen', () => {
    const position = createPortalFrameGeometry().getAttribute('position');
    let minZ = 0;
    let maxZ = 0;
    for (let i = 0; i < position.count; i++) {
      minZ = Math.min(minZ, position.getZ(i));
      maxZ = Math.max(maxZ, position.getZ(i));
    }
    expect(maxZ).toBeGreaterThan(PORTAL_DEPTH / 2 + 0.2);
    expect(minZ).toBeLessThan(-PORTAL_DEPTH / 2 - 0.2);
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

/**
 * Bodies of the ground enemies at their config scale (m): width across,
 * height, length along the way they walk (+z of the model). Bounding boxes
 * of their GLBs times `scale` in enemy-types.config.ts, measured
 * 2026-09-13. The air units (bat, dragon, hornet) fly 15 to 20 m above the
 * ground and are not held by the portal.
 */
const GROUND_BODIES: Record<string, readonly [number, number, number]> = {
  zombie: [2.2, 4.2, 1.9],
  'zombie-v2': [3.6, 4.1, 0.8],
  tank: [3.7, 3.2, 9.2],
  wallsmasher: [11.0, 5.8, 2.4],
  'stone-golem': [12.6, 12.4, 7.1],
  penguin: [1.9, 2.3, 1.3],
  herbert: [2.4, 4.4, 1.2],
  'zombie-soldier': [2.4, 4.6, 0.9],
  rat: [1.9, 0.6, 0.4],
  skeleton: [3.0, 2.8, 1.3],
  'skeleton-minion': [1.8, 1.7, 0.8],
  spider: [3.7, 4.2, 0.9],
  mammoth: [9.9, 6.4, 3.3],
  bear: [5.8, 3.7, 2.6],
  ghost: [2.3, 3.7, 2.6],
  mech: [7.6, 11.7, 9.3],
  wraith: [1.5, 3.4, 1.3],
};

describe('Spawn-Portal: Gegner stehen im Volumen, bis sie vorn heraustreten', () => {
  /** Portal wie im Spiel: Tor auf der Pose, die Tiefe nicht unter Skala 1. */
  function gate(scale: number): Mesh {
    const mesh = new Mesh(createPortalGateGeometry(), new MeshBasicMaterial({ side: DoubleSide }));
    mesh.scale.set(scale, scale, portalDepthScale(scale));
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  /**
   * Punkte eines Körpers am Spawn, der Mitte des Portals: seine Box um die
   * Spur `lane` quer zur Öffnung, vom Boden bis zu seiner Höhe, über seine
   * Länge vor und hinter der Mitte.
   */
  function bodyPoints([width, height, length]: readonly [number, number, number], lane: number): Vector3[] {
    const points: Vector3[] = [];
    for (const x of [lane - width / 2, lane, lane + width / 2]) {
      for (const y of [0.2, height / 2, height]) {
        for (const z of [-length / 2, 0, length / 2]) points.push(new Vector3(x, y, z));
      }
    }
    return points;
  }

  /** Blickrichtungen rundum: vorn, seitlich, hinten, flach bis steil von oben. */
  function allAround(): Vector3[] {
    const dirs: Vector3[] = [];
    for (let azimuth = 0; azimuth < 360; azimuth += 45) {
      for (const elevation of [5, 30, 60, 85]) {
        const a = (azimuth * Math.PI) / 180;
        const e = (elevation * Math.PI) / 180;
        dirs.push(new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)));
      }
    }
    dirs.push(new Vector3(0, 1, 0));
    return dirs;
  }

  /** Gegner, die von irgendwo zu sehen wären, bevor sie vorn heraustreten. */
  function seen(scale: number): string[] {
    const mesh = gate(scale);
    const raycaster = new Raycaster();
    raycaster.far = 300;
    // Spuren wie EnemyManager und MovementComponent sie legen: bis zur
    // seitlichen Grenze des Korridors, dessen Breite die Skala gab
    const lane = lateralLimit((PORTAL_OPENING_WIDTH / 2) * scale);
    const out = new Set<string>();
    for (const [type, body] of Object.entries(GROUND_BODIES)) {
      // Breite Körper gehen mittig heraus, schmale auf jeder Spur
      const lanes = body[0] / 2 + lane <= (PORTAL_OPENING_WIDTH / 2) * scale ? [-lane, 0, lane] : [0];
      for (const x of lanes) {
        for (const point of bodyPoints(body, x)) {
          for (const dir of allAround()) {
            raycaster.set(point, dir);
            if (raycaster.intersectObject(mesh).length === 0) out.add(type);
          }
        }
      }
    }
    return [...out].sort();
  }

  it('verbirgt jeden Bodengegner von allen Seiten, auch von hinten (Skala 1)', () => {
    expect(seen(1)).toEqual([]);
  });

  it('verbirgt jeden Bodengegner von allen Seiten, auch von hinten (größtes Portal)', () => {
    expect(seen(PORTAL_MAX_SCALE)).toEqual([]);
  });

  it('verbirgt im kleinsten Portal alle bis auf die, die breiter oder höher sind als das Tor', () => {
    // Skala 0,75 (Gasse): Öffnung 6 × 8,25 m, Sturzoberkante 10,5 m; die
    // Tiefe bleibt die von Skala 1
    expect(seen(PORTAL_MIN_SCALE)).toEqual(['mammoth', 'mech', 'stone-golem', 'wallsmasher']);
  });
});
