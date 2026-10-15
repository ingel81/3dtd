/**
 * Object placement: the scatter brush (density, random size and turn, a
 * minimum distance, sinking into slopes), its eraser, box selection, grid
 * snap and duplicates. Ids are `o<number>`, counted on from the highest.
 */
import type { CustomMapDocument, MapObject, MapPoint, MapTerrain } from '../../world/custom-map/map-document';
import { CompoundCommand, PatchCommand, patchLayout, type EditCommand } from '../model/editor-document';
import { heightAt, slopeAt, insideMap, sampleRectAround, sampleX, sampleY, type GridRect } from '../model/grid';
import { RegionRecorder } from '../model/region-patch';
import { HEIGHT_LIMITS } from './terrain-ops';
import { brushWeight, type BrushSettings } from './brush';

/** Hands out fresh object ids, starting past the highest in the map */
export class ObjectIds {
  private next: number;

  constructor(objects: readonly MapObject[]) {
    let max = 0;
    for (const o of objects) {
      const m = /^o(\d+)$/.exec(o.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    this.next = max + 1;
  }

  take(): string {
    return `o${this.next++}`;
  }
}

export interface ScatterOptions {
  /** Asset ids to pick from at random */
  assets: readonly string[];
  /** Objects per 1000 square metres at full strength */
  density: number;
  scaleMin: number;
  scaleMax: number;
  /** Turn each object at random */
  randomRotation: boolean;
  /** No two objects closer than this, metres */
  minDistance: number;
  /** Sink objects into slopes so they do not float on the low side */
  sinkOnSlope: boolean;
  /** Colour every object is tinted with, null for none */
  tint: string | null;
  /** 0..1: how far each object's tint strays from it (from white without a tint) */
  tintVariation: number;
  /** Tilt each object with the ground under it */
  alignToSlope: boolean;
}

export const DEFAULT_SCATTER: ScatterOptions = {
  assets: [],
  density: 4,
  scaleMin: 0.8,
  scaleMax: 1.25,
  randomRotation: true,
  minDistance: 4,
  sinkOnSlope: true,
  tint: null,
  tintVariation: 0,
  alignToSlope: false,
};

/**
 * The tilt (`pitch`, `roll`) that stands an object turned by `rotation`
 * square on the ground at (x, y): its up axis along the ground's normal,
 * averaged over `reach` metres (its footprint), so a rock lies on the slope
 * instead of floating on its low side. The renderer turns by the rotation,
 * then tilts about the model's own x and z axes (Euler XZY): the up vector
 * becomes (-sin roll, cos roll cos pitch, cos roll sin pitch) in the turned
 * frame, solved here for the normal. Radians, rounded.
 */
export function slopeTilt(terrain: MapTerrain, x: number, y: number, rotation: number, reach = 2): { pitch: number; roll: number } {
  const d = Math.max(terrain.grid.cellSize, reach);
  const dhdx = (heightAt(terrain, x + d, y) - heightAt(terrain, x - d, y)) / (2 * d);
  const dhdy = (heightAt(terrain, x, y + d) - heightAt(terrain, x, y - d)) / (2 * d);
  // The normal in the scene's frame (x west, y up, z north), then into the object's turned frame
  const len = Math.hypot(dhdx, 1, dhdy);
  const sx = dhdx / len;
  const sy = 1 / len;
  const sz = -dhdy / len;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const lx = sx * c - sz * s;
  const lz = sx * s + sz * c;
  const roll = Math.asin(Math.max(-1, Math.min(1, -lx)));
  const pitch = Math.atan2(lz, sy);
  return { pitch: Math.round(pitch * 1000) / 1000, roll: Math.round(roll * 1000) / 1000 };
}

/** The object with the ground's tilt where it stands (no tilt on flat ground) */
export function alignedToSlope<T extends MapObject>(terrain: MapTerrain, o: T, reach = 2): T {
  const { pitch, roll } = slopeTilt(terrain, o.x, o.y, o.rotation, reach * (o.scale || 1));
  return withTilt(o, pitch, roll);
}

/** A rock's underside at scale 1: half width (model x), half depth (model z), depth of its lowest point below the pivot */
export type Underside = readonly [number, number, number];

/** What settling needs of a rock: its underside and its height at scale 1 (catalogue `base` and `height`) */
export interface RockShape {
  base: Underside;
  height: number;
}

/** The rock shape of a catalogue entry, undefined for anything without an underside (trees, houses, set pieces) */
export function rockShape(entry: { base?: Underside; height: number }): RockShape | undefined {
  return entry.base ? { base: entry.base, height: entry.height } : undefined;
}

/** A rock sinks at most this share of its height into the ground; where it would have to sink further it tilts with the slope */
export const MAX_SINK = 0.35;

/**
 * How far the underside of a rock hangs over the ground, metres: the plane
 * of its plate (its lowest point at the ground under its middle plus its z,
 * tilted with its pitch and roll) against the ground on two ellipses under
 * it, the outer one the plate's rim. 0 where it touches or sinks in
 * everywhere. A flat-bottomed rock standing level on a slope hangs over by
 * about the plate's half width times the slope.
 */
export function undersideGap(terrain: MapTerrain, o: MapObject, base: Underside): number {
  const s = o.scale || 1;
  const c = Math.cos(o.rotation);
  const n = Math.sin(o.rotation);
  // The plate's slope in map space from the tilt: the model's up axis (see slopeTilt), turned, as a gradient
  const pitch = o.pitch ?? 0;
  const roll = o.roll ?? 0;
  const ux = -Math.sin(roll);
  const uy = Math.cos(roll) * Math.cos(pitch);
  const uz = Math.cos(roll) * Math.sin(pitch);
  const gx = (ux * c + uz * n) / uy;
  const gy = -(-ux * n + uz * c) / uy;
  const middle = heightAt(terrain, o.x, o.y) + o.z - base[2] * s;
  let gap = 0;
  for (const ring of [0.5, 1]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      // A point of the plate in the model's frame, turned into map space (scene x is map -x)
      const lx = Math.cos(a) * base[0] * s * ring;
      const lz = Math.sin(a) * base[1] * s * ring;
      const dx = -(lx * c + lz * n);
      const dy = -lx * n + lz * c;
      gap = Math.max(gap, middle + gx * dx + gy * dy - heightAt(terrain, o.x + dx, o.y + dy));
    }
  }
  return round(gap);
}

/**
 * The rock lowered until its plate touches the ground everywhere under it
 * (unchanged where it does). It sinks at most MAX_SINK of its height: on
 * steeper ground it first tilts toward the slope in quarter steps until the
 * rest fits, as a boulder on a hillside lies on it rather than in it.
 */
export function settled<T extends MapObject>(terrain: MapTerrain, o: T, rock: RockShape): T {
  const cap = MAX_SINK * rock.height * (o.scale || 1);
  let out = o;
  let gap = undersideGap(terrain, out, rock.base);
  if (gap > cap) {
    const full = slopeTilt(terrain, o.x, o.y, o.rotation, Math.max(rock.base[0], rock.base[1]) * (o.scale || 1));
    const pitch = o.pitch ?? 0;
    const roll = o.roll ?? 0;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      out = withTilt(o, round(pitch + (full.pitch - pitch) * f, 1000), round(roll + (full.roll - roll) * f, 1000));
      gap = undersideGap(terrain, out, rock.base);
      if (gap <= cap) break;
    }
  }
  return gap > 0 ? { ...out, z: round(out.z - gap) } : out;
}

/**
 * An object set down where it stands: tilted with the ground when `align`
 * (over its plate for a rock, `reach` metres otherwise), and a rock settled
 * onto its plate
 */
export function setDown<T extends MapObject>(terrain: MapTerrain, o: T, rock: RockShape | undefined, align: boolean, reach = 2): T {
  const tilted = align ? alignedToSlope(terrain, o, rock ? Math.max(rock.base[0], rock.base[1]) : reach) : o;
  return rock ? settled(terrain, tilted, rock) : tilted;
}

/** Metres of level ground around a building's footprint, and the least width over which it blends into the land */
export const BUILDING_PAD = 1.5;
const BUILDING_BLEND = 4;

/** A building that levels its ground when first placed: catalogue category building, not afloat, not on stilts */
export function levelsGround(entry: { footing?: { category: string; float?: boolean; stilts?: boolean } }): boolean {
  return entry.footing?.category === 'building' && !entry.footing.float && !entry.footing.stilts;
}

/**
 * Levels the ground under a building placed anew, so it stands whole and no
 * slope cuts into it on any side: the samples within its footprint radius
 * (`footprint` at scale 1, times its scale), BUILDING_PAD and one grid cell
 * more go to its base height, the mean of the ground under its middle and
 * eight points of its footprint (cut and fill alike); beyond that the
 * levelled ground blends smoothly into the land over the footprint radius,
 * at least BUILDING_BLEND metres and twice the height of the cut or fill,
 * so its banks stay gentle. The renderer stands it on the lowest of those
 * eight points (seatHeight), on level ground its base. `beforeWrite` saves
 * the rectangle first (an undo step). Returns the changed samples'
 * rectangle; null on ground level within 5 cm. Moving it later levels nothing.
 */
export function levelUnderBuilding(terrain: MapTerrain, o: MapObject, footprint: number, beforeWrite?: (rect: GridRect) => void): GridRect | null {
  const r = footprint * (o.scale || 1);
  const ground = [heightAt(terrain, o.x, o.y)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground.push(heightAt(terrain, o.x + Math.cos(a) * r, o.y + Math.sin(a) * r));
  }
  if (Math.max(...ground) - Math.min(...ground) < 0.05) return null;
  const base = ground.reduce((a, b) => a + b, 0) / ground.length;
  // One grid cell more: the ground between the samples at the footprint's edge is level too
  const core = r + BUILDING_PAD + terrain.grid.cellSize;
  // Banks no steeper than one in two: a deep cut or fill blends out wider
  let step = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    step = Math.max(step, Math.abs(heightAt(terrain, o.x + Math.cos(a) * core, o.y + Math.sin(a) * core) - base));
  }
  const blend = Math.max(BUILDING_BLEND, r, 2 * step);
  const rect = sampleRectAround(terrain, o.x, o.y, core + blend);
  beforeWrite?.(rect);
  const g = terrain.grid;
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      const d = Math.hypot(sampleX(terrain, i) - o.x, sampleY(terrain, j) - o.y);
      if (d >= core + blend) continue;
      const f = d <= core ? 1 : 1 - smoothstep((d - core) / blend);
      const k = j * g.columns + i;
      g.heights[k] = Math.min(HEIGHT_LIMITS.max, Math.max(HEIGHT_LIMITS.min, g.heights[k] + (base - g.heights[k]) * f));
    }
  }
  return rect;
}

/**
 * Levels the ground under buildings placed anew (levelUnderBuilding), each
 * of them, and returns that change as a command already in the map: the
 * editor's Place and line, and the agent's place put it in one step with
 * the placement (withGround). Null for any other asset or level ground.
 */
export function levelForBuildings(
  doc: CustomMapDocument,
  label: string,
  objects: readonly MapObject[],
  entry: { footing?: { category: string; float?: boolean }; radius: number },
): EditCommand | null {
  if (!levelsGround(entry)) return null;
  const recorder = new RegionRecorder(doc.terrain.grid.heights, patchLayout(doc, 'heights'));
  let changed = false;
  for (const o of objects) changed = !!levelUnderBuilding(doc.terrain, o, entry.radius, (r) => recorder.touch(r)) || changed;
  return changed ? new PatchCommand(label, [{ target: 'heights', patches: recorder.finish() }]) : null;
}

/** The placement and the levelled ground under it as one undo step */
export function withGround(label: string, ground: EditCommand | null, add: EditCommand): EditCommand {
  return ground ? new CompoundCommand(label, [ground, add]) : add;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function withTilt<T extends MapObject>(o: T, pitch: number, roll: number): T {
  const out = { ...o };
  if (pitch) out.pitch = pitch;
  else delete out.pitch;
  if (roll) out.roll = roll;
  else delete out.roll;
  return out;
}

/**
 * A tint near `base`: brightness and each channel drift by up to `amount`
 * (0..1, a quarter of the brightness and an eighth of a channel at 1), so a
 * row of trees or a heap of rocks is not of one colour. Hex.
 */
export function variedTint(base: string | null, amount: number, random: () => number): string | undefined {
  if (!base && amount <= 0) return undefined;
  const n = parseInt((base ?? '#ffffff').replace('#', ''), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const v = 1 - amount * 0.25 * random();
  const hex = rgb.map((c) => {
    const x = Math.round(Math.min(255, Math.max(0, c * v * (1 + (random() - 0.5) * amount * 0.25))));
    return x.toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}

/** Grid of objects by cell for distance checks while scattering */
export class ObjectGrid {
  private readonly cells = new Map<number, MapPoint[]>();

  constructor(
    private readonly cell: number,
    objects: readonly MapPoint[] = [],
  ) {
    for (const o of objects) this.add(o);
  }

  add(p: MapPoint): void {
    const key = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(p);
  }

  /** Forgets a point added before (an object taken away) */
  remove(p: MapPoint): void {
    const list = this.cells.get(this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell)));
    const k = list?.findIndex((q) => q.x === p.x && q.y === p.y) ?? -1;
    if (k >= 0) list!.splice(k, 1);
  }

  /** True when some point lies closer than `d` */
  near(p: MapPoint, d: number): boolean {
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    const r = Math.ceil(d / this.cell);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (const q of this.cells.get(this.key(i, j)) ?? []) {
          if (Math.hypot(q.x - p.x, q.y - p.y) < d) return true;
        }
      }
    }
    return false;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }
}

/**
 * One dab of the scatter brush: tries `density * area` spots weighted by
 * the brush and keeps those far enough from every object. Returns the new
 * objects (not yet in the map). Rocks (a shape from `rockOf`) settle onto
 * their plate when sinking on slopes; everything else sinks by the slope
 * under its middle.
 */
export function scatterDab(
  terrain: MapTerrain,
  center: MapPoint,
  brush: BrushSettings,
  options: ScatterOptions,
  grid: ObjectGrid,
  ids: ObjectIds,
  random: () => number,
  share = 1,
  rockOf: (asset: string) => RockShape | undefined = () => undefined,
  /** Floating assets: they lie at the waterline, neither sunk nor tilted by the ground under the water */
  floats: (asset: string) => boolean = () => false,
): MapObject[] {
  if (!options.assets.length) return [];
  const area = Math.PI * brush.radius * brush.radius;
  const tries = (options.density / 1000) * area * brush.strength * share;
  let n = Math.floor(tries);
  if (random() < tries - n) n++;
  const out: MapObject[] = [];
  for (let k = 0; k < n; k++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * brush.radius;
    const p = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
    if (random() > brushWeight(r, brush.radius, brush.falloff)) continue;
    if (!insideMap(terrain, p, 1)) continue;
    if (grid.near(p, options.minDistance)) continue;
    const scale = options.scaleMin + (options.scaleMax - options.scaleMin) * random();
    const asset = options.assets[Math.floor(random() * options.assets.length)];
    const rock = rockOf(asset);
    const float = floats(asset);
    const slope = options.sinkOnSlope && !rock && !float ? slopeAt(terrain, p.x, p.y) : 0;
    const object: MapObject = {
      id: ids.take(),
      asset,
      x: round(p.x),
      y: round(p.y),
      // About half a metre of sinking per 10 degrees, scaled with the object
      z: round(-Math.min(3, (slope / 10) * 0.5) * scale),
      rotation: options.randomRotation ? round(random() * Math.PI * 2, 1000) : 0,
      scale: round(scale, 1000),
    };
    const tint = variedTint(options.tint, options.tintVariation, random);
    if (tint) object.tint = tint;
    const placed = setDown(terrain, object, options.sinkOnSlope ? rock : undefined, options.alignToSlope && !float);
    grid.add(placed);
    out.push(placed);
  }
  return out;
}

/** Ids of objects under the brush (of the given assets, or any) */
export function objectsUnderBrush(doc: CustomMapDocument, center: MapPoint, radius: number, assets?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const o of doc.objects) {
    if (assets && assets.size && !assets.has(o.asset)) continue;
    if (Math.hypot(o.x - center.x, o.y - center.y) <= radius) out.push(o.id);
  }
  return out;
}

/** Ids of objects inside an axis-aligned box in map space */
export function objectsInBox(doc: CustomMapDocument, a: MapPoint, b: MapPoint): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return doc.objects.filter((o) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1).map((o) => o.id);
}

/** Copies of objects with fresh ids, moved by `offset` */
export function duplicateObjects(doc: CustomMapDocument, ids: readonly string[], offset: MapPoint): MapObject[] {
  const set = new Set(ids);
  const fresh = new ObjectIds(doc.objects);
  return doc.objects
    .filter((o) => set.has(o.id))
    .map((o) => ({ ...o, id: fresh.take(), x: round(o.x + offset.x), y: round(o.y + offset.y) }));
}

export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Centre of a set of objects */
export function centroid(doc: CustomMapDocument, ids: readonly string[]): MapPoint | null {
  const set = new Set(ids);
  let x = 0;
  let y = 0;
  let n = 0;
  for (const o of doc.objects) {
    if (!set.has(o.id)) continue;
    x += o.x;
    y += o.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

function round(v: number, f = 100): number {
  return Math.round(v * f) / f;
}

/** The ids with every other member of their groups added */
export function withGroups(objects: readonly MapObject[], ids: readonly string[]): string[] {
  const set = new Set(ids);
  const groups = new Set<string>();
  for (const o of objects) if (set.has(o.id) && o.group) groups.add(o.group);
  if (!groups.size) return [...ids];
  for (const o of objects) if (o.group && groups.has(o.group)) set.add(o.id);
  return [...set];
}

/** A group name no object uses yet: g1, g2 … */
export function freeGroup(objects: readonly MapObject[]): string {
  let max = 0;
  for (const o of objects) {
    const m = /^g(\d+)$/.exec(o.group ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `g${max + 1}`;
}

export interface LineOptions {
  /** Metres between two objects along the line */
  spacing: number;
  /** Metres to the left of the line's direction (negative: right) */
  offset: number;
  /** A second row mirrored to the other side */
  bothSides: boolean;
  /** Along the line (0), across it (90 degrees), or at random */
  turn: 'along' | 'across' | 'random';
  /** For a wall kit's pieces (wallAlong): blocks or towers at the corners, battlements' side; absent in settings of before */
  corners?: WallOptions['corners'];
  front?: WallOptions['front'];
}

export const DEFAULT_LINE: LineOptions = { spacing: 4, offset: 0, bothSides: false, turn: 'along', corners: 'blocks', front: 'left' };

/**
 * Objects of `asset` every `spacing` metres along a line, each in the middle
 * of its stretch: a fence, a wall, a row of torches or trees. Models face
 * north at turn 0; along the line means the line's direction turned to
 * north (as the level scripts' `row`). With `bothSides` a second row stands
 * as far to the right, turned the other way.
 */
export function objectsAlong(line: readonly MapPoint[], asset: string, options: LineOptions, ids: ObjectIds, random: () => number): MapObject[] {
  const length = polylineLengthOf(line);
  if (length < 0.5) return [];
  const n = Math.max(1, Math.round(length / Math.max(0.5, options.spacing)));
  const out: MapObject[] = [];
  const sides = options.bothSides && options.offset !== 0 ? [1, -1] : [1];
  for (let k = 0; k < n; k++) {
    const a = pointAlong(line, (k * length) / n);
    const b = pointAlong(line, ((k + 1) * length) / n);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dl = Math.hypot(dx, dy) || 1;
    for (const side of sides) {
      const off = options.offset * side;
      const along = Math.atan2(-dx, dy) + (side < 0 ? Math.PI : 0);
      const rotation = options.turn === 'random' ? random() * Math.PI * 2 : along + (options.turn === 'across' ? Math.PI / 2 : 0);
      out.push({
        id: ids.take(),
        asset,
        x: round((a.x + b.x) / 2 - (dy / dl) * off),
        y: round((a.y + b.y) / 2 + (dx / dl) * off),
        z: 0,
        rotation: round((((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)), 1000),
        scale: 1,
      });
    }
  }
  return out;
}

/**
 * A wall of fitting pieces (the castle kit): straight pieces of whole
 * lengths, a block at every corner and at the ends. The blocks are wider
 * than the walls and the walls may reach into them up to their middle, so
 * the straight pieces never need cutting: a leg takes whole pieces of 8, 4
 * and 2 m, and what is left over hides in the blocks.
 */
export interface WallKit {
  name: string;
  /** Straight pieces, longest first; lengths in metres, multiples of the shortest */
  pieces: readonly { asset: string; length: number }[];
  corner: string;
  end: string;
  /** A tower that may stand at the corners instead of the corner block */
  tower: string;
  /** How far along a leg a wall may reach into each kind of block (half its extent there), metres */
  reach: { corner: number; end: number; tower: number };
}

export const WALL_KITS: readonly WallKit[] = [
  {
    name: 'Castle wall',
    pieces: [
      { asset: 'castle-wall', length: 8 },
      { asset: 'castle-wall-half', length: 4 },
      { asset: 'castle-wall-short', length: 2 },
    ],
    corner: 'castle-wall-corner',
    end: 'castle-wall-end',
    tower: 'castle-tower',
    reach: { corner: 2.2, end: 1.6, tower: 3.6 },
  },
];

/** The kit an asset belongs to (one of its straight pieces, its corner or its end), or null */
export function wallKitOf(asset: string | null | undefined): WallKit | null {
  if (!asset) return null;
  return WALL_KITS.find((k) => k.pieces.some((p) => p.asset === asset) || k.corner === asset || k.end === asset) ?? null;
}

/** Where the kit's wall goes along a line: towers or blocks at the corners, battlements to the left (or right) of its direction */
export interface WallOptions {
  corners: 'blocks' | 'towers';
  /** The battlements' side, seen along the line's direction */
  front: 'left' | 'right';
}

/**
 * The pieces of a kit's wall along a line: the line straightened into legs
 * (a drawn line wobbles; points within 2 m of the straight leg go), a block
 * or tower at each corner, an end block at each end (none where the line
 * closes on itself), and on each leg whole straight pieces from block to
 * block. Models face north at turn 0 and run east-west, so a piece along a
 * leg turns a quarter more than the line's direction.
 */
export function wallAlong(line: readonly MapPoint[], kit: WallKit, options: WallOptions, ids: ObjectIds): MapObject[] {
  let legs = simplifyLine(line, 2);
  if (legs.length < 2) return [];
  const near = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 6;
  const closed = legs.length > 3 && near(legs[0], legs[legs.length - 1]);
  if (closed) {
    // The ring: its last points near the start go, the start closes it; a start in the middle of a side is no corner
    while (legs.length > 3 && near(legs[0], legs[legs.length - 1])) legs.pop();
    legs = straightOnly(legs, true);
    legs.push({ ...legs[0] });
  } else legs = straightOnly(legs, false);
  if (legs.length < 2) return [];
  const out: MapObject[] = [];
  const flip = options.front === 'right' ? Math.PI : 0;
  const turnOf = (a: MapPoint, b: MapPoint) => wrapTurn(Math.atan2(-(b.x - a.x), b.y - a.y) + Math.PI / 2 + flip);
  const corner = options.corners === 'towers' ? kit.tower : kit.corner;
  const cornerReach = options.corners === 'towers' ? kit.reach.tower : kit.reach.corner;
  const add = (asset: string, p: MapPoint, rotation: number) =>
    out.push({ id: ids.take(), asset, x: round(p.x), y: round(p.y), z: 0, rotation: round(rotation, 1000), scale: 1 });
  // Blocks at the vertices
  const last = legs.length - 1;
  for (let k = 0; k < (closed ? last : last + 1); k++) {
    // Turned like the leg that leaves it (the last end like the leg that comes in)
    const rotation = k < last ? turnOf(legs[k], legs[k + 1]) : turnOf(legs[k - 1], legs[k]);
    add(!closed && (k === 0 || k === last) ? kit.end : corner, legs[k], rotation);
  }
  // Straight pieces on each leg
  const unit = kit.pieces[kit.pieces.length - 1].length;
  for (let k = 0; k < last; k++) {
    const a = legs[k];
    const b = legs[k + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const reachA = !closed && k === 0 ? kit.reach.end : cornerReach;
    const reachB = !closed && k + 1 === last ? kit.reach.end : cornerReach;
    const lo = Math.ceil((length - reachA - reachB) / unit - 1e-9) * unit;
    const hi = Math.floor(length / unit + 1e-9) * unit;
    if (hi <= 0 || lo > hi) continue;
    const total = Math.min(hi, Math.max(lo, Math.round((length - (reachA + reachB) / 2) / unit) * unit));
    if (total <= 0) continue;
    // Where the run starts: both ends inside their blocks, the overhang shared by the blocks' reaches
    const start = Math.min(Math.min(reachA, length - total), Math.max(Math.max(0, length - total - reachB), ((length - total) * reachA) / (reachA + reachB)));
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const rotation = turnOf(a, b);
    let at = start;
    let rest = total;
    for (const piece of kit.pieces) {
      while (rest >= piece.length - 1e-9) {
        const mid = at + piece.length / 2;
        add(piece.asset, { x: a.x + ux * mid, y: a.y + uy * mid }, rotation);
        at += piece.length;
        rest -= piece.length;
      }
    }
  }
  return out;
}

/** The line without the points it hardly bends at (under 12 degrees): no corner block where a wall runs on straight */
function straightOnly(points: MapPoint[], ring: boolean): MapPoint[] {
  const out = [...points];
  let changed = true;
  while (changed && out.length > (ring ? 3 : 2)) {
    changed = false;
    for (let k = ring ? 0 : 1; k < (ring ? out.length : out.length - 1); k++) {
      const a = out[(k - 1 + out.length) % out.length];
      const p = out[k];
      const b = out[(k + 1) % out.length];
      const turn = Math.abs(Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)));
      if (turn < (12 * Math.PI) / 180) {
        out.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function wrapTurn(r: number): number {
  return ((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

/** The line with the points left out that lie within `tolerance` metres of the straight between their neighbours (Douglas-Peucker) */
export function simplifyLine(line: readonly MapPoint[], tolerance: number): MapPoint[] {
  if (line.length < 3) return line.map((p) => ({ ...p }));
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = line[i];
    const b = line[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const p = line[k];
      const d = len < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return line.filter((_, k) => keep[k]).map((p) => ({ ...p }));
}

function polylineLengthOf(line: readonly MapPoint[]): number {
  let n = 0;
  for (let k = 1; k < line.length; k++) n += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  return n;
}

/** The point `along` metres down the line, clamped to its ends */
function pointAlong(line: readonly MapPoint[], along: number): MapPoint {
  let rest = along;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= d || k === line.length - 1) {
      const u = d ? Math.min(1, rest / d) : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    rest -= d;
  }
  return { ...line[0] };
}
