/**
 * The shape of a raised building's body (mass-layer.ts): its roof pieces,
 * caps and wall pieces for a flat, sloped or pyramid roof, the facade of
 * each wall, the roof's tint, and the bodies with their cellars added.
 */
import { MAP_MASS_FACADES, type MapMassCover, type MapMassFacade, type MapObject } from '../../map-document';
import { Color, ShapeUtils, Vector2 } from 'three';
import { MASS_PARAPET, massApex, type MassBody, massSlopes, ringsContain } from '../../object-mass';
import { FOUNDATION, openingInsides, pushWall, WALL_FACADE, WALL_GABLE, WALL_PLAIN, WALL_SHOP, type WallPiece } from './mass-openings';
import { cellarDrawnDepth, cellarOf } from '../../object-cellar';
import { gableIsTriangle, type RoofModel, type RoofPlaneFit } from '../../mass-roof';

/**
 * The buildings a map raises from their own footprint (MapObject.mass,
 * object-mass.ts), drawn as a few instanced primitives for the whole map:
 * every wall is one instance of a unit quad (its instance matrix stretches
 * it along the wall and up to the eaves, its third column is the wall's
 * outward normal), every triangle of a roof one instance of a unit triangle
 * (an affine instance matrix, its second column the roof's normal), every
 * side of a flat roof's parapet a wall turned inward and a coping on top.
 * A map of 2 000 such buildings draws in about ten calls (one per facade,
 * the coping, one per roof covering), as many again for the sun's shadow.
 * The calls share their programs: the facade and whether a roof is flat are
 * uniforms (uFacade, uFlatRoof), not variants of the shader, so all walls draw
 * with one program and all roofs with another, intact or as ruins.
 *
 * The facades come from the shader, not from the model: storeys and bays
 * laid out in metres per wall (centred, with a margin at the corners),
 * windows with frames, sills, reveals and blinds, a plinth and a cornice,
 * grime above the plinth and under the sills, lit windows at night; their
 * detail fades into the mean colour where a window is a few pixels. The
 * surfaces (plaster, concrete panels, metal sheet, brick, sandstone,
 * bitumen, roof tiles) are the textures of the catalogue's `building-mass`
 * (tools/map-assets/build_modern2.py, mass_kit), one square per surface as
 * wide as one repeat of its texture.
 *
 * A damaged building (setDamage) leaves those batches (its instances
 * shrink to nothing there) for the ruins': the same pieces with the damage
 * in the shader (ruin-damage.ts) and both sides drawn, a fallen one's walls
 * split at its break line so what stands above it falls whole. Only the
 * ruins are built anew on a change, a handful of buildings, not the map.
 */

/** Thickness of a flat roof's parapet, m */
export const PARAPET_THICKNESS = 0.3;

/** Facade index of each look, the shader's uFacade */
export const FACADE_INDEX: Readonly<Record<MapMassFacade, number>> = Object.fromEntries(MAP_MASS_FACADES.map((f, i) => [f, i])) as Record<MapMassFacade, number>;
/** Kit material of each facade */
export const FACADE_SURFACE: Readonly<Record<MapMassFacade, string>> = {
  plaster: 'mass-plaster',
  concrete: 'mass-concrete',
  metal: 'mass-metal',
  brick: 'mass-brick',
  stone: 'mass-stone',
  timber: 'mass-plaster',
};
/** Roof coverings: a flat roof's, and a pitched one's by the tags (MapMass.roofCover) or by facade (tiles on homes, sheet on halls) */
export type Covering = 'flat' | 'red' | 'grey' | 'metal';

/** The covering of each tagged roof material */
const COVER_COVERING: Readonly<Record<MapMassCover, Covering>> = { tiles: 'red', slate: 'grey', metal: 'metal' };

/**
 * The mean colour of each covering's surface as drawn (its texture times
 * its tint in the kit, about): a roof's own colour (MapMass.roofTint) is
 * drawn as its share of that, an instance colour, no program more
 */
const COVERING_MEAN: Readonly<Record<Covering, string>> = { flat: '#6f6f6f', red: '#9c5a44', grey: '#575b61', metal: '#9ea3a8' };

/** A roof colour's instance colour over its covering: the tag's colour against the covering's mean, held to a range the texture keeps its look in */
export function roofTintFactor(covering: Covering, tint: string, out: Color): Color {
  const mean = new Color(COVERING_MEAN[covering]);
  out.set(tint);
  out.r = Math.min(2.4, Math.max(0.3, out.r / Math.max(mean.r, 0.02)));
  out.g = Math.min(2.4, Math.max(0.3, out.g / Math.max(mean.g, 0.02)));
  out.b = Math.min(2.4, Math.max(0.3, out.b / Math.max(mean.b, 0.02)));
  return out;
}

/** The kind of the facade wall `edge` of the outline (ring 0), else of a courtyard's */
function facadeKind(m: MassBody, ring: number, edge: number): number {
  return ring === 0 && m.shop?.includes(edge) ? WALL_SHOP : WALL_FACADE;
}

/** A roof triangle in the building's own frame: corners a, b, c (x, y, z) with their texture places in metres */
interface RoofPiece {
  p: number[];
  uv: number[];
}

/** A coping on a parapet: start (x, z) on the inner line, direction along, length, the outward normal, height */
interface CapPiece {
  sx: number;
  sz: number;
  ax: number;
  az: number;
  length: number;
  nx: number;
  nz: number;
  y: number;
}

export interface MassShape {
  walls: WallPiece[];
  roof: RoofPiece[];
  covering: Covering;
  caps: CapPiece[];
}

const shapes = new WeakMap<MassBody, MassShape>();

/**
 * One body's walls, roof and parapet (a building's, or a part's:
 * massBodies) at scale 1 in the building's frame (model x, height y, model
 * z), worked out once
 */
export function massShape(m: MassBody, seed = 0): MassShape {
  let shape = shapes.get(m);
  if (shape) return shape;
  const slopes = massSlopes(m);
  const apex = massApex(m);
  shape = slopes ? slopedShape(m, slopes) : apex ? pyramidShape(m, apex) : flatShape(m);
  // The ways through the building it stands over: their reveals, ceilings, back walls (mass-openings.ts)
  if (m.openings?.length) shape.walls.push(...openingInsides(m));
  shape.covering = !slopes && !apex ? 'flat' : m.roofCover ? COVER_COVERING[m.roofCover] : m.facade === 'metal' ? 'metal' : seed % 3 === 0 ? 'grey' : 'red';
  shapes.set(m, shape);
  return shape;
}

/**
 * Where a body's walls start: on its floor over the seat (a part on
 * another), else the foundation below the seat, its cellar's foot where it
 * has one (MassBody.cellar)
 */
function wallFoot(m: MassBody): { bottom: number; lift?: number } {
  return (m.base ?? 0) > 0 ? { bottom: m.base!, lift: -m.base! } : { bottom: -Math.max(FOUNDATION, m.cellar?.depth ?? 0) };
}

const withCellars = new WeakMap<MassBody, { key: string; body: MassBody }>();

/** A raised building's bodies on the ground over its cellar (MapObject.cellar, object-cellar.ts), the others as they are */
export function cellarBodies(bodies: readonly MassBody[], o: Pick<MapObject, 'cellar' | 'scale'> & { z?: number }, ruin = true): readonly MassBody[] {
  const c = cellarOf(o, true);
  if (!c) return bodies;
  // A whole building's walls as far down as the slope leaves them open, a ruin's to the cellar's foot
  const cellar = { depth: cellarDrawnDepth(c, o.z ?? 0, ruin) / (o.scale || 1), storeys: c.storeys, buried: c.mode === 'buried' };
  const key = `${cellar.depth}|${cellar.storeys}|${cellar.buried}`;
  return bodies.map((b) => {
    if ((b.base ?? 0) > 0) return b;
    let w = withCellars.get(b);
    if (w?.key !== key) withCellars.set(b, (w = { key, body: { ...b, cellar } }));
    return w.body;
  });
}

/** Walls up every ring with windows, a parapet round a flat roof over the outline less its courtyards */
function flatShape(m: MassBody): MassShape {
  const walls: WallPiece[] = [];
  const caps: CapPiece[] = [];
  const roofY = m.height - MASS_PARAPET;
  const foot = wallFoot(m);
  m.rings.forEach((ring, k) => {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const e = edge(m, ring[j], ring[j + 1], ring[i], ring[i + 1]);
      if (!e) continue;
      pushWall(walls, m, { ...e, ...foot, top: m.height, kind: facadeKind(m, k, j / 2), band: MASS_PARAPET + 0.25 });
      // The parapet's inside: a plain wall a parapet's thickness in, facing in; the coping across both
      const t = PARAPET_THICKNESS;
      const inner = { sx: e.sx - e.nx * t + e.ax * e.length, sz: e.sz - e.nz * t + e.az * e.length, ax: -e.ax, az: -e.az, length: e.length, nx: -e.nx, nz: -e.nz };
      walls.push({ ...inner, bottom: roofY, top: m.height, kind: WALL_PLAIN, band: 0 });
      caps.push({ sx: e.sx - e.nx * t, sz: e.sz - e.nz * t, ax: e.ax, az: e.az, length: e.length, nx: e.nx, nz: e.nz, y: m.height });
    }
  });
  const roof: RoofPiece[] = [];
  const contour = toPoints(m.rings[0]);
  const holes = m.rings.slice(1).map(toPoints);
  const all = [contour, ...holes].flat();
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holes)) {
    const pa = all[a];
    const pb = all[b];
    const pc = all[c];
    roof.push({ p: [pa.x, roofY, pa.y, pb.x, roofY, pb.y, pc.x, roofY, pc.y], uv: [pa.x, pa.y, pb.x, pb.y, pc.x, pc.y] });
  }
  return { walls, roof, covering: 'flat', caps };
}

/**
 * A sloped roof over any outline (mass-roof.ts): the walls to the eaves (a
 * skillion's on up to its slope over a plain triangle), the roof's faces
 * with their eaves and verges, the gables standing on the wing ends
 */
function slopedShape(m: MassBody, model: RoofModel): MassShape {
  const walls: WallPiece[] = [];
  const roof: RoofPiece[] = [];
  const h = m.height;
  const foot = wallFoot(m);
  const lean = model.walls;
  m.rings.forEach((ring, k) => {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const e = edge(m, ring[j], ring[j + 1], ring[i], ring[i + 1]);
      if (!e) continue;
      if (!lean) {
        pushWall(walls, m, { ...e, ...foot, top: h, kind: facadeKind(m, k, j / 2), band: 0.3 });
        continue;
      }
      // Up to its lower end with the cornice at the eaves (the storeys as on the low walls), a triangle on to the slope
      const r0 = riseOf(lean, e.sx, e.sz);
      const r1 = riseOf(lean, e.sx + e.ax * e.length, e.sz + e.az * e.length);
      const low = Math.max(0, Math.min(r0, r1));
      pushWall(walls, m, { ...e, ...foot, top: h + low, kind: facadeKind(m, k, j / 2), band: 0.3 + low });
      if (Math.abs(r1 - r0) > 0.02) walls.push({ ...e, bottom: h + low, top: h + Math.max(r0, r1), kind: WALL_GABLE, band: 0, apex: r1 > r0 ? 1 : 0 });
    }
  });
  for (const g of model.gables) {
    const e = edge(m, g.ax, g.az, g.bx, g.bz);
    if (!e) continue;
    // The chain's metres from a, as metres from the wall's start (edge turns it to face out)
    const fromA = Math.abs(e.sx - g.ax) + Math.abs(e.sz - g.az) < 1e-6;
    const u = (along: number) => (fromA ? along : e.length - along);
    const t = g.top;
    if (gableIsTriangle(g)) {
      walls.push({ ...e, bottom: h, top: h + t[3], kind: WALL_GABLE, band: 0, apex: Math.min(1, Math.max(0, u(t[2]) / e.length)) });
      continue;
    }
    // A half-hip's trapezoid: per stretch of its top a plain piece up to its lower end and a triangle on top
    for (let q = 0; q + 3 < t.length; q += 2) {
      const ua = u(t[q]);
      const ub = u(t[q + 2]);
      const length = Math.abs(ub - ua);
      if (length < 0.02) continue;
      const start = Math.min(ua, ub);
      const piece = { ...e, sx: e.sx + e.ax * start, sz: e.sz + e.az * start, length, u0: start };
      const ra = t[q + 1];
      const rb = t[q + 3];
      const low = Math.min(ra, rb);
      if (low > 0.01) walls.push({ ...piece, bottom: h, top: h + low, kind: WALL_PLAIN, band: 0 });
      // The higher end of the stretch: its far end when the rise grows along the wall's way
      const higherFar = (rb > ra) === (ub > ua);
      if (Math.abs(rb - ra) > 0.01) walls.push({ ...piece, bottom: h + low, top: h + Math.max(ra, rb), kind: WALL_GABLE, band: 0, apex: higherFar ? 1 : 0 });
    }
  }
  for (const poly of model.polygons) {
    const contour = toPoints(poly.rings[0]);
    const holes = poly.rings.slice(1).map(toPoints);
    const all = [contour, ...holes].flat();
    // Texture: along the eaves, and down the slope in metres along it (a flat top in x, z)
    const g = Math.sqrt(poly.px * poly.px + poly.pz * poly.pz);
    const down = g > 1e-6 ? [-poly.px / g, -poly.pz / g] : [0, 0];
    const stretch = Math.sqrt(1 + g * g);
    const uv = (p: Vector2): number[] => (poly.flat || g <= 1e-6 ? [p.x, p.y] : [p.x * poly.ux + p.y * poly.uz, (p.x * down[0] + p.y * down[1]) * stretch]);
    const y = (p: Vector2) => h + poly.px * p.x + poly.pz * p.y + poly.p0;
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holes)) {
      const pa = all[a];
      const pb = all[b];
      const pc = all[c];
      roof.push({ p: [pa.x, y(pa), pa.y, pb.x, y(pb), pb.y, pc.x, y(pc), pc.y], uv: [...uv(pa), ...uv(pb), ...uv(pc)] });
    }
  }
  return { walls, roof, covering: 'red', caps: [] };
}

/** A plane's rise over the eaves at (x, z) */
function riseOf(p: RoofPlaneFit, x: number, z: number): number {
  return p.px * x + p.pz * z + p.p0;
}

/** Walls to the eaves, a slope from every wall up to the top over the outline's middle (a tower's helm) */
function pyramidShape(m: MassBody, apex: { x: number; z: number }): MassShape {
  const walls: WallPiece[] = [];
  const roof: RoofPiece[] = [];
  const r = m.rings[0];
  const h = m.height;
  const top = h + (m.ridge ?? 0);
  const n = r.length / 2;
  const foot = wallFoot(m);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const e = edge(m, r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]);
    if (e) pushWall(walls, m, { ...e, ...foot, top: h, kind: facadeKind(m, 0, i), band: 0.3 });
    // The slope over this wall: its texture along the wall and up the slope from its middle
    const ax = r[2 * i];
    const az = r[2 * i + 1];
    const bx = r[2 * j];
    const bz = r[2 * j + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const up = Math.hypot((ax + bx) / 2 - apex.x, (az + bz) / 2 - apex.z, top - h);
    roof.push({ p: [ax, h, az, bx, h, bz, apex.x, top, apex.z], uv: [0, up, len, up, len / 2, 0] });
  }
  return { walls, roof, covering: 'red', caps: [] };
}

/** One edge of a ring as a wall: its start, direction and length, its normal pointing off the body; null if too short */
function edge(m: MassBody, x0: number, z0: number, x1: number, z1: number): Omit<WallPiece, 'bottom' | 'top' | 'kind' | 'band'> | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return null;
  let nx = dz / length;
  let nz = -dx / length;
  // Off the building: a step out of the middle of the edge lands outside it (a courtyard counts as outside)
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  if (ringsContain(m.rings, mx + nx * 0.05, mz + nz * 0.05)) {
    nx = -nx;
    nz = -nz;
  }
  // Along: up x normal (model space, y up), so along x up = normal and the quad faces out
  const ax = nz;
  const az = -nx;
  const forward = dx * ax + dz * az > 0;
  return { sx: forward ? x0 : x1, sz: forward ? z0 : z1, ax, az, length, nx, nz };
}

function toPoints(ring: readonly number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) out.push(new Vector2(ring[i], ring[i + 1]));
  // Earcut takes the outline either way round; drop a repeated last point
  if (out.length > 1 && out[0].equals(out[out.length - 1])) out.pop();
  return out;
}

/**
 * A fallen building's walls: each that crosses the break line `at` (over
 * the seat, the building's units) as its stump and the piece above, a
 * `gap` apart, so each piece lies wholly on one side of it; the same for a
 * cut above it (collapseCuts). Gables stay whole: they rise from the
 * eaves, above any break line but a low hut's
 */
export function splitWalls(walls: readonly WallPiece[], at: number, gap: number): WallPiece[] {
  const out: WallPiece[] = [];
  for (const p of walls) {
    // Gables and the wedges of an opening's ceiling stay whole
    if (p.kind === WALL_GABLE || p.corner || p.bottom >= at - gap || p.top <= at + gap) {
      out.push(p);
      continue;
    }
    // Both keep the wall's top for its storeys and cornice; the upper one's metres start at its bottom
    out.push({ ...p, top: at - gap / 2, wallTop: p.wallTop ?? p.top }, { ...p, bottom: at + gap / 2, wallTop: p.wallTop ?? p.top, lift: -(at + gap / 2) });
  }
  return out;
}
