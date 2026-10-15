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
import type { MapLife, MapObject } from '../../map-document';
import { areaShown, lifeSwitches } from '../../map-life';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import { mapToScene } from '../map-coords';
import { ParticleField, particleCount, type ParticleEmitter, type ParticleKind } from './particle-field';
import { buildWaterfalls, fallFoot, fallLip, fallReach, type WaterfallSpec } from './waterfall';
import { LAMP_LIGHT_UNIFORMS, LampLight, type LampSpot } from './lamp-light';
import { BirdFlocks, circleFlock, type Flock } from './bird-flocks';
import { isParticleLife, lifeEmitters, lifeFlock } from './life-areas';

/**
 * Effects and lights of the map's objects, from their catalogue entries
 * (`effects`, `light`): particle fields (one per kind for the whole map),
 * waterfall sheets with spray, and lights.
 *
 * Lights: every light gets an additive glow quad at its height and its
 * light baked onto the land around it (lamp-light.ts, every map material
 * samples it): cheap, all of them. A pool of POINT_LIGHTS real point
 * lights follows the lights nearest to the camera's focus. Both fade in by
 * darkness (`setDarkness`: 0 by day, 1 at night) so a day map pays for
 * none. The pool's size is fixed, so moving the lights never recompiles a
 * material.
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
  /** Life the map's content brings by itself (setAmbient): fireflies at night, birds by day */
  private fireflies: ParticleField | null = null;
  private ambient: { fireflies: Vector3[]; flocks: Flock[] } = { fireflies: [], flocks: [] };
  /**
   * What the map maker placed (fx-birds, fx-fireflies and objects with those
   * effects): placed flocks fly instead of the automatic ones, placed
   * fireflies stand instead of the automatic ones (set)
   */
  private placedFlocks: Flock[] = [];
  private placedFireflies = false;
  /** The map's life (setLife): its switches and areas, drawn from the next `set` */
  private life: MapLife | undefined = undefined;
  /** The quality level's share of the life areas (render-quality.ts `life`; 0 on Low: none) */
  private lifeShare = 1;
  /** Fireflies and flocks of the life areas, shown like the automatic ones (setAmbient) */
  private lifeFireflies: ParticleEmitter[] = [];
  private lifeFlocks: Flock[] = [];
  readonly birds = new BirdFlocks();
  private waterfalls: Mesh | null = null;
  private glows: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null;
  private spots: LightSpot[] = [];
  /** Lights that do not come from objects: glowing lava */
  private extraSpots: LightSpot[] = [];
  private readonly pool: PointLight[] = [];
  /** The lights baked onto the land (lamp-light.ts); lit: whether any light falls on the map */
  private readonly lamps: LampLight;
  private lampsLit = false;
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
    /** Whether lava stands at a map point: a waterfall into or out of it is a lava fall */
    private readonly lavaAt: (x: number, y: number) => boolean = () => false,
  ) {
    this.group.name = 'custom-map-effects';
    this.group.userData['losTransparent'] = true;
    this.lamps = new LampLight(field);
    this.group.add(this.birds.mesh);
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
    this.placedFlocks = [];
    this.placedFireflies = false;
    const life = lifeSwitches(this.life);
    // Smoke placed by hand (fx-smoke over a house, a level script's chimney) stands for the house's own chimney
    const placedSmoke = objects.filter((o) => entries.get(o.asset)?.effects?.some((fx) => fx.kind === 'smoke' && !fx.at));
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
          const matrix = new Matrix4().compose(origin, q, new Vector3(1, 1, 1));
          // The sheet hangs over the ground and a river's slope all the way down; its foot is where the water lands
          const reach = fallReach(matrix, height, (x, z) => this.field.heightAt(-x, z), (x, z) => this.waterLevelAt(-x, z));
          const spec: WaterfallSpec = { matrix, radius, height, pool: null, reach };
          const foot = fallFoot(matrix, spec);
          const lip = fallLip(matrix, spec);
          // Lava at its lip, under its foot or just ahead of it (where it pours in): the sheet glows and the foot
          // throws embers, not spray
          const ahead = (d: number) => this.lavaAt(-(foot.x + matrix.elements[8] * d), foot.z + matrix.elements[10] * d);
          spec.lava = this.lavaAt(-lip.x, lip.z) || [0, 2, 4, 6].some(ahead);
          falls.push(spec);
          feet.push({ foot, radius, rate: fx.rate, color: fx.color, lava: spec.lava });
          continue;
        }
        if (fx.kind === 'birds') {
          // A flock the map maker placed: its size and number with the object's scale
          this.placedFlocks.push(
            circleFlock(
              origin.clone().setY(origin.y + (fx.height ?? 50) * s),
              (fx.radius ?? 45) * s,
              Math.max(2, Math.round((fx.rate ?? 10) * s)),
              ((Math.abs(Math.sin(o.x * 12.9898 + o.y * 78.233)) * 43758.5453) % 1) || 0.37,
            ),
          );
          continue;
        }
        if (fx.kind === 'fireflies') this.placedFireflies = true;
        const kind = fx.kind;
        let from = origin;
        if (fx.at) {
          // A chimney's smoke: none where smoke already rises within the house's reach, none with the map's switch off
          if (!life.smoke || life.density <= 0) continue;
          const reach = e.footprint * s + 2;
          if (placedSmoke.some((p) => p !== o && Math.hypot(p.x - o.x, p.y - o.y) < reach)) continue;
          from = new Vector3(fx.at[0] * s, 0, fx.at[1] * s).applyQuaternion(q.setFromAxisAngle(up, o.rotation)).add(origin);
        }
        push(emitters, {
          kind,
          origin: from,
          radius: (fx.radius ?? (kind === 'fire' ? 0.15 : e.footprint)) * s,
          height: (fx.height ?? (kind === 'leaves' ? e.height * 0.8 : 0)) * s,
          // An area effect of the map maker's (category fx) grows denser with its scale, and takes its tint
          count: this.share(particleCount(kind, fx.rate) * (e.category === 'fx' ? Math.max(0.3, s * s) : fx.at ? life.density : 1)),
          color: (e.category === 'fx' && o.tint) || fx.color,
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
    this.lifeAreas(emitters);
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
    this.bakeLamps();
    this.showPool();
    this.setAmbient(this.ambient);
  }

  /**
   * The life areas' share of the effects (map-life.ts), on levels that show
   * them: particles join the fields of their kind (no draw call more for a
   * kind the map has), fireflies and flocks go with the automatic ones
   */
  private lifeAreas(emitters: Map<ParticleKind, ParticleEmitter[]>): void {
    this.lifeFireflies = [];
    this.lifeFlocks = [];
    const factor = lifeSwitches(this.life).density;
    const surface = (x: number, y: number) => Math.max(this.field.heightAt(x, y), this.waterLevelAt(x, y) ?? -Infinity);
    for (const area of this.life?.areas ?? []) {
      if (!areaShown(area, this.lifeShare) || factor <= 0) continue;
      if (area.kind === 'birds') this.lifeFlocks.push(lifeFlock(area, surface, factor));
      else if (isParticleLife(area.kind)) {
        const list = lifeEmitters(area, surface, factor, (n) => this.share(n));
        if (area.kind === 'fireflies') this.lifeFireflies.push(...list);
        else for (const e of list) push(emitters, e);
      }
    }
  }

  /**
   * The map's life (the document's `life`): switches, density and areas,
   * taken by the next `set` and `setLavaLights` (the view calls both)
   */
  setLife(life: MapLife | undefined): void {
    this.life = life;
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
      const sparks: ParticleEmitter[] = [];
      // Sparks bursting from the lava where the map turns them on (life.auto.sparks), on levels that show life
      const life = lifeSwitches(this.life);
      const sparksOn = life.sparks && this.lifeShare > 0 && life.density > 0;
      for (const [k, p] of points.entries()) {
        const origin = p.clone().setY(p.y - 5);
        embers.push({ kind: 'embers', origin, radius: 12, height: 0.2, count: per, color: '#ff8a30', scale: 1.4 });
        if (k % 3 === 0) smoke.push({ kind: 'smoke', origin, radius: 10, height: 0.5, count: 4, color: '#4a3a34', scale: 2.5 });
        if (sparksOn) sparks.push({ kind: 'sparks', origin, radius: 10, height: 0.2, count: this.share(Math.round(24 * life.density)), color: '#ff9a30', scale: 1.2 });
      }
      for (const [kind, list] of [['embers', embers], ['smoke', smoke], ['sparks', sparks]] as const) {
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
    this.bakeLamps();
    this.showPool();
  }

  /**
   * Bakes every light onto the land (lamp-light.ts) and hands the textures to
   * the map materials. Lava points (5 m over their lava) light wider and
   * steadier than their point lights, which stand for a whole patch
   */
  private bakeLamps(): void {
    const lamps: LampSpot[] = [
      ...this.spots,
      ...this.extraSpots.map((s) => ({ position: s.position, color: s.color, intensity: 0.9, distance: 32, flicker: true })),
    ];
    this.lampsLit = this.lamps.bake(lamps);
    const u = LAMP_LIGHT_UNIFORMS;
    u.uLampSteady.value = this.lamps.steady;
    u.uLampFlicker.value = this.lamps.flicker;
    this.lamps.gridUv(u.uLampGridUv.value);
    this.lightLamps();
  }

  /** The baked light's strength by darkness; none without lights */
  private lightLamps(): void {
    if (LAMP_LIGHT_UNIFORMS.uLampSteady.value !== this.lamps.steady) return;
    LAMP_LIGHT_UNIFORMS.uLampOn.value = this.lampsLit ? this.darkness : 0;
  }

  /**
   * Life from the map's content (CustomMapView works out where): fireflies
   * over shores and in woods, shown only in the dark; bird flocks over open
   * land by day, on levels with most of the particles (medium and up).
   * Placed flocks and fireflies (set) take the place of these
   */
  setAmbient(ambient: { fireflies: Vector3[]; flocks: Flock[] }): void {
    this.ambient = ambient;
    if (this.fireflies) {
      const old = this.fireflies;
      old.mesh.removeFromParent();
      this.retired.push(() => old.dispose());
      this.retiredFrames = 0;
      this.fireflies = null;
    }
    // Fireflies or flocks set by hand (objects, life areas) take the place of the map's own; its switches turn those off
    const life = lifeSwitches(this.life);
    const emitters = [...this.lifeFireflies];
    if (life.fireflies && life.density > 0 && !this.placedFireflies && !emitters.length) {
      const per = this.share(14 * life.density);
      for (const origin of ambient.fireflies) emitters.push({ kind: 'fireflies', origin, radius: 9, height: 1.8, count: per, color: undefined, scale: 1 });
    }
    if (emitters.length) {
      this.fireflies = new ParticleField('fireflies', emitters, this.time, this.light);
      this.group.add(this.fireflies.mesh);
    }
    const placed = [...this.placedFlocks, ...this.lifeFlocks];
    const own = life.birds ? ambient.flocks.map((f) => ({ ...f, birds: Math.round(f.birds * life.density) })) : [];
    const flocks = placed.length ? placed : own;
    this.birds.set(this.particleShare >= 0.7 ? flocks.filter((f) => f.birds > 0).map((f) => ({ ...f, birds: Math.max(Math.min(2, f.birds), Math.round(f.birds * this.particleShare)) })) : []);
    this.showAmbient();
  }

  /** Fireflies only in the dark, birds by day (bird-flocks.ts) */
  private showAmbient(): void {
    if (this.fireflies) this.fireflies.mesh.visible = this.darkness > 0.35;
    this.birds.setDarkness(this.darkness);
  }

  /**
   * The quality level's part: a share of every field's particles (a `set`
   * after it builds them so), how many real point lights follow the lamps
   * and which life areas show (`life`: 0 none, under 1 those not asking for
   * High). Returns whether particles or life changed, so the owner sets the
   * effects (and the lava's) again
   */
  setQuality(quality: { particles: number; pointLights: number; life?: number }): boolean {
    const life = quality.life ?? this.lifeShare;
    const changed = quality.particles !== this.particleShare || life !== this.lifeShare;
    this.particleShare = quality.particles;
    this.lifeShare = life;
    this.lightCount = Math.max(0, Math.min(POINT_LIGHTS, Math.round(quality.pointLights)));
    this.showPool();
    if (changed) this.setAmbient(this.ambient);
    return changed;
  }

  /**
   * Foam and spray where each waterfall's water lands, on that surface: the
   * water's level where there is water at or over the foot, the ground
   * otherwise. A fall whose foot meets the lip of another (a step of a
   * cascade) lands on nothing: its water runs on down the next sheet, and a
   * foam disc or spray there would hang in the air in front of the cliff.
   * Water standing far over the foot is not where it lands either: a river's
   * surface sloping down above a fall (spray there stood out of the slope
   * halfway up), nor is ground over the foot (a sheet still buried in it).
   */
  private landFalls(falls: WaterfallSpec[], feet: FallFoot[], emitters: Map<ParticleKind, ParticleEmitter[]>): void {
    const lip = new Vector3();
    const origin = new Vector3();
    for (let i = 0; i < falls.length; i++) {
      const { foot, radius, rate, color, lava } = feet[i];
      const height = falls[i].height;
      const step = falls.some((other, j) => {
        if (j === i) return false;
        fallLip(other.matrix, other, lip);
        return (
          Math.abs(lip.y - foot.y) <= Math.max(1.5, height * 0.25) &&
          Math.hypot(lip.x - foot.x, lip.z - foot.z) <= other.radius + radius + 1
        );
      });
      if (step) continue;
      const footMap = { x: -foot.x, y: foot.z };
      const level = this.waterLevelAt(footMap.x, footMap.y);
      const pool = level !== null && level >= foot.y - 0.5 && level - foot.y <= Math.max(3, height * 0.5) ? level : null;
      const ground = this.field.heightAt(footMap.x, footMap.y);
      if (pool === null && ground > foot.y + 1) continue;
      const at = foot.clone().setY(pool ?? ground);
      if (lava) {
        // Lava lands in embers and a little smoke, no foam
        push(emitters, { kind: 'embers', origin: at, radius: radius * 1.2, height: 0.3, count: this.share(particleCount('embers', 3 * radius)), color: '#ff8a30', scale: 1.4 });
        push(emitters, { kind: 'smoke', origin: at, radius, height: 0.5, count: this.share(particleCount('smoke', 0.6 * radius)), color: '#4a3a34', scale: 2 });
        continue;
      }
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

  /** A field's particle count at the level's share, whole and at least one (a field holds whole particles) */
  private share(count: number): number {
    return Math.max(1, Math.round(count * Math.min(1, this.particleShare)));
  }

  /** 0 by day, 1 at night: how strongly the lights glow and light the ground */
  setDarkness(darkness: number): void {
    this.darkness = Math.min(1, Math.max(0, darkness));
    this.light.value = 1 - this.darkness * 0.85;
    if (this.glows) this.glows.material.uniforms['uDarkness'].value = this.darkness;
    this.lightLamps();
    this.showAmbient();
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

  /** Whether the point light pool counts for three now (night on a map with lights) */
  get poolShown(): boolean {
    return this.pool.some((light) => light.visible);
  }

  /**
   * Runs `run` with the pool shown or hidden as `shown` says, and puts it back
   * before returning: a compile inside builds the programs of the other light
   * state (compileAsync gathers them before it returns its promise), which a
   * night, or a first lamp after dark, would otherwise link in its frame
   */
  withPool<T>(shown: boolean, run: () => T): T {
    const was = this.pool.map((light) => light.visible);
    this.pool.forEach((light, k) => (light.visible = shown && k < this.lightCount));
    try {
      return run();
    } finally {
      this.pool.forEach((light, k) => (light.visible = was[k]));
    }
  }

  /** Advances the effects and moves the point lights to the lights nearest `focus` (group space) */
  update(dt: number, focus: Vector3): void {
    this.time.value += dt;
    if (LAMP_LIGHT_UNIFORMS.uLampSteady.value === this.lamps.steady) LAMP_LIGHT_UNIFORMS.uLampTime.value = this.time.value;
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
    this.fireflies?.dispose();
    this.fireflies = null;
    this.birds.dispose();
    for (const light of this.pool) light.dispose();
    if (LAMP_LIGHT_UNIFORMS.uLampSteady.value === this.lamps.steady) {
      LAMP_LIGHT_UNIFORMS.uLampOn.value = 0;
      LAMP_LIGHT_UNIFORMS.uLampSteady.value = null;
      LAMP_LIGHT_UNIFORMS.uLampFlicker.value = null;
    }
    this.lamps.dispose();
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
  lava: boolean;
}

function push(map: Map<ParticleKind, ParticleEmitter[]>, e: ParticleEmitter): void {
  let list = map.get(e.kind);
  if (!list) map.set(e.kind, (list = []));
  list.push(e);
}

/** The halo quads without lights, to compile their program before a map gets its first light (CustomMapView.effectTwins) */
export function glowStandIn(): Mesh<InstancedBufferGeometry, ShaderMaterial> {
  return buildGlows([], { value: 0 });
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
  // At night at least a hundredth of the distance across, so lamps read from the game camera high above
  mvPosition.xy += position.xy * max(aPos.w * mix(0.6, 1.0, uDarkness), -mvPosition.z * 0.01 * uDarkness);
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
