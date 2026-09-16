import {
  AlwaysStencilFunc,
  BackSide,
  BufferGeometry,
  Color,
  DecrementWrapStencilOp,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IncrementWrapStencilOp,
  KeepStencilOp,
  Mesh,
  NotEqualStencilFunc,
  ShaderMaterial,
  ZeroStencilOp,
  type Object3D,
  type Side,
  type StencilOp,
} from 'three';
import { unpickable } from './effect-buffers';

/**
 * Range ring of a tower: a gold band at its range, drawn on whatever the
 * frame shows there, ground, roofs, facades, bridge decks, at pixel
 * resolution and without a raycast. The range is a horizontal distance
 * (Tower.calculateDistanceFastSq), so the band is where the surface meets
 * a vertical cylinder of that radius around the tower.
 *
 * The ring is a closed volume: a wall ring around the tower foot from
 * BELOW_M under it to ABOVE_M over it, between the range and one band
 * width inside it. Three draws of that volume find and paint the pixels
 * whose visible surface lies inside it (a depth-fail stencil volume):
 *  1. back faces, no colour: stencil +1 where the face is behind the surface
 *  2. front faces, no colour: stencil -1 where the face is behind the surface.
 *     A surface in front of the volume or behind it gets both or neither,
 *     only one inside it keeps a count.
 *  3. back faces without depth test: paint where the stencil is not zero
 *     and set it back to zero, for the next ring and the next frame.
 * Counting the faces behind the surface rather than those in front of it
 * holds with the camera inside the volume too, as long as the far plane
 * (8 km) does not cut it.
 *
 * Every target the scene is drawn into needs a stencil buffer: the canvas
 * (three-tiles-engine.ts) and the composer target
 * (post-processing-pipeline.ts). Without one the stencil test passes
 * everywhere and draw 3 paints the whole volume (range-ring.spec.ts holds both).
 *
 * The band keeps about the same width on screen: BAND_PER_M of the camera's
 * distance to the ring at that bearing, between BAND_MIN_M and BAND_MAX_M.
 * Whatever wrote depth there before the ring draws takes the band, an enemy
 * crossing the ring included.
 */

/** Bearings around the ring: at 100 m range a chord is 2.5 m and lies within 1 cm of the circle. */
const SEGMENTS = 256;

/** Reach of the volume under and over the tower foot, m: valleys and roofs within it take the band. */
const BELOW_M = 100;
const ABOVE_M = 250;

/** Band width per metre of camera distance, and its bounds (m). */
const BAND_PER_M = 0.005;
const BAND_MIN_M = 0.75;
const BAND_MAX_M = 6;

const RING_COLOR = 0xc9a44c; // TD gold
/**
 * Where a tree stands on the ring, the cylinder cuts its crown and the band
 * runs round it as a loop. That is where the crown is at the range, but at
 * 0.85 it was too much gold (playtest 2026-09-14). The band cannot tell a
 * crown from a roof or a facade: every pass sees only whether the surface
 * point lies in the volume, never how the surface turns (that needs the
 * depth of the neighbouring pixels, which no pass here reads). A lower
 * opacity tones every surface down alike; the long, unbroken line on the
 * ground stays easy to follow, the short loops on the crowns recede.
 */
const RING_OPACITY = 0.6;

/** Draw order of the first pass, the others follow it: after the other transparent overlays, before the debug markers (999). */
const PASS_ORDER = 900;

const VERTEX = /* glsl */ `
  attribute float aOuter;

  uniform float uBandPerM;
  uniform float uBandMinM;
  uniform float uBandMaxM;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // The ring carries the tower foot as its position and the range as its x scale
    vec3 foot = modelMatrix[3].xyz;
    float range = length(modelMatrix[0].xyz);
    // position.xz is the bearing as a unit vector, position.y metres over the foot
    vec3 onRing = foot + vec3(position.x, 0.0, position.z) * range;
    float band = clamp(distance(cameraPosition, onRing) * uBandPerM, uBandMinM, uBandMaxM);
    float radius = max(range - (1.0 - aOuter) * band, 0.0);
    vec3 world = foot + vec3(position.x * radius, position.y, position.z * radius);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(uColor, uOpacity);

    #include <colorspace_fragment>
  }
`;

/**
 * The ring volume at unit radius. Per bearing the inner and the outer wall
 * edge (`aOuter` 0 and 1), each at the bottom and the top; the vertex
 * shader puts the walls at their radius. The faces wind outwards, which
 * the front and back face passes rely on.
 */
export function createRangeRingGeometry(segments = SEGMENTS): BufferGeometry {
  const positions: number[] = [];
  const outer: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    for (const side of [0, 1]) {
      for (const y of [-BELOW_M, ABOVE_M]) {
        positions.push(Math.cos(angle), y, Math.sin(angle));
        outer.push(side);
      }
    }
  }

  // Bearing i: inner bottom, inner top, outer bottom, outer top
  const v = (i: number, side: number, top: number) => (i % segments) * 4 + side * 2 + top;
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const j = i + 1;
    // Outer wall, facing away from the tower
    index.push(v(i, 1, 0), v(j, 1, 1), v(j, 1, 0), v(i, 1, 0), v(i, 1, 1), v(j, 1, 1));
    // Inner wall, facing the tower
    index.push(v(i, 0, 0), v(j, 0, 0), v(j, 0, 1), v(i, 0, 0), v(j, 0, 1), v(i, 0, 1));
    // Top, facing up
    index.push(v(i, 0, 1), v(j, 1, 1), v(i, 1, 1), v(i, 0, 1), v(j, 0, 1), v(j, 1, 1));
    // Bottom, facing down
    index.push(v(i, 0, 0), v(i, 1, 0), v(j, 1, 0), v(i, 0, 0), v(j, 1, 0), v(j, 0, 0));
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aOuter', new Float32BufferAttribute(outer, 1));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Geometry and the three pass materials all range rings of a renderer
 * share. A ring itself holds no GPU resources: three meshes, one per pass,
 * the tower foot and the range in its transform.
 */
export class RangeRingKit {
  private readonly geometry = createRangeRingGeometry();

  /** Mark back faces, mark front faces, paint: drawn in this order, see the file comment. */
  readonly materials: readonly [ShaderMaterial, ShaderMaterial, ShaderMaterial];

  constructor() {
    const uniforms = {
      uColor: { value: new Color(RING_COLOR) },
      uOpacity: { value: RING_OPACITY },
      uBandPerM: { value: BAND_PER_M },
      uBandMinM: { value: BAND_MIN_M },
      uBandMaxM: { value: BAND_MAX_M },
    };
    const pass = (name: string, side: Side) => new ShaderMaterial({
      name,
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side,
      // Transparent: drawn after every opaque surface it has to find
      transparent: true,
      depthWrite: false,
      stencilWrite: true,
      stencilFail: KeepStencilOp,
    });

    const mark = (name: string, side: Side, onDepthFail: StencilOp) => {
      const material = pass(name, side);
      material.colorWrite = false;
      material.stencilFunc = AlwaysStencilFunc;
      material.stencilZFail = onDepthFail;
      material.stencilZPass = KeepStencilOp;
      return material;
    };

    const paint = pass('range-ring-paint', BackSide);
    paint.depthTest = false;
    paint.stencilFunc = NotEqualStencilFunc;
    paint.stencilRef = 0;
    paint.stencilZPass = ZeroStencilOp;

    this.materials = [
      mark('range-ring-mark-back', BackSide, IncrementWrapStencilOp),
      mark('range-ring-mark-front', FrontSide, DecrementWrapStencilOp),
      paint,
    ];
  }

  /** A hidden ring: place it with placeRangeRing and add it to the scene. */
  create(): Group {
    const ring = new Group();
    ring.name = 'range-ring';
    ring.visible = false;
    this.materials.forEach((material, i) => {
      // Hidden or not, three raycasts it; the volume is hundreds of metres tall
      const mesh = unpickable(new Mesh(this.geometry, material));
      mesh.renderOrder = PASS_ORDER + i;
      ring.add(mesh);
    });
    return ring;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

/** Put `ring` around the tower foot at (x, y, z), `range` m wide. */
export function placeRangeRing(ring: Object3D, x: number, y: number, z: number, range: number): void {
  ring.position.set(x, y, z);
  ring.scale.set(range, 1, range);
}
