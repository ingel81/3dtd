/**
 * The fronts of a placed building where a shop, an inn or a practice shows
 * itself (docs/OSM_WORLD_ROUND2_PLAN.md, E239, "Fassadenanker"): the middle
 * of a wall at its foot, the way it faces, its width and the height of the
 * ground floor. pois.ts hangs signs, awnings and shopfronts there.
 *
 * Catalogue buildings: from their wall box (building-tags.ts) and the model
 * table below: the street front (model +z, which the generator turns to the
 * nearest street) and, for houses that stand alone, the two sides; a corner
 * house its west side too; never the back. Buildings raised from their
 * footprint (MapObject.mass, render/objects/mass-layer.ts): every edge of
 * the outline long enough for a shop, its storeys as the mass shader draws
 * them.
 */
import { MASS_PARAPET, massContains } from '../../custom-map/object-mass';
import type { MapMass, MapMassFacade, MapObject } from '../../custom-map/map-document';
import type { BuildingModel } from '../building-tags';

/** One front of a building, in map metres */
export interface FacadeAnchor {
  /** Middle of the wall's foot */
  x: number;
  y: number;
  /** Unit normal out of the wall */
  nx: number;
  ny: number;
  /** Width of the wall */
  width: number;
  /** Height of the ground floor's top over the building's foot */
  ground: number;
  /** Where a sign board goes on this front: its foot over the building's foot and its greatest height (free wall under the first floor's windows, or the fascia of a shop floor) */
  boardZ: number;
  boardH: number;
  /** How far the front's parts stand out of the wall at the board's height (a fascia): the board stands this far out */
  proud: number;
  /** The ground floor has shop windows and a fascia of its own: no shopfront in front of it */
  shopFloor: boolean;
  /** The front carries a sign panel of its own (catalogue `signPanel`): a single shop writes there */
  panel: boolean;
  /** The building object it belongs to */
  object: string;
  /** 0 the street front, 1 east, 3 west (model sides) */
  side: 0 | 1 | 3;
}

interface FacadeModel {
  /** Top of the ground floor over the model's foot, metres at scale 1 */
  ground: number;
  /** A board's foot and greatest height, metres at scale 1 */
  board: readonly [number, number];
  /** Depth of the parts standing out of the wall box at the board's height, m (default PROUD) */
  proud?: number;
  shopFloor?: boolean;
  panel?: boolean;
}

/** What stands out of a wall box at least (sills, frames) */
const PROUD = 0.05;

/**
 * Ground floor of the gabled houses (build_modern.py: plinth 0.45 and one
 * storey of 2.85, the first floor's windows from 0.9 m over it): the board
 * between the ground floor's top and those windows
 */
const HOUSE: FacadeModel = { ground: 3.3, board: [3.38, 0.68] };

/**
 * The catalogue's buildings with a front for a shop, measured from their
 * builders (tools/map-assets/build_modern.py, build_modern2.py,
 * build_city.py). Any other building of building-tags.ts has HOUSE's
 * ground floor; NO_FRONT ones none
 */
const FACADE_MODELS: Readonly<Record<string, FacadeModel>> = {
  // City houses: the board on the shop floor's fascia (from 4.1 m, 0.12 m out of the wall)
  'block-row-4': { ground: 4.65, board: [4.08, 0.5], proud: 0.14, shopFloor: true },
  'block-row-6': { ground: 4.65, board: [4.08, 0.5], proud: 0.14, shopFloor: true },
  'block-corner-4': { ground: 4.65, board: [4.08, 0.5], proud: 0.14, shopFloor: true },
  'block-corner-6': { ground: 4.65, board: [4.08, 0.5], proud: 0.14, shopFloor: true },
  shop: { ground: 3.6, board: [3.62, 0.55], shopFloor: true },
  // The sign band of the small shop (3.2 to 4.0 m, 0.16 m out), of the shop under offices (3.93 to 4.67 m)
  'shop-small': { ground: 3.35, board: [3.3, 0.6], proud: 0.17, shopFloor: true, panel: true },
  'shop-office': { ground: 4.65, board: [4.02, 0.6], proud: 0.11, shopFloor: true, panel: true },
  'office-mid': { ground: 4.95, board: [4.3, 0.55], shopFloor: true },
  'office-high': { ground: 4.95, board: [4.3, 0.55], shopFloor: true },
  'office-ribbon': { ground: 5.25, board: [4.55, 0.6], shopFloor: true },
  'office-tower': { ground: 4.5, board: [3.9, 0.55], shopFloor: true },
  supermarket: { ground: 4.2, board: [3.5, 0.8], shopFloor: true },
  'hall-flat': { ground: 4.2, board: [3.5, 0.8], shopFloor: true },
  'apartment-block': { ground: 3.4, board: [3.5, 0.6] },
  'apartment-block-tall': { ground: 3.4, board: [3.5, 0.6] },
  'town-hall': { ground: 4.2, board: [4.3, 0.6] },
  station: { ground: 4.2, board: [4.3, 0.6] },
  school: { ground: 4.0, board: [4.1, 0.6] },
};

/** Buildings no shop shows on: garages, sheds, roofs, halls of work, glasshouses, the church, the kiosk */
const NO_FRONT = new Set([
  'garage', 'garage-row', 'garden-shed', 'carport', 'carport-double', 'station-canopy', 'greenhouse', 'transformer-station',
  'parking-garage', 'industrial-hall', 'warehouse', 'barn', 'barn-modern', 'outbuilding', 'shelter-lean-to', 'town-church', 'chapel',
  // The kiosk shows what it is with its hatch, awning and menu board
  'kiosk',
]);

/** Whether a building model has a front for a shop */
export function hasFront(asset: string): boolean {
  return !NO_FRONT.has(asset);
}

/**
 * The fronts of building object `o` (a catalogue model of building-tags.ts),
 * none for one without (NO_FRONT)
 */
export function facadesOf(o: Pick<MapObject, 'id' | 'asset' | 'x' | 'y' | 'rotation' | 'scale'>, model: BuildingModel): FacadeAnchor[] {
  if (!hasFront(o.asset)) return [];
  const m = FACADE_MODELS[o.asset] ?? HOUSE;
  const s = o.scale || 1;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  const [ax, az] = model.at ?? [0, 0];
  const hw = model.box[0] / 2;
  const hd = model.box[1] / 2;
  // Model (x, z) to the map, as object-ground.ts groundRing turns it
  const toMap = (lx: number, lz: number) => ({ x: o.x - (lx * cos + lz * sin) * s, y: o.y + (-lx * sin + lz * cos) * s });
  const out: FacadeAnchor[] = [];
  const add = (side: 0 | 1 | 3, lx: number, lz: number, nlx: number, nlz: number, width: number) => {
    const p = toMap(lx, lz);
    out.push({
      x: p.x,
      y: p.y,
      nx: -(nlx * cos + nlz * sin),
      ny: -nlx * sin + nlz * cos,
      width: width * s,
      ground: m.ground * s,
      boardZ: (side === 0 || !m.shopFloor ? m.board[0] : HOUSE.board[0]) * s,
      boardH: (side === 0 || !m.shopFloor ? m.board[1] : HOUSE.board[1]) * s,
      proud: (side === 0 ? (m.proud ?? PROUD) : PROUD) * s,
      shopFloor: !!m.shopFloor && side === 0,
      panel: !!m.panel && side === 0,
      object: o.id,
      side,
    });
  };
  add(0, ax, az + hd, 0, 1, model.box[0]);
  // A row's modules have blank sides; a corner house shows its west side to the side street
  if (!model.module) {
    add(3, ax - hw, az, -1, 0, model.box[1]);
    if (!model.corner) add(1, ax + hw, az, 1, 0, model.box[1]);
  }
  return out;
}

/** The mass shader's plinth and first floor's sill over a storey's floor, per facade (mass-layer.ts WALL_COLOR_FRAGMENT) */
const MASS_FACADE: Readonly<Record<MapMassFacade, { plinth: number; sill: number }>> = {
  plaster: { plinth: 0.45, sill: 0.9 },
  concrete: { plinth: 0.6, sill: 0.85 },
  metal: { plinth: 1.0, sill: 0.0 },
  brick: { plinth: 0.5, sill: 0.85 },
  stone: { plinth: 0.6, sill: 1.1 },
};
/** Edges of a raised building shorter than this (m) carry no shop */
const MASS_FRONT_MIN = 3;

/**
 * The fronts of a building raised from its footprint (`o.mass`): each edge of
 * its outline at least MASS_FRONT_MIN long, facing out; the ground floor's
 * top and the board under the first floor's windows from the storeys the
 * mass shader lays out (a hall's single high storey: the board at 3 m)
 */
export function massFacades(o: Pick<MapObject, 'id' | 'x' | 'y' | 'rotation' | 'scale'>, m: MapMass): FacadeAnchor[] {
  const s = o.scale || 1;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  const look = MASS_FACADE[m.facade] ?? MASS_FACADE.plaster;
  const band = m.roof === 'flat' ? MASS_PARAPET + 0.25 : 0.3;
  const storey = Math.max(0.5, m.height - look.plinth - band) / Math.max(1, m.floors);
  const hall = storey >= 4.6;
  const ground = hall ? Math.min(m.height, 4.0) : look.plinth + storey;
  const boardZ = hall ? 3.0 : ground + 0.08;
  const boardH = hall ? 0.8 : Math.max(0.3, Math.min(0.7, look.sill - 0.22));
  // Object axes to the map: toModel (object-ground.ts) is its own inverse
  const toMap = (x: number, z: number) => ({ x: o.x + (-x * cos - z * sin) * s, y: o.y + (-x * sin + z * cos) * s });
  const out: FacadeAnchor[] = [];
  const r = m.rings[0];
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const x0 = r[j];
    const z0 = r[j + 1];
    const dx = r[i] - x0;
    const dz = r[i + 1] - z0;
    const length = Math.hypot(dx, dz);
    if (length * s < MASS_FRONT_MIN) continue;
    let nx = dz / length;
    let nz = -dx / length;
    const mx = x0 + dx / 2;
    const mz = z0 + dz / 2;
    if (massContains(m, mx + nx * 0.05, mz + nz * 0.05)) {
      nx = -nx;
      nz = -nz;
    }
    const p = toMap(mx, mz);
    out.push({
      x: p.x,
      y: p.y,
      nx: -nx * cos - nz * sin,
      ny: -nx * sin + nz * cos,
      width: length * s,
      ground: ground * s,
      boardZ: boardZ * s,
      boardH: boardH * s,
      proud: 0.03 * s,
      shopFloor: false,
      panel: false,
      object: o.id,
      side: 0,
    });
  }
  return out;
}

/** Distance from point `p` to the foot of front `f` (a segment along the wall) */
export function facadeDistance(f: FacadeAnchor, p: { x: number; y: number }): number {
  const tx = -f.ny;
  const ty = f.nx;
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  const along = Math.max(-f.width / 2, Math.min(f.width / 2, dx * tx + dy * ty));
  return Math.hypot(dx - tx * along, dy - ty * along);
}

/** The turn of a facade object (its front, model +z, out of the wall) on front `f` */
export function facadeTurn(f: FacadeAnchor): number {
  const r = Math.atan2(-f.nx, f.ny);
  return r < 0 ? r + Math.PI * 2 : r;
}
