import type { BuildingFootprint, StreetNetwork } from '../../services/location/osm-street.service';
import { TD_THEME } from '../../styles/td-theme';
import { MinimapFrame, type MinimapArea } from './minimap-frame';

/**
 * What a real place gives the minimap (TODO E142): the streets loaded for it
 * and the building footprints near its routes, as far as they are there.
 */
export interface OsmMinimapSource {
  streets(): StreetNetwork | null;
  buildings(): readonly BuildingFootprint[] | null;
}

/**
 * How a real place is drawn: `plain` stylised (dark ground, lines), `map`
 * closer to a street map (lighter ground, roads as wide as they are, with an
 * edge).
 */
export type OsmMinimapLook = 'plain' | 'map';

/** Road widths in the map look, m, and the thinnest they get, CSS px */
const MAIN_ROAD_M = 12;
const MINOR_ROAD_M = 7;
const MIN_ROAD_PX = 1;

/** Share of the span added around HQ, spawns and routes on each side */
const MARGIN_SHARE = 0.12;
/** The smallest edge of the area, m: a place with its spawns close by still shows its block */
const MIN_EDGE_M = 400;

/** Streets that read as main roads: a wider, lighter line */
const MAIN_STREETS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link']);
/** Ways that are no street for the eye: left out */
const SKIPPED_STREETS = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'corridor', 'elevator', 'platform']);

/**
 * The square around `points` (scene x/z: HQ, spawns, the routes' points) with
 * a margin, at least MIN_EDGE_M a side, north up and east right: `top` is
 * the north edge, `right` the east edge. `northIsNegativeZ` tells which way
 * the scene's z runs; x follows from it (the scene is right-handed, y up):
 * with north at -z east is +x, with north at +z east is -x.
 */
export function osmArea(points: readonly { x: number; z: number }[], northIsNegativeZ: boolean): MinimapArea | null {
  if (points.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  const half = Math.max(span * (0.5 + MARGIN_SHARE), MIN_EDGE_M / 2);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return northIsNegativeZ
    ? { left: cx - half, right: cx + half, top: cz - half, bottom: cz + half }
    : { left: cx + half, right: cx - half, top: cz + half, bottom: cz - half };
}

/**
 * The place from above: buildings as areas, streets as lines (main roads
 * wider). `plain` is stylised as on a custom map; `map` has a lighter ground,
 * edged buildings and roads at their width with a dark edge. `toScene` turns
 * a point into scene x/z. Drawn once per place, streets and buildings.
 */
export function drawOsmPicture(
  c: CanvasRenderingContext2D,
  frame: MinimapFrame,
  toScene: (lat: number, lon: number) => { x: number; z: number },
  streets: StreetNetwork | null,
  buildings: readonly BuildingFootprint[] | null,
  scale: number,
  look: OsmMinimapLook = 'plain',
): void {
  const map = look === 'map';
  c.fillStyle = map ? TD_THEME.mapGround : TD_THEME.bgDark;
  c.fillRect(frame.x, frame.y, frame.w, frame.h);

  if (buildings && buildings.length > 0) {
    c.fillStyle = map ? TD_THEME.mapBuilding : TD_THEME.stoneLit;
    c.beginPath();
    for (const building of buildings) {
      building.nodes.forEach((node, k) => {
        const p = toScene(node.lat, node.lon);
        if (k) c.lineTo(frame.u(p.x), frame.v(p.z));
        else c.moveTo(frame.u(p.x), frame.v(p.z));
      });
      c.closePath();
    }
    c.fill();
    if (map) {
      c.strokeStyle = TD_THEME.mapBuildingEdge;
      c.lineWidth = 0.75 * scale;
      c.stroke();
    }
  }

  if (!streets) return;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const path = (main: boolean): void => {
    c.beginPath();
    for (const street of streets.streets) {
      if (SKIPPED_STREETS.has(street.type) || MAIN_STREETS.has(street.type) !== main) continue;
      street.nodes.forEach((node, k) => {
        const p = toScene(node.lat, node.lon);
        if (k) c.lineTo(frame.u(p.x), frame.v(p.z));
        else c.moveTo(frame.u(p.x), frame.v(p.z));
      });
    }
  };
  if (!map) {
    for (const main of [false, true]) {
      c.strokeStyle = main ? TD_THEME.frameLight : TD_THEME.frameMid;
      c.lineWidth = (main ? 1.6 : 0.9) * scale;
      path(main);
      c.stroke();
    }
    return;
  }
  // Canvas pixels per metre
  const perM = frame.w / Math.max(Math.abs(frame.area.right - frame.area.left), 1e-6);
  const width = (main: boolean): number => Math.max((main ? MAIN_ROAD_M : MINOR_ROAD_M) * perM, MIN_ROAD_PX * scale);
  // Edges first, all of them, so a crossing reads as one road
  c.strokeStyle = TD_THEME.mapRoadCasing;
  for (const main of [false, true]) {
    c.lineWidth = width(main) + 1.5 * scale;
    path(main);
    c.stroke();
  }
  for (const main of [false, true]) {
    c.strokeStyle = main ? TD_THEME.mapRoad : TD_THEME.mapRoadMinor;
    c.lineWidth = width(main);
    path(main);
    c.stroke();
  }
}
