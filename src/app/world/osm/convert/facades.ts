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
 * footprint (MapObject.mass): their walls as object-mass.ts massFronts gives
 * them.
 */
import { massFronts } from '../../custom-map/object-mass';
import type { MapObject } from '../../custom-map/map-document';
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
  /** A raised building's wall: its index in the outline (MapMass.shop) */
  edge?: number;
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

/** Edges of a raised building shorter than this (m) carry no shop */
const MASS_FRONT_MIN = 3;

/**
 * The fronts of a building raised from its footprint: its walls as
 * massFronts (object-mass.ts) gives them, MASS_FRONT_MIN long or more. The
 * board goes on the wall between the ground floor and the first floor's
 * sills; where they leave no room (a hall, one storey under a low cornice),
 * over the ground floor's top. A wall in `mass.shop` has shop windows of
 * its own (the mass shader's)
 */
export function massFacades(o: MapObject): FacadeAnchor[] {
  const shop = new Set(o.mass?.shop ?? []);
  return massFronts(o, MASS_FRONT_MIN).map((f) => {
    const room = f.sill - f.ground - 0.25;
    const roomy = room >= 0.35;
    return {
      x: f.x,
      y: f.y,
      nx: f.nx,
      ny: f.ny,
      width: f.width,
      ground: f.ground,
      boardZ: roomy ? f.ground + 0.08 : f.ground - 0.7,
      boardH: roomy ? Math.min(0.7, room) : 0.6,
      // Cornice and parapet are flat in the shader: nothing stands out of the wall
      proud: 0.02,
      shopFloor: shop.has(f.edge),
      panel: false,
      object: o.id,
      side: 0,
      edge: f.edge,
    };
  });
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
