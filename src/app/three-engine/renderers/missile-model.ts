import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MISSILE_LAUNCH_LOOK as LOOK } from '../../configs/visual-effects.config';
import { unpickable } from './effect-buffers';

const SEGMENTS = 20;
const FINS = 4;

/** `geometry` without its index and uv, every vertex in `hex`, ready to merge */
function painted(geometry: BufferGeometry, hex: number): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('uv');
  const color = new Color(hex);
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  flat.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return flat;
}

/** A band of the body from `from` to `to` (shares of the length), `radius` m, in `hex` */
function band(radius: number, length: number, from: number, to: number, hex: number): BufferGeometry {
  const height = (to - from) * length;
  const geometry = new CylinderGeometry(radius, radius, height, SEGMENTS, 1, true);
  geometry.translate(0, from * length + height / 2, 0);
  return painted(geometry, hex);
}

/**
 * The missile of the nuclear strike, built from primitives (Phase 1, until
 * the silo model brings its own): a nozzle bell, a dark lower and a grey
 * upper body, a red ring, a white nose and four black fins at the tail.
 * One mesh, vertex colours, lit like the towers.
 *
 * The convention any missile model keeps, so another can take its place:
 * the origin on the nozzle's exit, the nose up +y, `length` m long. The
 * flight moves that origin along its path and turns +y along the way.
 */
export function createMissileModel(
  length: number = LOOK.missile.length,
  radius: number = LOOK.missile.radius,
): Mesh<BufferGeometry, MeshStandardMaterial> {
  const colors = LOOK.colors.missile;
  const parts: BufferGeometry[] = [];

  // Nozzle: a bell, open below, narrowing into the body
  const bell = [
    new Vector2(radius * 0.72, 0),
    new Vector2(radius * 0.6, length * 0.03),
    new Vector2(radius * 0.46, length * 0.06),
    new Vector2(radius * 0.4, length * 0.085),
  ];
  parts.push(painted(new LatheGeometry(bell, SEGMENTS), colors.nozzle));

  // Body: dark below, grey above, the red ring, closed at the tail
  parts.push(band(radius, length, 0.08, 0.38, colors.lower));
  parts.push(band(radius, length, 0.38, 0.64, colors.upper));
  parts.push(band(radius * 1.03, length, 0.64, 0.7, colors.ring));
  const tail = new CylinderGeometry(radius, radius, 0.01, SEGMENTS);
  tail.translate(0, length * 0.08, 0);
  parts.push(painted(tail, colors.lower));

  // Nose: an ogive from the ring to the tip
  const noseFrom = length * 0.7;
  const noseLength = length - noseFrom;
  const nose: Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    nose.push(new Vector2(radius * Math.max(0, 1 - k * k) ** 0.6, noseFrom + k * noseLength));
  }
  parts.push(painted(new LatheGeometry(nose, SEGMENTS), colors.nose));

  // Fins: trapezoids swept back along the tail
  const fin = new Shape();
  fin.moveTo(0, 0);
  fin.lineTo(radius * 1.1, -length * 0.03);
  fin.lineTo(radius * 1.1, length * 0.08);
  fin.lineTo(0, length * 0.24);
  fin.closePath();
  const thickness = radius * 0.08;
  for (let k = 0; k < FINS; k++) {
    const geometry = new ExtrudeGeometry(fin, { depth: thickness, bevelEnabled: false });
    geometry.translate(radius * 0.95, length * 0.1, -thickness / 2);
    geometry.rotateY((k / FINS) * Math.PI * 2 + Math.PI / 4);
    parts.push(painted(geometry, colors.fins));
  }

  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({
    name: 'missile',
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.2,
    // The open bell and the bands are seen from inside too
    side: DoubleSide,
  });
  const mesh = unpickable(new Mesh(geometry, material));
  mesh.name = 'missile-model';
  return mesh;
}
