/**
 * Footprints no catalogue model covers raised as they are (docs/OSM_WORLD_PLAN.md,
 * "Gebäude aus dem Grundriss"): the outline and its courtyards, simplified,
 * as the rings of a MapMass in the object's own axes; its height from
 * `height` or `building:levels`, else guessed from the kind and the size;
 * its roof from `roof:shape`, `roof:height`, `roof:angle`, `roof:direction`
 * and `roof:orientation`, else by kind, sloped over the real outline
 * (custom-map/mass-roof.ts: gable, hip, half-hip, mansard, skillion per
 * wing, docs/OSM_LANDMARKS_PLAN.md L4); its walls from `building:material`, else
 * by kind; its tint from `building:colour`, else one of its facade's.
 *
 * A footprint with parts (`building:part` inside it, Simple 3D Buildings;
 * docs/OSM_LANDMARKS_PLAN.md L3) is raised as its parts: each its own
 * outline in the building's frame, from `min_height` (or
 * `building:min_level`) to `height` (or `building:levels`), its own roof
 * from `roof:shape` and `roof:height`, its own walls and colours from
 * `building:material`, `building:colour`, `roof:colour`, `roof:material`;
 * the footprint gives the kind, the facade and the tint where a part has
 * none, and where the parts leave much of it bare a part of its own fills it.
 */
import type { MapMass, MapMassCover, MapMassPart, MapMassRoof, MapPoint } from '../../custom-map/map-document';
import {
  MASS_PARAPET,
} from '../../custom-map/object-mass';
import { toModel } from '../../custom-map/object-ground';
import { buildingLevels, type BuildingKind } from '../building-tags';
import { round2 } from './geom';
import { LANDMARK_KINDS, massFacade, massLevels, massTint, MATERIALS, metres, mostOf, PLINTH, roofLook, storeyOf, tagColour } from './building-look';
import { LANDMARK_RIDGE_MOST, type MassRect, RIDGE_MOST, ROOF_SHARE, roofFit, roofOf, simplifiedRings, steepleOf, TOWER_RIDGE_MOST } from './building-roof';
import { isDrawnPart, type OsmPart, partsMass } from './building-parts';
/** A footprint under TOWER_AREA m² whose walls stand TOWER_SLENDER times as high as the root of its area is a tower */
const TOWER_AREA = 400;
const TOWER_SLENDER = 2.2;

/** One raised building: its mass in the object's own axes, the object's place and turn, its tint */
interface RaisedMass {
  mass: MapMass;
  /** The object's middle (its rectangle's) and turn; the front (model +z) and the half sides of its rectangle */
  centre: MapPoint;
  rotation: number;
  front: MapPoint;
  hw: number;
  hd: number;
  tint: string | null;
}

/**
 * The footprint (`outer` with its courtyards `holes`, in map space) raised
 * as a building of `kind`, laid in its rectangle's axes; with `parts`
 * (building:part in it, isDrawnPart) raised as those; null when nothing
 * is left of it after simplifying
 */
export function raiseMass(
  outer: readonly MapPoint[],
  holes: readonly (readonly MapPoint[])[],
  rect: MassRect,
  kind: BuildingKind,
  tags: Readonly<Record<string, string>>,
  area: number,
  salt: number,
  oldTown = false,
  parts: readonly OsmPart[] = [],
): RaisedMass | null {
  // Model +x along the rectangle's side a (its axis u turned back), +z a quarter turn left of it in the map
  const front = { x: -rect.u.y, y: rect.u.x };
  const rotation = Math.atan2(-front.x, front.y);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const local = (ring: readonly MapPoint[]): number[] => {
    const out: number[] = [];
    for (const p of ring) {
      const m = toModel(p.x - rect.c.x, p.y - rect.c.y, cos, sin);
      out.push(round2(m.x), round2(m.z));
    }
    return out;
  };
  const levels = massLevels(tags, kind, area);
  // A tower (tagged one, or much higher than wide: a town hall's or a gate's): stone, storeys of its own, a steep pyramid
  const tower = kind === 'tower' || (area < TOWER_AREA && levels.height > TOWER_SLENDER * Math.sqrt(area));
  if (tower) levels.floors = Math.max(levels.floors, Math.round(levels.height / 4));
  const facade = tower && !MATERIALS[tags['building:material'] ?? ''] ? 'stone' : massFacade(tags, kind, oldTown);
  const tint = massTint(tags, facade, salt, tower || LANDMARK_KINDS.has(kind) ? kind : null);
  const roofColour = roofLook(tags);
  const placed = { centre: rect.c, rotation, front, hw: rect.a / 2, hd: rect.b / 2, tint };
  const drawn = parts.filter((p) => isDrawnPart(p.tags));
  if (drawn.length) {
    const mass = partsMass(outer, holes, local, rotation, drawn, kind, tags, area, levels, facade, roofColour);
    if (!mass) return null;
    // Untagged, the building takes the colours most of its parts have: the parts without (a stair tower) match them
    const ownTint = tagColour(tags['building:colour'], facade === 'stone') ?? mostOf(mass.parts!.map((p) => p.tint));
    if (ownTint) {
      placed.tint = ownTint;
      for (const p of mass.parts!) if (p.tint === ownTint) delete p.tint;
    }
    if (!mass.roofTint && !mass.roofCover) {
      const look = mostOf(mass.parts!.map((p) => (p.roofTint || p.roofCover ? `${p.roofTint ?? ''}|${p.roofCover ?? ''}` : undefined)));
      if (look) {
        const [roofTint, roofCover] = look.split('|');
        if (roofTint) mass.roofTint = roofTint;
        if (roofCover) mass.roofCover = roofCover as MapMassCover;
      }
    }
    for (const p of mass.parts!) {
      if (p.roofTint === mass.roofTint && p.roofCover === mass.roofCover) {
        delete p.roofTint;
        delete p.roofCover;
      }
    }
    return { mass, ...placed };
  }
  // The real outline under the roof its tags ask for, else its kind's (deterministic by the footprint's salt)
  const rings = simplifiedRings(outer, holes, local, 0);
  if (!rings.length) return null;
  const wanted = roofOf(tags, kind, tower, oldTown, salt, area);
  const tagged = metres(tags, 'roof:height');
  const most = tower ? TOWER_RIDGE_MOST : LANDMARK_KINDS.has(kind) || kind === 'church' ? LANDMARK_RIDGE_MOST : RIDGE_MOST;
  // A tagged height without the roof's: the roof is part of it, the walls the rest
  const tallTag = metres(tags, 'height');
  const within = tallTag !== null && tagged === null ? tallTag * ROOF_SHARE : Infinity;
  const fit = wanted.roof === 'flat' ? null : roofFit(rings, wanted.roof, wanted.pitch, tagged, Math.min(most, within), tags, rotation, salt, rect);
  const roof: MapMassRoof = fit?.roof ?? 'flat';
  if (fit && tallTag !== null && tagged === null) {
    levels.height = Math.max(2.2, tallTag - fit.ridge);
    if (buildingLevels(tags) === null) levels.floors = Math.max(1, Math.round((levels.height - PLINTH) / storeyOf(kind)));
  }
  // A sloped roof's walls stop at the eaves; a flat one's go on to the parapet
  const height = round2(roof === 'flat' ? levels.height + MASS_PARAPET : levels.height);
  const steeple = kind === 'church' ? steepleOf(outer, holes, rect, area, tags, local, levels.height) : null;
  if (steeple) {
    const nave: MapMassPart = { rings, height, floors: levels.floors, roof, ...(fit ? fit.fields : {}) };
    const parts = [nave, steeple];
    return { mass: { rings, height: round2(Math.max(height, steeple.height)), floors: levels.floors, roof: 'flat', facade, ...roofColour, parts }, ...placed };
  }
  return {
    mass: { rings, height, floors: levels.floors, roof, ...(fit ? fit.fields : {}), facade, ...(roof !== 'flat' ? roofColour : {}) },
    ...placed,
  };
}

