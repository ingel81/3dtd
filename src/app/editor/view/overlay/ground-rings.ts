/**
 * Rings laid on the ground as instances of one quad: the selection's
 * thousands of objects in two draws, whatever their number. Each ring is a
 * soft brass band drawn by its own shader, its quad tilted onto the ground's
 * slope under it (a circle seen from above stays a circle on a hillside).
 * The band keeps at least two pixels and fades into a quiet dot as it grows
 * small on the screen, so a far selection of thousands reads as a calm brass
 * wash instead of white noise. Where the land or a model hides a ring it
 * still shows, faintly (a second draw of the same instances that passes
 * only behind the depth).
 *
 * Room is reserved ahead (doubling): writing a ring only writes sixteen
 * floats, a drag frame moves the rings without building anything.
 */
import {
  Color,
  DoubleSide,
  GreaterDepth,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LessEqualDepth,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { TD_THEME } from '../../../styles/td-theme';
import type { GroundHeight } from './draping';

/** The quad reaches this far beyond the ring's radius (local units): room for the halo */
const QUAD_REACH = 1.4;
/** Metres a ring floats over the plane fitted to the ground under it */
const LIFT_M = 0.3;
/** Rings reserved at the start */
const FIRST_ROOM = 64;

const RING_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const RING_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uRim;
uniform vec3 uBody;
uniform float uHidden;
varying vec2 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vLocal);
  // Local units per pixel: the ring's radius on the screen is 1 / fw pixels
  float fw = max(fwidth(d), 1e-5);
  float px = 1.0 / fw;
  // The band: about a tenth of the radius near, never under two pixels far
  float band = max(0.05, 1.1 * fw);
  float off = abs(d - 1.0);
  float rim = 1.0 - smoothstep(band - fw, band + fw, off);
  // A soft halo round the band and a faint floor inside it: the footprint reads, the edge stays clean
  float halo = exp(-pow(off / (0.16 + 2.5 * fw), 2.0)) * 0.32;
  // Small on the screen the floor fills up: a far selection reads as brass dots
  float small = smoothstep(4.0, 16.0, px);
  float inner = (1.0 - smoothstep(1.0 - band - 2.0 * fw, 1.0 - band, d)) * mix(0.55, 0.09, small);
  // Four short ticks outside the band, as on a bezel; only where the ring is big enough to carry them
  float a = atan(vLocal.y, vLocal.x);
  float across = abs(fract(a / PI_HALF + 0.5) - 0.5) * PI_HALF * d;
  float tick = (1.0 - smoothstep(band * 0.6, band * 0.6 + fw, across))
    * step(1.0 + band, d) * (1.0 - smoothstep(1.2, 1.2 + fw, d))
    * smoothstep(18.0, 30.0, px);
  float alpha = max(max(rim, tick), max(halo, inner));
  // Small on the screen: a quiet dot, many of them a wash, not a field of sparks
  alpha *= mix(0.6, 1.0, small);
  alpha *= mix(1.0, 0.3, uHidden) * (1.0 - uHidden * (1.0 - max(rim, tick)));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uBody, uRim, max(rim, tick)), alpha);
  #include <colorspace_fragment>
}
`;

function ringMaterial(hidden: boolean): ShaderMaterial {
  return new ShaderMaterial({
    name: hidden ? 'editor-ground-ring-hidden' : 'editor-ground-ring',
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    uniforms: {
      uRim: { value: new Color(TD_THEME.brassLight) },
      uBody: { value: new Color(TD_THEME.brass) },
      uHidden: { value: hidden ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: hidden ? GreaterDepth : LessEqualDepth,
    blending: NormalBlending,
    side: DoubleSide,
  });
}

export class GroundRings {
  /** Both draws: the rings in sight, then their hidden parts faintly */
  readonly group = new Group();
  private readonly quad = new PlaneGeometry(QUAD_REACH * 2, QUAD_REACH * 2).rotateX(-Math.PI / 2);
  private readonly seen = ringMaterial(false);
  private readonly hidden = ringMaterial(true);
  private meshes: [InstancedMesh, InstancedMesh];
  /** Map x, map y and radius of each ring */
  private at = new Float64Array(FIRST_ROOM * 3);
  private shown = 0;

  constructor(private readonly height: GroundHeight) {
    this.meshes = this.build(FIRST_ROOM);
    this.group.visible = false;
  }

  /** Rings drawn: slots 0 .. count-1 */
  get count(): number {
    return this.shown;
  }

  /** Rings the instances hold before they grow */
  get room(): number {
    return this.meshes[0].instanceMatrix.count;
  }

  /** Shows slots 0 .. n-1, growing the room (doubling) when it is short; what the slots hold is written apart (put) */
  setCount(n: number): void {
    if (n > this.room) {
      let room = this.room;
      while (room < n) room *= 2;
      const old = this.meshes;
      const at = new Float64Array(room * 3);
      at.set(this.at);
      this.at = at;
      this.meshes = this.build(room);
      this.meshes[0].instanceMatrix.array.set(old[0].instanceMatrix.array);
      for (const m of old) {
        m.removeFromParent();
        m.dispose();
      }
    }
    this.shown = n;
    for (const m of this.meshes) m.count = n;
    this.group.visible = n > 0;
    this.changed();
  }

  /** Ring `slot` round map point (x, y) with `radius` metres, laid on the ground; radius 0 hides it */
  put(slot: number, x: number, y: number, radius: number): void {
    const at = this.at;
    at[slot * 3] = x;
    at[slot * 3 + 1] = y;
    at[slot * 3 + 2] = radius;
    this.write(slot);
  }

  /** The ground moved: every ring takes the new heights where it stands */
  redrape(): void {
    for (let k = 0; k < this.shown; k++) this.write(k);
    this.changed();
  }

  /** Tells the instances their matrices changed, slots 0 .. count-1 only (one range, never a list that grows) */
  changed(): void {
    const matrix = this.meshes[0].instanceMatrix;
    matrix.clearUpdateRanges();
    matrix.addUpdateRange(0, this.shown * 16);
    matrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    this.quad.dispose();
    this.seen.dispose();
    this.hidden.dispose();
  }

  /**
   * The ring's quad as a matrix: scaled to the radius, its x and z axes
   * tilted onto the plane fitted to the ground (the circle seen from above
   * stays round), floating over the highest of centre and plane
   */
  private write(slot: number): void {
    const at = this.at;
    const x = at[slot * 3];
    const y = at[slot * 3 + 1];
    const r = at[slot * 3 + 2];
    const e = this.meshes[0].instanceMatrix.array as Float32Array;
    const o = slot * 16;
    if (r <= 0) {
      e.fill(0, o, o + 16);
      return;
    }
    const h = this.height;
    const h0 = h(x, y);
    const xp = h(x + r, y);
    const xm = h(x - r, y);
    const yp = h(x, y + r);
    const ym = h(x, y - r);
    const dhdx = (xp - xm) / (2 * r);
    const dhdy = (yp - ym) / (2 * r);
    const centre = Math.max(h0, (xp + xm + yp + ym) / 4) + LIFT_M;
    // Scene x is map -x, scene z map y: a step along scene x climbs -dhdx, along scene z dhdy
    e[o] = r;
    e[o + 1] = -dhdx * r;
    e[o + 2] = 0;
    e[o + 3] = 0;
    e[o + 4] = 0;
    e[o + 5] = 1;
    e[o + 6] = 0;
    e[o + 7] = 0;
    e[o + 8] = 0;
    e[o + 9] = dhdy * r;
    e[o + 10] = r;
    e[o + 11] = 0;
    e[o + 12] = -x;
    e[o + 13] = centre;
    e[o + 14] = y;
    e[o + 15] = 1;
  }

  /** Both draws over one buffer of matrices, `room` rings */
  private build(room: number): [InstancedMesh, InstancedMesh] {
    const seen = new InstancedMesh(this.quad, this.seen, room);
    const hidden = new InstancedMesh(this.quad, this.hidden, room);
    const matrices = new InstancedBufferAttribute(new Float32Array(room * 16), 16);
    seen.instanceMatrix = matrices;
    hidden.instanceMatrix = matrices;
    for (const [m, order] of [[hidden, 10], [seen, 10.5]] as const) {
      m.count = 0;
      m.renderOrder = order;
      m.frustumCulled = false;
      // Never a pick target: a ray over thousands of quads would build their bounds
      m.raycast = () => undefined;
      this.group.add(m);
    }
    return [seen, hidden];
  }
}
