import type { ThreeTilesEngine } from '../../three-engine';
import type { RouteWaypoint } from '../../models/game.types';
import type { Street } from '../location/osm-street.service';
import type { StreetEdgeIndex } from '../../utils/route-ways';
import type { GeoDistance } from '../../utils/route-geometry';
import { estimateStreetWidth, segmentLeft, segmentRight } from '../../utils/route-corridor';
import { StreetSurface, nearestApproach, routeApproaches } from '../../utils/carried-height';
import type { GlobalRouteGridService } from './global-route-grid.service';

/** Smallest and largest value seen so far, as `5.0` or `5.0-12.0`, for the diagnostics table. */
class Span {
  private min = Infinity;
  private max = -Infinity;

  add(value: number): string {
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    return this.min === this.max ? this.min.toFixed(1) : `${this.min.toFixed(1)}-${this.max.toFixed(1)}`;
  }
}

/** `width=5 tunnel=building_passage` etc., for the diagnostics tables. */
export function describeStreetTags(street: Street): string {
  const parts: string[] = [];
  for (const key of ['width', 'lanes', 'bridge', 'tunnel', 'covered', 'layer'] as const) {
    if (street[key] !== undefined) parts.push(`${key}=${street[key]}`);
  }
  return parts.join(' ');
}

/**
 * One row of `describeRoutes()`: a stretch of a route that runs over a
 * single OSM way (or off the network, `way === null`).
 */
export interface RouteWayRun {
  route: string;
  /** First and last waypoint index of the stretch */
  fromIndex: number;
  toIndex: number;
  way: number | null;
  type: string;
  name: string;
  /** width/lanes/bridge/tunnel/covered/layer, where the way has them */
  tags: string;
  /** Street width the corridor starts from, metres; null off the network */
  widthM: number | null;
  /**
   * Where `widthM` came from: the `width` or `lanes` tag, a typical value
   * for the `highway` class, or `inherited` off the network (the leg to the
   * HQ keeps the width of the street it leaves).
   */
  widthSource: string;
  /** Corridor width in use (left plus right half width), a range where it varies */
  corridorM: string;
  /** Half width left and right of the direction of travel, ranges likewise */
  leftM: string;
  rightM: string;
  lengthM: number;
  /**
   * Largest gap between the cell height (red line, enemy feet) and the
   * street overlay height (yellow line) along the centre line. Several
   * metres mean the cells sit on a roof or a canopy there. Null while the
   * grid or the tiles cannot answer yet.
   */
  maxCellAboveStreetM: number | null;
  /** lat,lon of that maximum */
  at: string;
}

/**
 * Zerlegt jede gecachte Route in die OSM-Ways, über die sie läuft, und
 * vergleicht entlang der Mittellinie (alle 2 m) die Zellhöhe mit der Höhe,
 * die das gelbe Straßen-Overlay an derselben Stelle nimmt
 * (`getStreetHeightEstimate`: seitliches Minimum, auf einem Brücken-Way das
 * Deck, auf der Strecke hinter seinem Ende und auf dem Endstück zum HQ die
 * Höhe, die die Route vom Brückenende oder von der Straße trägt; die Strecke
 * hier entlang der Route wie bei den Zellen, `routeApproaches`). Beantwortet
 * am Ort eines Routen-Befunds zwei Fragen: Läuft die Route dort über einen anderen Way
 * als die sichtbare Straße (Fußweg, Durchgang, Tunnel)? Und liegen die
 * Zellen dort auf Dach oder Baumkrone, während die Straße darunter liegt?
 * Dazu die Straßenbreite, ihre Quelle und die Korridorbreite, die daraus
 * geworden ist.
 *
 * Nur für Diagnose: ein Aufruf kostet pro Punkt bis zu fünf Säulen-Samples,
 * hinter einem Brückenende und auf dem Endstück dazu die Säulen entlang der
 * Route von deren Anfang.
 * Hinter `__routes.describe()` (PathAndRouteService.describeRoutes).
 *
 * @param paths Gecachte Routen je Spawn
 * @param index Straßen-Lookup des aktuellen Netzes
 * @param grid Zellhöhen; ohne initialisiertes Grid bleibt maxCellAboveStreetM null
 * @param geo Distanzfunktion des Pathfinding-Service
 */
export function describeRouteWays(
  paths: ReadonlyMap<string, RouteWaypoint[]>,
  index: StreetEdgeIndex,
  engine: ThreeTilesEngine,
  grid: Pick<GlobalRouteGridService, 'isInitialized' | 'getGroundLocalYAt'>,
  geo: GeoDistance,
): RouteWayRun[] {
  const cellsReady = grid.isInitialized();
  const rows: RouteWayRun[] = [];

  for (const [routeId, path] of paths) {
    const ways = index.match(path);
    const flags = path.slice(0, -1);
    const approaches = routeApproaches(
      path.map((p) => engine.sync.geoToLocalSimple(p.lat, p.lon, 0)),
      flags.map((p) => p.onBridge === true),
      flags.map((p) => p.inTunnel === true),
      flags.map((p) => p.offStreet !== true),
    );
    let run: RouteWayRun | null = null;
    let spans = { corridor: new Span(), left: new Span(), right: new Span() };

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const street = ways[i];
      const wayId = street?.id ?? null;

      if (!run || run.way !== wayId) {
        const estimate = street ? estimateStreetWidth(street) : null;
        run = {
          route: routeId,
          fromIndex: i,
          toIndex: i + 1,
          way: wayId,
          type: street?.type ?? '(off network)',
          name: street?.name ?? '',
          tags: street ? describeStreetTags(street) : '',
          widthM: estimate?.widthM ?? null,
          widthSource: estimate?.source ?? 'inherited',
          corridorM: '',
          leftM: '',
          rightM: '',
          lengthM: 0,
          maxCellAboveStreetM: null,
          at: '',
        };
        rows.push(run);
        spans = { corridor: new Span(), left: new Span(), right: new Span() };
      }
      run.toIndex = i + 1;

      const left = segmentLeft(a);
      const right = segmentRight(a);
      run.corridorM = spans.corridor.add(left + right);
      run.leftM = spans.left.add(left);
      run.rightM = spans.right.add(right);

      const length = geo.haversineDistance(a.lat, a.lon, b.lat, b.lon);
      run.lengthM += length;
      if (!cellsReady) continue;

      const steps = Math.max(1, Math.ceil(length / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const lat = a.lat + (b.lat - a.lat) * t;
        const lon = a.lon + (b.lon - a.lon) * t;
        const local = engine.sync.geoToLocalSimple(lat, lon, 0);
        const cellY = grid.getGroundLocalYAt(local.x, local.z);
        const approach = a.onBridge ? null : nearestApproach(approaches[i], t);
        const surface: StreetSurface | null = a.onBridge ? 'bridge' : approach
          ? { path: approach.path.map((k) => path[k]), m: approach.from + (approach.to - approach.from) * t, start: approach.start }
          : null;
        const streetY = engine.terrain.getStreetHeightEstimate(lat, lon, a.lat, a.lon, b.lat, b.lon, surface);
        if (cellY === null || streetY === null) continue;
        const gap = cellY - streetY;
        if (run.maxCellAboveStreetM === null || gap > run.maxCellAboveStreetM) {
          run.maxCellAboveStreetM = gap;
          run.at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
        }
      }
    }
  }

  for (const row of rows) {
    row.lengthM = Math.round(row.lengthM * 10) / 10;
    if (row.maxCellAboveStreetM !== null) {
      row.maxCellAboveStreetM = Math.round(row.maxCellAboveStreetM * 10) / 10;
    }
  }
  return rows;
}
