/**
 * The shapes the buildings of an OSM world pass between their parts
 * (buildings.ts, building-models.ts, building-ground.ts,
 * building-indexes.ts): the catalogue entry as they read it, the report,
 * a footprint, a door and a model's placement.
 */
import type { CostEntry } from '../../custom-map/render/objects/scene-cost';
import type { GroundBox } from '../../custom-map/object-ground';
import type { CatalogDoor } from '../../custom-map/render/asset-catalog';
import type { BuildingKind, BuildingModel, LandmarkRole } from '../building-tags';
import type { FootprintDrop } from '../../custom-map/map-footprints';
import type { OpeningReport } from './building-openings';
import type { MapMass, MapPoint } from '../../custom-map/map-document';

/** A catalogue entry as far as the buildings read it */
export type BuildingCatalogEntry = CostEntry & { id: string; footprint: number; box?: GroundBox; doors?: readonly CatalogDoor[] };

export interface BuildingReport {
  /** Footprints read (building areas on the ground) */
  footprints: number;
  /** Footprints that stand with at least one model, and the models placed */
  placed: number;
  objects: number;
  /** Buildings standing with a door, and of them those whose door is at the entrance OSM maps */
  doors: number;
  entrances: number;
  /** Footprints cut into several rectangles, and laid as rows of more than one model */
  split: number;
  /** Footprints raised from their own outline (no model covers them well enough, building-mass.ts) */
  masses: number;
  /** Of those, the ones raised as their OSM parts (`building:part`), and the parts (with the ones filling what they leave) */
  withParts: number;
  parts: number;
  /** Row modules at the end of their row, with windows in the gable no house abuts */
  rowEnds: number;
  /** Footprints in the old town, by why (old-town.ts): their own tags, an old-town area, inside the town wall, built densely */
  oldTown: { tags: number; area: number; wall: number; dense: number };
  rows: number;
  /** Footprints by kind */
  kinds: Partial<Record<BuildingKind, number>>;
  /** Landmarks by role (building-tags.ts landmarkRole), and the footprints built as ruins (`damage` 3 from the start) */
  landmarks: Partial<Record<LandmarkRole, number>>;
  ruins: number;
  /** Footprints (some part of them) that took another kind's models ("garage>carport"), or none ("shed>none") */
  fallbacks: Record<string, number>;
  /** Footprints left out and why */
  dropped: Record<FootprintDrop, number>;
  /** Models shrunk off a road */
  shrunk: number;
  /** Pads cut into the slope, the deepest cut (m), retaining walls */
  pads: number;
  deepestCutM: number;
  retainingWalls: number;
  /** Buildings lifted over a cellar open to the slope (MapObject.cellar), the deepest drop (m) */
  basements: number;
  deepestBasementM: number;
  /** Scene points the buildings spend, and of the scene budget */
  cost: number;
  costShare: number;
  /**
   * What the catalogue lacks, most first: a kind with the size class of the
   * rectangles (whole footprints or their parts) none of its models fitted
   * (`house 10x4`), and how many
   */
  missing: { kind: string; count: number }[];
  /** How well the built follows the footprints from COVER_FROM m² (FootprintCover), each left out as none */
  coverage: CoverageReport;
  /** Openings cut where covered ways run through raised buildings (building-openings.ts), and the stretches left closed */
  openings: OpeningReport;
}

/**
 * How well the built follows OSM's footprints (docs/OSM_LANDMARKS_PLAN.md,
 * "Abdeckung"): per outer ring of COVER_FROM m² or more, the share of it
 * (less its courtyards) under the models' wall boxes or the raised
 * building's outline, and the share of its area the models' boxes stand
 * outside it. A footprint left out covers nothing
 */
export interface CoverageReport {
  footprints: number;
  /** Median of the covered shares (0 to 1) */
  median: number;
  /** Share of the footprints covered less than 70 % */
  below70: number;
  /** Share of the footprints whose models stand more than 10 % of its area outside it */
  overhang10: number;
}

/** A building's door: the middle of its foot on the wall (map metres) and the way out of it (unit) */
export interface BuildingDoor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** One model to place */
export interface Placement {
  asset: string;
  /** Middle of its scaled wall box, its front (unit, outward) and the box's half sides */
  p: MapPoint;
  front: MapPoint;
  hw: number;
  hd: number;
  scale: number;
  /** Turn of the model (front at local +z) */
  rotation: number;
  /** The side its door is in, where that is not its front (a model turned to show it to the street, frontFor) */
  doorFace?: MapPoint;
  model: BuildingModel;
  /** A building raised from the footprint (asset MASS_ASSET) instead of a model */
  mass?: MapMass;
}

export interface Footprint {
  id: number;
  /** Its outer ring in `features` */
  ring: readonly MapPoint[];
  kind: BuildingKind;
  area: number;
  centre: MapPoint;
  placements: Placement[];
  cost: number;
  /** The tint of its models, null for none */
  tint: string | null;
  /** A ruin in OSM: it starts the run fallen (MapObject.damage 3, the ruins of destroyed buildings) */
  ruin: boolean;
  /** The entrance OSM maps on its outline (EntranceIndex), null for none */
  entrance: MapPoint | null;
}
