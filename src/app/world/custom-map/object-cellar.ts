import type { MapObject } from './map-document';
import { seedOf } from '../../utils/seeded-random';

/**
 * A building's cellar (docs/CUSTOM_MAPS.md "Keller"): storeys under its
 * floor, part of the house as its walls are. The house stands with its floor
 * at its origin (lifted by MapObject.z over its seat where the hill falls
 * away under it); its cellar reaches `storeys` storeys of CELLAR_STOREY and
 * the footing under them down from there. The renderer carries the house's
 * foot on down that far (cellar-shell.ts for a catalogue model, the walls of
 * a raised building in mass-layer.ts), the ground hides what lies in it; the
 * ruins show its floors and its pit (ruin-slabs.ts), and a hit on its wall
 * holes it (StructureLedger.punch, RunStructure.cellar).
 *
 * - `auto`: what the slope leaves open shows, with cellar windows and a door
 *   in the house's window raster where the wall stands free of the ground
 * - `buried`: wholly in the ground (the house's floor at its lowest ground):
 *   no openings; seen only when a hit opens it
 * - `none`: no cellar: the house's own foundation, no floors under its floor
 */
export const MAP_CELLAR_MODES = ['auto', 'buried', 'none'] as const;
export type MapCellarMode = (typeof MAP_CELLAR_MODES)[number];

export interface MapCellar {
  mode: MapCellarMode;
  /** Storeys under the floor, 1 to MAX_CELLAR_STOREYS; its depth follows (cellarDepth) */
  storeys: number;
}

/** A cellar storey, floor to floor, m */
export const CELLAR_STOREY = 2.8;
/** Under the lowest cellar floor: its slab and footing, m */
export const CELLAR_FOOTING = 0.3;
export const MAX_CELLAR_STOREYS = 3;
/** A building's cellar where its map gives none */
export const DEFAULT_CELLAR: Readonly<MapCellar> = { mode: 'auto', storeys: 1 };

/** Whether an asset's objects have cellars: a building on the ground, not one that floats (a ship) */
export function takesCellar(asset: { readonly category: string; readonly float?: boolean } | null | undefined): boolean {
  return !!asset && asset.category === 'building' && !asset.float;
}

/** The cellar of an object that is a building (its catalogue category, or raised from its footprint); null for none */
export function cellarOf(o: Pick<MapObject, 'cellar'>, building: boolean): Readonly<MapCellar> | null {
  if (!building) return null;
  const c = o.cellar ?? DEFAULT_CELLAR;
  return c.mode === 'none' ? null : c;
}

/** Metres from the floor down to the cellar's foot: its storeys and the footing */
export function cellarDepth(c: Readonly<MapCellar> | null): number {
  return c ? c.storeys * CELLAR_STOREY + CELLAR_FOOTING : 0;
}

/**
 * The cellar of a house whose floor stands `drop` m over its lowest ground:
 * buried where the drop is less than a cellar window needs, else open with
 * as many storeys as reach down to the ground there
 */
export function cellarForDrop(drop: number): MapCellar {
  if (drop < CELLAR_OPEN_FROM) return { mode: 'buried', storeys: 1 };
  return { mode: 'auto', storeys: Math.min(MAX_CELLAR_STOREYS, Math.max(1, Math.ceil((drop - CELLAR_FOOTING) / CELLAR_STOREY - 1e-9))) };
}

/** A whole building's cellar walls reach this far under the lowest ground under it, m: past its seat's edge */
export const CELLAR_EXPOSED_MARGIN = 0.6;

/**
 * Metres down its walls are drawn: a whole building's as far as the slope
 * leaves them open (its `z` over its seat, the lowest ground under it, and
 * CELLAR_EXPOSED_MARGIN), not on through the ground where nothing sees them
 * and every pixel would be shaded for nothing; a ruin's to the cellar's
 * foot, open to its holes and its pit
 */
export function cellarDrawnDepth(c: Readonly<MapCellar> | null, z: number, ruin: boolean): number {
  const depth = cellarDepth(c);
  return ruin ? depth : Math.min(depth, Math.max(0, z) + CELLAR_EXPOSED_MARGIN);
}

/** A ruin's frame's cellar (RuinFrame.cellar, cellarStoreys): none without one */
export function cellarFrame(c: Readonly<MapCellar> | null): { cellar?: number; cellarStoreys?: number } {
  return c ? { cellar: cellarDepth(c), cellarStoreys: c.storeys } : {};
}

/** Share of the houses whose exposed cellar is of their plinth's surface; the others' wears the wall over it */
export const CELLAR_PLINTH_SHARE = 0.2;

/**
 * Whether house `id`'s cellar shows its plinth's surface all the way down (one in five, by its id), else its
 * wall's, with the plinth at the foot of the slope (cellar-shell.ts WALL_BASE)
 */
export function cellarPlinthDown(id: string): boolean {
  return (seedOf(id) % 1000) / 1000 < CELLAR_PLINTH_SHARE;
}

/** A floor this much over the lowest ground opens its cellar to the slope (cellarForDrop), m */
export const CELLAR_OPEN_FROM = 0.6;

/** Whether `v` is a cellar a map may hold (map-repair.ts) */
export function isMapCellar(v: unknown): v is MapCellar {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const { mode, storeys } = v as Record<string, unknown>;
  return (MAP_CELLAR_MODES as readonly unknown[]).includes(mode) && Number.isInteger(storeys) && (storeys as number) >= 1 && (storeys as number) <= MAX_CELLAR_STOREYS;
}
