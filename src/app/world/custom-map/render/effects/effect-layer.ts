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
  /** Embers and smoke over lava (setLavaLights), apart from the objects' effects */
  private lavaFields: ParticleField[] = [];
  private waterfalls: Mesh | null = null;
  private glows: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null;
  private spots: LightSpot[] = [];
  /** Lights that do not come from objects: glowing lava */
  private extraSpots: LightSpot[] = [];
  private readonly pool: PointLight[] = [];
  private darkness = 0;
  private readonly nearestSpots: LightSpot[] = [];
  private readonly nearestDistances = new Float64Array(POINT_LIGHTS);
  /** The quality level's share of particles and real point lights (render-quality.ts) */
  private particleShare = 1;
  private lightCount = POINT_LIGHTS;
  /**
   * What a rebuild replaced, freed once two frames drew the new effects:
   * three drops a program the moment no material uses it, and the new
   * materials would link the same programs again in their first frame
   * (some 125 ms each, a stall in the editor whenever a lamp or a fire was
   * placed or removed)
   */
  private retired: (() => void)[] = [];
  private retiredFrames = 0;

  constructor(
    private readonly field: HeightField,
    /** Level of the water at a map point, null on dry ground: a waterfall's foam lies on its pool */
    private readonly waterLevelAt: (x: number, y: number) => number | null = () => null,
  ) {
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
    const feet: FallFoot[] = [];
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
          // Where the water lands, a little in front of the cliff
          const foot = new Vector3(0, 0, Math.min(height * 0.2, 3)).applyQuaternion(q).add(origin);
          falls.push({ matrix: new Matrix4().compose(origin, q, new Vector3(1, 1, 1)), radius, height, pool: null });
          feet.push({ foot, radius, rate: fx.rate, color: fx.color });
          continue;
        }
        const kind = fx.kind;
        push(emitters, {
          kind,
          origin,
          radius: (fx.radius ?? (kind === 'fire' ? 0.15 : e.footprint)) * s,
          height: (fx.height ?? (kind === 'leaves' ? e.height * 0.8 : 0)) * s,
          count: this.share(particleCount(kind, fx.rate)),
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
    this.landFalls(falls, feet, emitters);
    for (const [kind, list] of emitters) {
      const field = new ParticleField(kind, list, this.time, this.light);
      this.fields.push(field);
      this.group.add(field.mesh);
    }
    if (falls.length) {
      this.waterfalls = buildWaterfalls(falls, this.time, this.light, (x, z) => this.waterLevelAt(-x, z));
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
    // Embers rising and a little smoke over every lava point: one instanced field each, about 2000
    // embers over the whole map at most (lava points float 5 m over the lava). The old fields go a few
    // frames later, as the other effects do (clear): their programs stay for the new ones
    for (const f of this.lavaFields) {
      f.mesh.removeFromParent();
      this.retired.push(() => f.dispose());
    }
    this.retiredFrames = 0;
    this.lavaFields = [];
    if (points.length) {
      const per = Math.max(8, Math.min(60, Math.floor(2000 / points.length)));
      const embers: ParticleEmitter[] = [];
      const smoke: ParticleEmitter[] = [];
      for (const [k, p] of points.entries()) {
        const origin = p.clone().setY(p.y - 5);
        embers.push({ kind: 'embers', origin, radius: 12, height: 0.2, count: per, color: '#ff8a30', scale: 1.4 });
        if (k % 3 === 0) smoke.push({ kind: 'smoke', origin, radius: 10, height: 0.5, count: 4, color: '#4a3a34', scale: 2.5 });
      }
      for (const [kind, list] of [['embers', embers], ['smoke', smoke]] as const) {
        if (!list.length) continue;
        const field = new ParticleField(kind, list, this.time, this.light);
        this.lavaFields.push(field);
        this.group.add(field.mesh);
      }
    }
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

  /**
   * The quality level's part: a share of every field's particles (a `set`
   * after it builds them so) and how many real point lights follow the
   * lamps. Returns whether the particles changed, so the owner sets the
   * effects again
   */
  setQuality(quality: { particles: number; pointLights: number }): boolean {
    const changed = quality.particles !== this.particleShare;
    this.particleShare = quality.particles;
    this.lightCount = Math.max(0, Math.min(POINT_LIGHTS, Math.round(quality.pointLights)));
    this.showPool();
    return changed;
  }

  /** A field's particle count at the level's share, at least one */
  /**
   * Foam and spray where each waterfall's water lands, on that surface (the
   * water's level where there is water, the ground otherwise). A fall whose
   * foot meets the lip of another (a step of a cascade) lands on nothing: its
   * water runs on down the next sheet, and a foam disc or spray there would
   * hang in the air in front of the cliff.
   */
  private landFalls(falls: WaterfallSpec[], feet: FallFoot[], emitters: Map<ParticleKind, ParticleEmitter[]>): void {
    const lip = new Vector3();
    const origin = new Vector3();
    for (let i = 0; i < falls.length; i++) {
      const { foot, radius, rate, color } = feet[i];
      const height = falls[i].height;
      const step = falls.some((other, j) => {
        if (j === i) return false;
        lip.setFromMatrixPosition(other.matrix);
        return (
          Math.abs(lip.y + other.height - foot.y) <= Math.max(1.5, height * 0.25) &&
          Math.hypot(lip.x - foot.x, lip.z - foot.z) <= other.radius + radius + 1
        );
      });
      if (step) continue;
      const footMap = { x: -foot.x, y: foot.z };
      const pool = this.waterLevelAt(footMap.x, footMap.y);
      const ground = this.field.heightAt(footMap.x, footMap.y);
      const at = foot.clone().setY(pool ?? ground);
      // The foam disc lies on the pool, in the fall's own frame
      if (pool !== null) falls[i].pool = pool - origin.setFromMatrixPosition(falls[i].matrix).y;
      // Spray where the water lands, and a wider, slower cloud of mist around it
      push(emitters, {
        kind: 'spray',
        origin: at,
        radius,
        height: 0,
        count: this.share(particleCount('spray', rate !== undefined ? rate * radius : 12 * radius)),
        color,
        scale: 1,
      });
      push(emitters, {
        kind: 'spray',
        origin: at,
        radius: radius * 2.2,
        height: 0.5,
        count: Math.round(particleCount('spray', 5 * radius) * 0.6),
        color,
        scale: 2.2,
      });
    }
  }

  private share(count: number): number {
    return this.particleShare >= 1 ? count : Math.max(1, Math.round(count * this.particleShare));
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
   * by day every lit material would otherwise pay for six point lights at zero. While in use the level's
   * lights (lightCount) all stay visible (unused at zero), as a change in their number recompiles every
   * lit material.
   * Set as soon as darkness or lights change, so a warm-up compiles the programs the frames use
   */
  private showPool(): void {
    const active = this.darkness > 0.05 && this.spots.length + this.extraSpots.length > 0;
    this.pool.forEach((light, k) => (light.visible = active && k < this.lightCount));
  }

  /** Advances the effects and moves the point lights to the lights nearest `focus` (group space) */
  update(dt: number, focus: Vector3): void {
    this.time.value += dt;
    if (this.retired.length && ++this.retiredFrames > 2) this.freeRetired();
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
    this.freeRetired();
    for (const f of this.lavaFields) f.dispose();
    this.lavaFields = [];
    for (const light of this.pool) light.dispose();
    this.group.removeFromParent();
  }

  private freeRetired(): void {
    for (const free of this.retired) free();
    this.retired = [];
    this.retiredFrames = 0;
  }

  /**
   * The level's lightCount spots nearest to `focus` into `nearestSpots` (nearest
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
      const most = this.lightCount;
      if (most === 0) return 0;
      if (count === most && d >= dist[count - 1]) continue;
      // Insert in order; when full the farthest drops out
      let k = count < most ? count++ : count - 1;
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

  /** Takes every effect out of the scene; their resources go a few frames later (retired) */
  private clear(): void {
    for (const f of this.fields) {
      f.mesh.removeFromParent();
      this.retired.push(() => f.dispose());
    }
    this.fields = [];
    const falls = this.waterfalls;
    if (falls) {
      falls.removeFromParent();
      this.retired.push(() => {
        falls.geometry.dispose();
        (falls.material as ShaderMaterial).dispose();
      });
      this.waterfalls = null;
    }
    const glows = this.glows;
    if (glows) {
      glows.removeFromParent();
      this.retired.push(() => {
        glows.geometry.dispose();
        glows.material.dispose();
      });
      this.glows = null;
    }
    this.retiredFrames = 0;
    this.spots = [];
  }
}

/** Where a waterfall's sheet ends (scene space) and what its spray needs */
interface FallFoot {
  foot: Vector3;
  radius: number;
  rate: number | undefined;
  color: string | undefined;
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
