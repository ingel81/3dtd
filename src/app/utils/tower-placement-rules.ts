import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { findNearestRouteDistance } from './geo-utils';
import type { FootprintRefusal, TowerFootprint } from './tower-footprint';

interface LatLon {
  lat: number;
  lon: number;
}

export interface TowerPlacementResult {
  valid: boolean;
  /** UI-Text (englisch) für ungültige Positionen, landet im Build-Mode-Hint */
  reason?: string;
}

/**
 * Alles, was die Platzierungsregeln über die aktuelle Welt wissen müssen.
 * Der TowerPlacementService baut den Kontext aus seinem Zustand zusammen.
 */
export interface TowerPlacementContext {
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  base: LatLon;
  spawns: readonly LatLon[];
  towers: readonly { position: LatLon }[];
  /** Aktive Gegnerrouten. Leer vor Spielstart, dann entfällt die Routenregel. */
  routes: LatLon[][];
  /** Distanz in Metern, liefert der Street-Provider (OSM oder DevWorld) */
  geo: { haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number };
}

/** UI-Text je FootprintRefusal: warum der Grund unter der Grundfläche den Platz ausschließt */
const FOOTPRINT_REASONS: Record<FootprintRefusal, string> = {
  wall: 'Not enough room',
  edge: 'Too far over the edge',
};

/**
 * Platzierungsregeln für Tower, gemeinsam für Maus-Vorschau, Klick und Bot.
 * Reihenfolge: Spielbereich, HQ, Spawns, andere Tower, Routen, dann der
 * Grund unter der Grundfläche, sofern `footprint` mitkommt. Die erste
 * verletzte Regel liefert den Grund.
 *
 * Ein Gebäude ist kein Hindernis: der Service hebt den Tower auf Dachhöhe,
 * er steht dann auf dem Dach. Ausgeschlossen ist ein Platz, dessen Mitte
 * oder innerer Ring der Grundfläche in einer Wand steht oder über einem
 * Abbruch hängt (`footprint.refusal`, FootprintRefusal).
 */
export function checkTowerPlacement(
  lat: number,
  lon: number,
  ctx: TowerPlacementContext,
  footprint?: TowerFootprint,
): TowerPlacementResult {
  const { bounds, geo } = ctx;
  const inBounds = lat >= bounds.minLat && lat <= bounds.maxLat &&
                   lon >= bounds.minLon && lon <= bounds.maxLon;
  if (!inBounds) {
    return { valid: false, reason: 'Outside play area' };
  }

  if (geo.haversineDistance(lat, lon, ctx.base.lat, ctx.base.lon) < PLACEMENT_CONFIG.MIN_DISTANCE_TO_BASE) {
    return { valid: false, reason: 'Too close to HQ' };
  }

  for (const spawn of ctx.spawns) {
    if (geo.haversineDistance(lat, lon, spawn.lat, spawn.lon) < PLACEMENT_CONFIG.MIN_DISTANCE_TO_SPAWN) {
      return { valid: false, reason: 'Too close to spawn' };
    }
  }

  for (const tower of ctx.towers) {
    const distToTower = geo.haversineDistance(lat, lon, tower.position.lat, tower.position.lon);
    if (distToTower < PLACEMENT_CONFIG.MIN_DISTANCE_TO_OTHER_TOWER) {
      return { valid: false, reason: 'Too close to another tower' };
    }
  }

  if (ctx.routes.length > 0) {
    const routeDistance = findNearestRouteDistance(ctx.routes, lat, lon);
    if (routeDistance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE) {
      return { valid: false, reason: 'Too close to route' };
    }
  }

  if (footprint?.refusal) {
    return { valid: false, reason: FOOTPRINT_REASONS[footprint.refusal] };
  }

  return { valid: true };
}
