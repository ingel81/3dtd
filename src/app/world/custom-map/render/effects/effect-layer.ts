import {
  AdditiveBlending,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import { mapToScene } from '../map-coords';
import { ParticleField, particleCount, type ParticleEmitter, type ParticleKind } from './particle-field';
import { buildWaterfalls, type WaterfallSpec } from './waterfall';

/**
 * Effects and lights of the map's objects, from their catalogue entries
 * (`effects`, `light`): particle fields (one per kind for the whole map),
 * waterfall sheets with spray, and lights.
 *
 * Lights: every light gets an additive glow quad at its height (cheap, all
 * of them). A pool of POINT_LIGHTS real point lights follows the lights
 * nearest to the camera's focus, faded in by darkness (`setDarkness`: 0 by
 * day, 1 at night) so a day map pays for none. The pool's size is fixed,
 * so moving the lights never recompiles a material.
 */

export const POINT_LIGHTS = 6;

/** Catalogue intensity 1 in three's units (candela-ish): a lantern */
const CANDELA = 18;
/**
 * Most light a point light may throw on the ground right under it. A low,
 * strong light (lava pool, campfire) otherwise burns a white disc into what
 * it stands on at night, far brighter than the glow it stands for.
 */
const PEAK_ILLUMINANCE = 6;
/** Lights sit at least this high when they cap, so a lantern on the ground does not count as a point on it */
const MIN_LIGHT_HEIGHT = 0.75;

/** Strongest candela a light `height` metres over the ground may have */
export function lightCap(height: number): number {
  const h = Math.max(height, MIN_LIGHT_HEIGHT);
  return PEAK_ILLUMINANCE * h * h;
}

interface LightSpot {
  position: Vector3;
  color: Color;
  intensity: number;
  distance: number;
  /** Most candela the point light gets (`lightCap`) */
  cap: number;
  flicker: boolean;
  seed: number;
}

export class EffectLayer {
  readonly group = new Group();
  private readonly time = { value: 0 };
  /** Light level for lit effects (smoke, fog, spray, the waterfall): 1 by day, low at night */
  private readonly light = { value: 1 };
  private fields: ParticleField[] = [];
  private waterfalls: Mesh | null = null;
  private glows: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null;
  private spots: LightSpot[] = [];
  /** Lights that do not come from objects: glowing lava */
  private extraSpots: LightSpot[] = [];
  private readonly pool: PointLight[] = [];
  private darkness = 0;
  private readonly nearestSpots: LightSpot[] = [];
  private readonly nearestDistances = new Float64Array(POINT_LIGHTS);

  constructor(private readonly field: HeightField) {
    this.group.name = 'custom-map-effects';
    this.group.userData['losTransparent'] = true;
    for (let k = 0; k < POINT_LIGHTS; k++) {
      const light = new PointLight(0xffffff, 0, 10, 2);
      light.castShadow = false;
      light.visible = false;
      this.pool.push(light);
      this.group.add(light);
    }
  }

  /** Rebuilds every effect from the objects and their catalogue entries */
  set(objects: MapObject[], catalog: AssetCatalog): void {
    this.clear();
    const entries = new Map<string, CatalogObject>(catalog.objects.map((o) => [o.id, o]));
    const emitters = new Map<ParticleKind, ParticleEmitter[]>();
    const falls: WaterfallSpec[] = [];
    const up = new Vector3(0, 1, 0);
    const q = new Quaternion();
    for (const o of objects) {
      const e = entries.get(o.asset);
      if (!e?.effects && !e?.light) continue;
      const s = o.scale || 1;
      const ground = this.field.heightAt(o.x, o.y) + o.z;
      const origin = mapToScene(o.x, o.y, ground, new Vector3());
      for (const fx of e.effects ?? []) {
        if (fx.kind === 'waterfall') {
          const height = (fx.height ?? e.height) * s;
          const radius = (fx.radius ?? e.footprint) * s;
          q.setFromAxisAngle(up, o.rotation);
          falls.push({ matrix: new Matrix4().compose(origin, q, new Vector3(1, 1, 1)), radius, height });
          // Spray where the water lands, a little in front of the cliff
          const foot = new Vector3(0, 0, Math.min(height * 0.2, 3)).applyQuaternion(q).add(origin);
          push(emitters, {
            kind: 'spray',
            origin: foot,
            radius,
            height: 0,
            count: particleCount('spray', fx.rate !== undefined ? fx.rate * radius : 12 * radius),
            color: fx.color,
            scale: 1,
          });
          continue;
        }
        const kind = fx.kind;
        push(emitters, {
          kind,
          origin,
          radius: (fx.radius ?? (kind === 'fire' ? 0.15 : e.footprint)) * s,
          height: (fx.height ?? (kind === 'leaves' ? e.height * 0.8 : 0)) * s,
          count: particleCount(kind, fx.rate),
          color: fx.color,
          scale: kind === 'fog' || kind === 'smoke' ? s : Math.sqrt(s),
        });
      }
      if (e.light) {
        this.spots.push({
          position: origin.clone().setY(origin.y + e.light.height * s),
          color: new Color(e.light.color),
          intensity: e.light.intensity,
          distance: e.light.distance * s,
          cap: lightCap(e.light.height * s),
          flicker: e.light.flicker ?? false,
          seed: this.spots.length * 1.618,
        });
      }
    }
    for (const [kind, list] of emitters) {
      const field = new ParticleField(kind, list, this.time, this.light);
      this.fields.push(field);
      this.group.add(field.mesh);
    }
    if (falls.length) {
      this.waterfalls = buildWaterfalls(falls, this.time, this.light);
      this.group.add(this.waterfalls);
    }
    if (this.spots.length) {
      this.glows = buildGlows(this.spots, this.time);
      this.group.add(this.glows);
    }
    this.showPool();
  }

  /**
   * Point lights for glowing ground (lava pools and flows): orange, flickering,
   * competing with the object lights for the pool by distance to the focus
   */
  setLavaLights(points: Vector3[]): void {
    this.extraSpots = points.map((position, k) => ({
      position,
      color: new Color(0xff6a20),
      // Strong and wide: a lava pool lights the slopes around it
      intensity: 14,
      distance: 45,
      // The points float 5 m over the lava
      cap: lightCap(5),
      flicker: true,
      seed: 100 + k * 2.3,
    }));
    this.showPool();
  }

  /** 0 by day, 1 at night: how strongly the lights glow and light the ground */
  setDarkness(darkness: number): void {
    this.darkness = Math.min(1, Math.max(0, darkness));
    this.light.value = 1 - this.darkness * 0.85;
    if (this.glows) this.glows.material.uniforms['uDarkness'].value = this.darkness;
    this.showPool();
  }

  /**
   * The pool is in use only in the dark on a map with lights. Hidden lights do not count for three:
   * by day every lit material would otherwise pay for six point lights at zero. While in use all six
   * stay visible (unused at zero), as a change in the number of lights recompiles every lit material.
   * Set as soon as darkness or lights change, so a warm-up compiles the programs the frames use
   */
  private showPool(): void {
    const active = this.darkness > 0.05 && this.spots.length + this.extraSpots.length > 0;
    for (const light of this.pool) light.visible = active;
  }

  /** Advances the effects and moves the point lights to the lights nearest `focus` (group space) */
  update(dt: number, focus: Vector3): void {
    this.time.value += dt;
    const live = this.pool[0].visible ? this.nearest(focus) : 0;
    this.pool.forEach((light, k) => {
      const spot = k < live ? this.nearestSpots[k] : undefined;
      if (!spot) {
        light.intensity = 0;
        return;
      }
      light.position.copy(spot.position);
      light.color.copy(spot.color);
      light.distance = spot.distance;
      const flicker = spot.flicker
        ? 0.82 + 0.12 * Math.sin(this.time.value * 9 + spot.seed) + 0.06 * Math.sin(this.time.value * 23 + spot.seed * 3)
        : 1;
      light.intensity = Math.min(spot.intensity * CANDELA, spot.cap) * flicker * this.darkness;
      light.updateMatrixWorld();
    });
  }

  dispose(): void {
    this.clear();
    for (const light of this.pool) light.dispose();
    this.group.removeFromParent();
  }

  /**
   * The POINT_LIGHTS spots nearest to `focus` into `nearestSpots` (nearest
   * first), without allocating; returns how many there are
   */
  private nearest(focus: Vector3): number {
    return this.nearestOf(this.extraSpots, focus, this.nearestOf(this.spots, focus, 0));
  }

  private nearestOf(list: LightSpot[], focus: Vector3, count: number): number {
    const out = this.nearestSpots;
    const dist = this.nearestDistances;
    for (const s of list) {
      const d = s.position.distanceToSquared(focus);
      if (count === POINT_LIGHTS && d >= dist[count - 1]) continue;
      // Insert in order; when full the farthest drops out
      let k = count < POINT_LIGHTS ? count++ : count - 1;
      while (k > 0 && dist[k - 1] > d) {
        dist[k] = dist[k - 1];
        out[k] = out[k - 1];
        k--;
      }
      dist[k] = d;
      out[k] = s;
    }
    return count;
  }

  private clear(): void {
    for (const f of this.fields) f.dispose();
    this.fields = [];
    if (this.waterfalls) {
      this.waterfalls.geometry.dispose();
      (this.waterfalls.material as ShaderMaterial).dispose();
      this.waterfalls.removeFromParent();
      this.waterfalls = null;
    }
    if (this.glows) {
      this.glows.geometry.dispose();
      this.glows.material.dispose();
      this.glows.removeFromParent();
      this.glows = null;
    }
    this.spots = [];
  }
}

function push(map: Map<ParticleKind, ParticleEmitter[]>, e: ParticleEmitter): void {
  let list = map.get(e.kind);
  if (!list) map.set(e.kind, (list = []));
  list.push(e);
}

/** Additive halo quads, one per light, brighter at night and flickering like their light */
function buildGlows(spots: LightSpot[], time: { value: number }): Mesh<InstancedBufferGeometry, ShaderMaterial> {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  const pos = new Float32Array(spots.length * 4);
  const col = new Float32Array(spots.length * 4);
  spots.forEach((s, k) => {
    pos.set([s.position.x, s.position.y, s.position.z, Math.min(6, 0.6 + s.intensity * 1.2)], k * 4);
    col.set([s.color.r, s.color.g, s.color.b, s.flicker ? s.seed : -1], k * 4);
  });
  g.setAttribute('aPos', new InstancedBufferAttribute(pos, 4));
  g.setAttribute('aCol', new InstancedBufferAttribute(col, 4));
  g.instanceCount = spots.length;
  quad.dispose();
  const material = new ShaderMaterial({
    uniforms: { uTime: time, uDarkness: { value: 0 } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.name = 'custom-map-glows';
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-glows';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.userData['losTransparent'] = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const GLOW_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aPos;
attribute vec4 aCol;
uniform float uTime;
uniform float uDarkness;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float flicker = aCol.w < 0.0 ? 1.0 : 0.85 + 0.1 * sin(uTime * 9.0 + aCol.w) + 0.05 * sin(uTime * 23.0 + aCol.w * 3.0);
  // Faint by day (a lit lamp), full at night
  vColor = aCol.rgb * flicker * mix(0.25, 1.0, uDarkness);
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
  mvPosition.xy += position.xy * aPos.w * mix(0.6, 1.0, uDarkness);
  // Pulled towards the camera a little, so the halo is not cut by the lamp's own mesh
  mvPosition.xyz *= 1.0 - min(0.4 / max(-mvPosition.z, 1.0), 0.3);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const GLOW_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv - 0.5) * 2.0;
  float core = pow(max(1.0 - r, 0.0), 6.0) * 1.5;
  float halo = pow(max(1.0 - r, 0.0), 2.0) * 0.35;
  float a = core + halo;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
