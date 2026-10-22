import { BufferAttribute, BufferGeometry, CircleGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector2, Vector3, type ShaderMaterial } from 'three';
import { ParticleField } from '../effects/particle-field';
import type { MapRiver } from '../../map-document';
import { lakeLevelAt, type CraterAt, type CraterCut } from '../../../../map-ops/crater-water';
import type { HeightTexture } from '../terrain/height-texture';
import type { MapEffects } from '../map-effects';
import type { SceneCopy } from './scene-copy';
import { createWaterMaterial, setWaterEffects, setWaterSky } from './water-material';
import { buildWaterfalls } from '../effects/waterfall';
import { setHeatHaze } from './heat-haze';
import { RiverSurface } from './river-surface';
import type { HeightField } from '../height-field';
import { riverNetwork, type RiverGround } from '../../../../map-ops/river-network';

/**
 * What craters do to the rivers they cut, drawn (docs/WATER_NETWORK_PLAN.md,
 * step 2, E283; the numbers from map-ops/crater-water.ts): the river's
 * stretch through the bowl is gone, the water upstream falls over the lip
 * into it (the waterfall sheet, a lava fall for lava), a lake rises in the
 * bowl from its floor to its level over the fill's seconds, the bed below
 * runs dry meanwhile (the water sinks into its channel, the dry stretch
 * growing down the river), and once the lake spills into it the river comes
 * back down it. A spill elsewhere leaves the old bed dry, and the water
 * runs off down its own way once the lake is full (CraterCut.outflow: a
 * narrow stream drawn as a river, its front coming down it). Lava running
 * off into water sets where it meets it: dark rock, steam rising over it.
 *
 * Everything runs on the game's clock (`now`, seconds; paused it stands, at
 * 2x it runs twice as fast). A crater known before (a restore, a replay's
 * jump: `start` null) stands full at once. Per crater a lake mesh (a disc
 * at the level, the ground cuts its shore) and a fall; the rivers only get
 * uniforms (RiverSurface.setCraters).
 */

/** A crater cutting a river, and since when its water comes in (game seconds; null: long ago, full) */
export interface CraterWaterEntry {
  crater: CraterAt;
  cut: CraterCut;
  kind: MapRiver['kind'];
  start: number | null;
}

/** Metres per second the dry stretch grows down the bed, and the water comes back down it (lava a third) */
const DRAIN_MS = 3;
const REFILL_MS = 2;
const LAVA_SLOWER = 3;
/** Metres the water of a dry bed sinks: below any bed the brush or the import digs */
const SINK_M = 4;
/** Lake disc past the crater's radius: out over its wall, where the ground cuts the shore */
const DISC_REACH = 1.3;
/** Metres between the disc's vertices at most */
const DISC_STEP = 2;
/** A fall shows from this drop on, m */
const FALL_FROM_M = 0.5;

interface Lake {
  entry: CraterWaterEntry;
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  fall: Mesh<BufferGeometry, ShaderMaterial> | null;
  /** The drop the fall was built for, m */
  fallDrop: number;
  level: number;
  /** The stream of a spill that is not downstream */
  outflow: RiverSurface | null;
  /** Lava meeting water at the stream's end: the rock it sets as and the steam over it, shown once the lava is there */
  quench: { rock: Mesh<CircleGeometry, MeshStandardMaterial>; steam: ParticleField; at: number } | null;
}

export class CraterWaterLayer {
  readonly group = new Group();
  private lakes: Lake[] = [];
  private readonly time = { value: 0 };
  private readonly light = { value: 1 };
  private readonly scaleAt = new Matrix4();
  /** Rivers given craters last frame, by index: set back when theirs are gone */
  private touched = new Set<number>();

  constructor(
    private readonly heights: HeightTexture,
    private readonly mapHalf: Vector2,
    /** The map's ground, for the streams of the spills */
    private readonly field: HeightField,
    private readonly ground: Pick<RiverGround, 'grid' | 'width' | 'depth'>,
  ) {
    this.group.name = 'custom-map-crater-water';
    // A fall of water and one of lava, hidden: a compile of the scene builds their programs (three's compile walks
    // hidden objects), the first crater in a river finds them built
    for (const lava of [false, true]) {
      const standIn = buildWaterfalls([{ matrix: new Matrix4(), radius: 1, height: 1, pool: null, lava }], this.time, this.light);
      standIn.visible = false;
      standIn.frustumCulled = false;
      this.standIns.push(standIn);
      this.group.add(standIn);
    }
    // Lava set as rock and its steam likewise
    const rock = new Mesh(new CircleGeometry(1, 6), ROCK);
    const steam = new ParticleField('smoke', [{ kind: 'smoke', origin: new Vector3(), radius: 1, height: 1, count: 1, color: '#eef1f2', scale: 1 }], this.time, this.light);
    for (const m of [rock, steam.mesh]) {
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.steamStandIn = steam;
    this.rockStandIn = rock;
  }

  /** The hidden falls whose programs a compile builds */
  private readonly standIns: Mesh<BufferGeometry, ShaderMaterial>[] = [];
  private readonly steamStandIn: ParticleField;
  private readonly rockStandIn: Mesh<CircleGeometry, MeshStandardMaterial>;

  get size(): number {
    return this.lakes.length;
  }

  /** The craters cutting rivers as they stand now: lakes and falls made anew */
  set(given: readonly CraterWaterEntry[]): void {
    this.clear();
    for (const entry of chained(given)) {
      const material = createWaterMaterial({ kind: entry.kind, river: true, heights: this.heights, color: '', mapHalf: this.mapHalf });
      const mesh = new Mesh(lakeDisc(entry), material);
      mesh.name = 'custom-map-crater-lake';
      mesh.userData['losTransparent'] = true;
      mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      const drop = entry.cut.levelIn - entry.cut.floor;
      let fall: Lake['fall'] = null;
      if (drop > FALL_FROM_M) {
        const c = entry.crater;
        const lip = entry.cut.lip;
        // The object's front (+z) toward the bowl's middle; scene x is map -x
        const turn = Math.atan2(-(c.x - lip.x), c.y - lip.y);
        const matrix = new Matrix4().compose(new Vector3(-lip.x, entry.cut.floor, lip.y), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn), new Vector3(1, 1, 1));
        fall = buildWaterfalls([{ matrix, radius: Math.max(1, entry.cut.lipHalf), height: drop, pool: null, lava: entry.kind === 'lava' }], this.time, this.light);
        fall.matrixAutoUpdate = false;
        this.group.add(fall);
      }
      let outflow: RiverSurface | null = null;
      const way = entry.cut.outflow;
      if (way && way.length >= 2) {
        const river: MapRiver = { id: 'crater-outflow', kind: entry.kind, points: way };
        const ground: RiverGround = { ...this.ground, rivers: [river], water: null, waterBodies: [] };
        outflow = new RiverSurface(this.field, this.heights, river, ground, riverNetwork(ground), 0);
        this.group.add(outflow.mesh);
      }
      let quench: Lake['quench'] = null;
      if (way && entry.kind === 'lava' && entry.cut.outflowMeets === 'water') {
        const end = way[way.length - 1];
        const rock = new Mesh(new CircleGeometry(Math.max(2, end.width * 1.5), 20), ROCK);
        rock.rotation.x = -Math.PI / 2;
        rock.position.set(-end.x, end.height + 0.05, end.y);
        rock.receiveShadow = true;
        rock.visible = false;
        const steam = new ParticleField('smoke', [{ kind: 'smoke', origin: new Vector3(-end.x, end.height, end.y), radius: end.width, height: 6, count: 24, color: '#eef1f2', scale: 1 }], this.time, this.light);
        steam.mesh.visible = false;
        this.group.add(rock, steam.mesh);
        quench = { rock, steam, at: wayLength(way) };
      }
      this.lakes.push({ entry, mesh, fall, fallDrop: drop, level: NaN, outflow, quench });
    }
  }

  /**
   * The lakes, falls and rivers at game time `now` (s); `dt` the frame's
   * clock for the water's own motion; `riverAt` the drawn river of an index
   */
  update(now: number, dt: number, riverAt: (index: number) => RiverSurface | undefined): void {
    this.time.value += dt;
    for (const lake of this.lakes) {
      lake.mesh.material.uniforms['uTime'].value += dt;
      const level = levelOf(lake.entry, now);
      if (level !== lake.level) {
        lake.level = level;
        setDiscLevel(lake.mesh.geometry, level);
        // The fall's sheet from the lip down to the lake: its frame held at the lip, squeezed to the drop
        if (lake.fall) {
          const top = lake.entry.cut.levelIn;
          const k = Math.max(0.001, (top - level) / lake.fallDrop);
          this.scaleAt.makeTranslation(0, top, 0).multiply(new Matrix4().makeScale(1, k, 1)).multiply(new Matrix4().makeTranslation(0, -top, 0));
          lake.fall.matrix.copy(this.scaleAt);
        }
      }
      // The stream of a spill elsewhere: its front coming down its way once the lake is full
      if (lake.quench) {
        const there = streamFront(lake.entry, now) >= lake.quench.at;
        lake.quench.rock.visible = there;
        lake.quench.steam.mesh.visible = there;
      }
      if (lake.outflow) {
        const front = streamFront(lake.entry, now);
        lake.outflow.setCraters(front === Infinity ? [] : [{ gone: [front, 1e9], from: 0, dry: 0, filled: 0, sink: 0 }]);
        lake.outflow.update(dt);
      }
      // The fall pours while water comes down the river to it (not before a crater upstream spills)
      if (lake.fall) lake.fall.visible = lake.entry.cut.levelIn - level > FALL_FROM_M && (lake.entry.start === null || now >= lake.entry.start);
    }
    // The rivers: per river its craters' stretches gone and beds dry
    const byRiver = new Map<number, { gone: [number, number]; from: number; dry: number; filled: number; sink: number; lake: number }[]>();
    for (const lake of this.lakes) {
      const e = lake.entry;
      const list = byRiver.get(e.cut.river) ?? [];
      list.push({ gone: [e.cut.entry, e.cut.exit], from: e.cut.exit, ...bedOf(e, now), lake: lake.level });
      byRiver.set(e.cut.river, list);
    }
    for (const r of this.touched) if (!byRiver.has(r)) riverAt(r)?.setCraters([]);
    this.touched = new Set(byRiver.keys());
    for (const [r, list] of byRiver) riverAt(r)?.setCraters(list);
  }

  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number, darkness = 0): void {
    this.light.value = 1 - darkness * 0.85;
    for (const lake of this.lakes) {
      setWaterSky(lake.mesh.material, skyUniforms, sunIntensity, darkness);
      lake.outflow?.setSky(skyUniforms, sunIntensity, darkness);
    }
  }

  setEffects(on: MapEffects, copy: SceneCopy): void {
    for (const lake of this.lakes) {
      const { refraction } = setWaterEffects(lake.mesh.material, lake.entry.kind, on, copy);
      lake.mesh.onBeforeRender = refraction ? (renderer) => copy.capture(renderer) : () => undefined;
      setHeatHaze(lake.mesh, on.lavaGlow && lake.entry.kind === 'lava' ? copy : null);
      lake.outflow?.setEffects(on, copy, lake.entry.kind);
    }
  }

  clear(): void {
    for (const lake of this.lakes) {
      setHeatHaze(lake.mesh, null);
      lake.mesh.geometry.dispose();
      lake.mesh.material.dispose();
      lake.fall?.geometry.dispose();
      lake.fall?.material.dispose();
      lake.outflow?.dispose();
      lake.quench?.rock.geometry.dispose();
      lake.quench?.steam.dispose();
    }
    this.lakes = [];
    this.group.clear();
    for (const standIn of this.standIns) this.group.add(standIn);
    this.group.add(this.rockStandIn, this.steamStandIn.mesh);
  }

  dispose(): void {
    this.clear();
    for (const standIn of this.standIns) {
      standIn.geometry.dispose();
      standIn.material.dispose();
    }
    this.rockStandIn.geometry.dispose();
    this.steamStandIn.dispose();
    this.group.removeFromParent();
  }
}

/**
 * The craters along one river in turn: one below another that is filling
 * gets water only once that one spills into its bed and the water has come
 * down to it (its `start` then); below one that spills elsewhere none comes
 * (Infinity: an empty bowl, no fall). One known before (start null) stands
 * full as it was.
 */
export function chained(entries: readonly CraterWaterEntry[]): CraterWaterEntry[] {
  const out = entries.map((e) => ({ ...e }));
  const byRiver = new Map<number, CraterWaterEntry[]>();
  for (const e of out) byRiver.set(e.cut.river, [...(byRiver.get(e.cut.river) ?? []), e]);
  for (const list of byRiver.values()) {
    list.sort((a, b) => a.cut.entry - b.cut.entry);
    for (let k = 1; k < list.length; k++) {
      const up = list[k - 1];
      const e = list[k];
      if (e.start === null || up.start === null || e.cut.entry < up.cut.exit) continue;
      const slow = up.kind === 'lava' ? LAVA_SLOWER : 1;
      const arrives = up.cut.downstream ? up.start + up.cut.fillSeconds + ((e.cut.entry - up.cut.exit) * slow) / REFILL_MS : Infinity;
      e.start = Math.max(e.start, arrives);
    }
  }
  return out;
}

/** Lava set as rock where it ran into water */
const ROCK = new MeshStandardMaterial({ color: '#2b2725', roughness: 0.95, metalness: 0 });

/** Metres along a way of points */
function wayLength(way: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let k = 1; k < way.length; k++) s += Math.hypot(way[k].x - way[k - 1].x, way[k].y - way[k - 1].y);
  return s;
}

/** How far down its way a spill's stream has come at game time `now`, m: from when the lake is full; all of it for one known before */
export function streamFront(entry: Pick<CraterWaterEntry, 'cut' | 'start' | 'kind'>, now: number): number {
  if (entry.start === null) return Infinity;
  const slow = entry.kind === 'lava' ? LAVA_SLOWER : 1;
  return Math.max(0, now - entry.start - entry.cut.fillSeconds) * (REFILL_MS / slow);
}

/** The lake's level at game time `now`: full for a crater known before */
export function levelOf(entry: Pick<CraterWaterEntry, 'cut' | 'start'>, now: number): number {
  return entry.start === null ? entry.cut.level : lakeLevelAt(entry.cut, now - entry.start);
}

/**
 * The bed below the crater at game time `now`: how far down from the
 * crater it has run dry, how far the water came back down it since the
 * lake spilled into it, and how deep its water sinks. A crater known before
 * leaves its bed as it is; one that spills elsewhere leaves it dry.
 */
export function bedOf(entry: Pick<CraterWaterEntry, 'cut' | 'start' | 'kind'>, now: number): { dry: number; filled: number; sink: number } {
  if (entry.start === null) return entry.cut.downstream ? { dry: 0, filled: 0, sink: 0 } : { dry: 1e6, filled: 0, sink: SINK_M };
  const slow = entry.kind === 'lava' ? LAVA_SLOWER : 1;
  const t = now - entry.start;
  const dry = (t * DRAIN_MS) / slow;
  const filled = entry.cut.downstream ? (Math.max(0, t - entry.cut.fillSeconds) * REFILL_MS) / slow : 0;
  // Once the water is back all the way down to where the bed had run dry, nothing is sunk
  if (filled >= dry) return { dry: 0, filled: 0, sink: 0 };
  return { dry, filled, sink: SINK_M };
}

/** A disc of vertices over the crater out past its wall, flowing from the lip toward the spill */
function lakeDisc(entry: CraterWaterEntry): BufferGeometry {
  const c = entry.crater;
  const reach = c.radius * DISC_REACH;
  const n = Math.max(4, Math.ceil((reach * 2) / DISC_STEP));
  const step = (reach * 2) / n;
  // The current: slow, from the lip toward the spill
  const fx = entry.cut.spill.x - entry.cut.lip.x;
  const fy = entry.cut.spill.y - entry.cut.lip.y;
  const fl = Math.hypot(fx, fy) || 1;
  const speed = 0.25;
  const pos: number[] = [];
  const flow: number[] = [];
  const across: number[] = [];
  const join: number[] = [];
  const index: number[] = [];
  const id = new Int32Array((n + 1) * (n + 1)).fill(-1);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = c.x - reach + i * step;
      const y = c.y - reach + j * step;
      const r = Math.hypot(x - c.x, y - c.y) / reach;
      // A square's corners out past the disc: the next ring in
      if (r > 1 + step / reach) continue;
      id[j * (n + 1) + i] = pos.length / 3;
      pos.push(-x, 0, y);
      flow.push((-fx / fl) * speed, (fy / fl) * speed);
      across.push(Math.min(1, r));
      // Round past the crater's rim: the disc gives way out there (opaque lava cut its square edge into the channel)
      const t = Math.min(1, Math.max(0, (r * DISC_REACH - 1.05) / 0.2));
      join.push(t * t * (3 - 2 * t), 0);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = id[j * (n + 1) + i];
      const b = id[j * (n + 1) + i + 1];
      const d = id[(j + 1) * (n + 1) + i];
      const e = id[(j + 1) * (n + 1) + i + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      index.push(a, d, b, b, d, e, a, b, d, b, e, d);
    }
  }
  const count = pos.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow), 2));
  g.setAttribute('aAcross', new BufferAttribute(new Float32Array(across), 1));
  g.setAttribute('aJoin', new BufferAttribute(new Float32Array(join), 2));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(count), 1));
  g.setAttribute('aDepth', new BufferAttribute(new Float32Array(count).fill(1), 1));
  g.setAttribute('aWall', new BufferAttribute(new Float32Array(count * 2), 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** The disc at `level`: its vertices' heights */
function setDiscLevel(g: BufferGeometry, level: number): void {
  const p = g.getAttribute('position') as BufferAttribute;
  for (let k = 0; k < p.count; k++) p.setY(k, level);
  p.needsUpdate = true;
  g.computeBoundingSphere();
}
