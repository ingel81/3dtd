/**
 * Scenes: the walkable band on real OSM routes (phase 2, utils/corridor-band.ts)
 *
 * The routes of the five fixtures in fixtures/osm, cut as
 * PathAndRouteService.buildRouteFromPath cuts them (StreetEdgeIndex,
 * UnderpassIndex, splitAtSpans, routeHalfWidths), the stretches off a bridge
 * end as the route grid finds them (deckApproaches). The ground: the playtest
 * cell reports where the fixture has them, synthetic on the real line
 * elsewhere, as each scene says. buildBand decides the band and the enemies'
 * line, bandPath turns it into route waypoints, the route grid claims and
 * samples their cells. Every scene runs twice with the same input and must
 * report the same. Expectations: tmp/fix1/reports/phase2-design.md, section 3.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { parseStreetTags } from '../services/location/osm-street.service';
import { BandColumn, BandColumns, BandRoute, BandStation, CorridorBand, bandPath, buildBand } from '../utils/corridor-band';
import { deckApproaches } from '../utils/deck-approach';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { CentreMode, corridorConfig, routeHalfWidths, runsUnderCover } from '../utils/route-corridor';
import { StreetEdgeIndex } from '../utils/route-ways';
import { UnderpassIndex, splitAtSpans } from '../utils/underpass';
import type { Street, StreetNode } from '../interfaces/street-network-provider.interface';
import type { RouteWaypoint } from '../models/game.types';
import type { ColumnSample } from '../three-engine/column-sample';

const CELL = 2;

/** How far the clearance rays reach where a scene says nothing else: the corridor's widest. */
const OPEN_WALL_M = corridorConfig.maxHalfWidth;

interface FixtureCell {
  x: number;
  z: number;
  heightM: number | null;
  topM?: number;
  cell?: false;
  what: string;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/** A fixture as fixtures/osm/README.md describes it, the fields the scenes read. */
interface Fixture {
  hq: { lat: number; lon: number };
  route: { wayIds: number[]; underWayIds: number[] };
  cells: FixtureCell[];
  routePoints: [number, number][];
  elements: OsmElement[];
}

const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join('src', 'app', 'integration', 'fixtures', 'osm', `${name}.json`), 'utf-8')) as Fixture;

interface Local {
  x: number;
  z: number;
}

/** The engine's local frame around the HQ, as EllipsoidSync.geoToLocalSimple: x = -east, z = +north. */
function frameOf(hq: { lat: number; lon: number }) {
  const kx = METERS_PER_DEGREE_LAT * Math.cos(hq.lat * DEG_TO_RAD);
  const toLocal = (p: { lat: number; lon: number }): Local => ({ x: -(p.lon - hq.lon) * kx, z: (p.lat - hq.lat) * METERS_PER_DEGREE_LAT });
  const toGeo = (x: number, z: number) => ({ lat: hq.lat + z / METERS_PER_DEGREE_LAT, lon: hq.lon - x / kx });
  const simple = (lat: number, lon: number, h: number) => {
    const p = toLocal({ lat, lon });
    return new Vector3(p.x, h, p.z);
  };
  const sync = {
    geoToLocal: simple,
    geoToLocalSimple: simple,
    geoToLocalSimpleInto: (lat: number, lon: number, h: number, out: Vector3) => {
      const p = toLocal({ lat, lon });
      return out.set(p.x, h, p.z);
    },
    localToGeo: (v: Vector3) => ({ ...toGeo(v.x, v.z), height: v.y }),
  };
  return { toLocal, toGeo, sync };
}

type Frame = ReturnType<typeof frameOf>;

/** The fixture's ways as OsmStreetService.parseOverpassResponse builds them. */
function streetsOf(fixture: Fixture): Street[] {
  const nodes = new Map<number, StreetNode>();
  for (const element of fixture.elements) {
    if (element.type === 'node') nodes.set(element.id, { id: element.id, lat: element.lat!, lon: element.lon! });
  }
  const streets: Street[] = [];
  for (const element of fixture.elements) {
    if (element.type !== 'way' || !element.nodes) continue;
    const wayNodes = element.nodes.map((id) => nodes.get(id)).filter((node): node is StreetNode => node !== undefined);
    if (wayNodes.length < 2) continue;
    streets.push({
      id: element.id,
      name: element.tags?.['name'] || 'Unnamed Street',
      type: element.tags?.['highway'] || 'unknown',
      nodes: wayNodes,
      ...parseStreetTags(element.tags),
    });
  }
  return streets;
}

/** Centre of the grid cell a local coordinate lies in. */
const centreOf = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;
const keyOf = (x: number, z: number) => `${centreOf(x)},${centreOf(z)}`;

/** Distance from (x, z) to the polyline `line`, metres. */
function distanceToLine(line: readonly Local[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const dx = line[i + 1].x - a.x;
    const dz = line[i + 1].z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return best;
}

/** Offset of (x, z) from the nearest segment of `line`, right of its direction positive. */
function offsetFrom(line: readonly Local[], x: number, z: number): number {
  let best = Infinity;
  let offset = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const dx = line[i + 1].x - a.x;
    const dz = line[i + 1].z - a.z;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (len * len)));
    const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
    if (d < best) {
      best = d;
      offset = ((x - a.x) * -dz + (z - a.z) * dx) / len;
    }
  }
  return offset;
}

/** Where the clearance rays of a station at (x, z) stop, metres from the line, on `side` of the direction of travel. */
type Walls = (x: number, z: number, side: 'left' | 'right') => number;

/** The route as the game cuts it, and per segment of the cut route what it runs on. */
interface Cut {
  route: BandRoute;
  ways: (Street | null)[];
  onBridge: boolean[];
  inTunnel: boolean[];
  /** On the stretch off a bridge end (deckApproaches). */
  approach: boolean[];
}

function cutRoute(fixture: Fixture, frame: Frame, walls: Walls): Cut {
  const streets = streetsOf(fixture);
  const geoPath = fixture.routePoints.map(([lat, lon]) => ({ lat, lon }));
  const matched = new StreetEdgeIndex(streets).match(geoPath);
  const open = matched.map((way) => way === null || (way.bridge === undefined && !runsUnderCover(way)));
  const spans = new UnderpassIndex(streets).spans(geoPath, matched, open);
  const split = splitAtSpans(geoPath, spans, open, (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }));
  const ways = split.segment.map((i) => matched[i]);
  const halfWidths = routeHalfWidths(ways);
  const onBridge = ways.map((way) => way?.bridge !== undefined);
  const inTunnel = ways.map((way, i) => split.under[i] !== null || (way !== null && runsUnderCover(way)));
  const points = split.points.map(frame.toLocal);
  const approach = deckApproaches(points, onBridge, inTunnel).map((stretches) => stretches.length > 0);
  // The band decides a street on the ground; not a bridge, a tunnel, the stretch off a bridge end or the leg to the HQ.
  const band = ways.map((way, i) => way !== null && !onBridge[i] && !inTunnel[i] && !approach[i]);
  const wallLeft: number[][] = [];
  const wallRight: number[][] = [];
  for (let i = 0; i < ways.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const n = length > 0 ? Math.max(1, Math.round(length / corridorConfig.stationSpacing)) : 0;
    // Where the band does not decide, the rays stop at the street's edge (a parapet, a tunnel wall).
    const side = (s: 'left' | 'right') => Array.from({ length: n }, (_, k) => {
      const t = (k + 0.5) / n;
      return band[i] ? walls(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, s) : halfWidths[i];
    });
    wallLeft.push(side('left'));
    wallRight.push(side('right'));
  }
  return { route: { points, open: band, streetHalfWidth: halfWidths, wallLeft, wallRight }, ways, onBridge, inTunnel, approach };
}

interface Run {
  cut: Cut;
  band: CorridorBand;
  waypoints: RouteWaypoint[];
  grid: GlobalRouteGrid;
}

/** Band, enemies' line and route cells of `fixture` over `columns`. */
function run(fixture: Fixture, columns: BandColumns, walls: Walls = () => OPEN_WALL_M, mode?: CentreMode): Run {
  const frame = frameOf(fixture.hq);
  const cut = cutRoute(fixture, frame, walls);
  const band = buildBand(cut.route, columns, CELL, mode);
  const path = bandPath(cut.route, band);
  const waypoints = path.map((p, i): RouteWaypoint => {
    const waypoint: RouteWaypoint = { ...frame.toGeo(p.x, p.z), height: 0 };
    if (i === path.length - 1) return waypoint;
    waypoint.corridorLeft = p.left;
    waypoint.corridorRight = p.right;
    if (cut.onBridge[p.segment]) waypoint.onBridge = true;
    if (cut.inTunnel[p.segment] || p.passage) waypoint.inTunnel = true;
    if (p.passage) waypoint.passage = true;
    return waypoint;
  });
  const sample = (x: number, z: number): ColumnSample | null => {
    const column = columns(x, z);
    return column && { groundY: column.ground, topY: column.top, tileDepth: 20, tileGeometricError: 2 };
  };
  const grid = new GlobalRouteGrid();
  grid.initialize(sample, frame.sync as never);
  grid.generateFromRoutes([waypoints]);
  return { cut, band, waypoints, grid };
}

/** What a run decided: the band and the cells with a height, for comparing two runs. */
function report(r: Run) {
  const cells = r.grid.getCellsInRange(0, 0, 1e6).map((c) => `${c.x},${c.z},${c.surface},${c.terrainHeight.toFixed(3)}`).sort();
  return { band: r.band, cells, total: r.grid.getStats().totalCells };
}

/** `make` run twice: both report the same. The first run. */
function twice(make: () => Run): Run {
  const first = make();
  expect(report(make())).toEqual(report(first));
  return first;
}

/** Offset of (x, z) right of travel at `st`, and how far ahead of it along the route. */
const across = (st: BandStation, x: number, z: number) => (x - st.x) * st.rx + (z - st.z) * st.rz;
const ahead = (st: BandStation, x: number, z: number) => (x - st.x) * st.rz - (z - st.z) * st.rx;

/** The station with a band nearest ahead or behind (x, z) along the route, among those within 12 m. */
function stationBeside(band: CorridorBand, x: number, z: number): BandStation {
  const candidates = band.stations.filter((st) => (st.kind === 'band' || st.kind === 'climb') && Math.hypot(st.x - x, st.z - z) < 12);
  expect(candidates.length).toBeGreaterThan(0);
  return candidates.reduce((a, b) => (Math.abs(ahead(b, x, z)) < Math.abs(ahead(a, x, z)) ? b : a));
}

/** Stations whose edge on `side` juts out past both neighbours by more than `by` metres: a bulge one station long. */
function spikes(stations: readonly BandStation[], side: 'left' | 'right', by: number): string[] {
  const banded = (st: BandStation) => st.kind === 'band' || st.kind === 'climb';
  const out = (st: BandStation) => (side === 'left' ? -st.left : st.right);
  const found: string[] = [];
  for (let k = 1; k + 1 < stations.length; k++) {
    const [a, b, c] = [stations[k - 1], stations[k], stations[k + 1]];
    if (!banded(a) || !banded(b) || !banded(c)) continue;
    if (out(b) - out(a) > by && out(b) - out(c) > by) found.push(`${b.segment}:${b.k} ${out(a).toFixed(2)} ${out(b).toFixed(2)} ${out(c).toFixed(2)}`);
  }
  return found;
}

/** The enemies' line bends and moves no faster than the worm turns: its rings stay closed. */
function expectGentle(band: CorridorBand): void {
  expect(band.maxCurvature).toBeLessThan(1 / 20);
  expect(band.maxSlope).toBeLessThan(0.25);
}

/** The plane through `points` nearest in height (least squares). */
function planeThrough(points: readonly { x: number; z: number; y: number }[]): (x: number, z: number) => number {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const mz = points.reduce((s, p) => s + p.z, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dz = p.z - mz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * (p.y - my);
    szy += dz * (p.y - my);
  }
  const det = sxx * szz - sxz * sxz;
  const b = (sxy * szz - szy * sxz) / det;
  const c = (szy * sxx - sxy * sxz) / det;
  return (x, z) => my + b * (x - mx) + c * (z - mz);
}

describe('the walkable band on the OSM fixtures', () => {
  it('732: runs the enemies on the street left of the parked cars, no cell on them, no hole beside them', () => {
    const fixture = load('erlenbach-732');
    const frame = frameOf(fixture.hq);
    const line = fixture.routePoints.map(([lat, lon]) => frame.toLocal({ lat, lon }));
    // Heights: the 24 reported cells. The street a plane through the street cells the corridor lost; the cars
    // one cell further right of the line (south) than the report names them; right of the line along the row
    // the parking strip the gaps between the cars show, 0.55 m over the street; the one spot without a hit none.
    const reported = new Map(fixture.cells.map((c) => [keyOf(c.x, c.z), c]));
    const cars = fixture.cells.filter((c) => c.what.includes('on a car'));
    const carAt = new Map<string, number>();
    for (const car of cars) {
      carAt.set(keyOf(car.x, car.z), car.heightM!);
      if (!reported.has(keyOf(car.x, car.z - CELL))) carAt.set(keyOf(car.x, car.z - CELL), car.heightM!);
    }
    const nearCars = (x: number, z: number) => cars.some((c) => Math.hypot(c.x - x, c.z - z) < 8);
    const street = planeThrough(fixture.cells.filter((c) => c.cell === false && c.heightM !== null).map((c) => ({ x: c.x, z: c.z, y: c.heightM! })));
    const columns = (x: number, z: number): BandColumn | null => {
      const car = carAt.get(keyOf(x, z));
      if (car !== undefined) return { ground: car, top: car };
      const cell = reported.get(keyOf(x, z));
      if (cell) return cell.heightM === null ? null : { ground: cell.heightM, top: cell.topM ?? cell.heightM };
      const cx = centreOf(x);
      const cz = centreOf(z);
      const y = street(cx, cz) + (nearCars(cx, cz) && offsetFrom(line, cx, cz) > 0 ? 0.55 : 0);
      return { ground: y, top: y };
    };
    // The rays: along the row the cars and the fronts behind them 1.5 m right of the line; the street to the left.
    const walls: Walls = (x, z, side) => (side === 'right' && nearCars(x, z) ? 1.5 : OPEN_WALL_M);

    for (const mode of ['band', 'minimal'] as const) {
      const r = twice(() => run(fixture, columns, walls, mode));
      const row = r.band.stations.filter((st) => cars.some((c) => Math.hypot(c.x - st.x, c.z - st.z) < 2.5));
      expect(row.length).toBeGreaterThan(5);
      for (const st of row) {
        expect(st.kind, `${mode} ${st.segment}:${st.k}`).toBe('band');
        expect(st.backbone!.offset).toBeLessThan(0);
        expect(st.right).toBeLessThan(0);
        expect(st.centre).toBeLessThanOrEqual(st.right - corridorConfig.edgeMargin + 1e-6);
      }
      const onCars = [...carAt.keys()].filter((key) => {
        const [x, z] = key.split(',').map(Number);
        return r.grid.getCellAt(x, z) !== undefined;
      });
      expect(onCars, mode).toEqual([]);
      // The street cells lost beside the cars are cells at their height; the spot without a hit takes one from its neighbours.
      const lost = fixture.cells.filter((c) => c.cell === false && r.band.stations.some((st) => Math.hypot(st.x - c.x, st.z - c.z) < 6));
      expect(lost.length).toBeGreaterThanOrEqual(7);
      for (const c of lost) {
        const cell = r.grid.getCellAt(c.x, c.z);
        expect(cell, `${mode} ${c.x},${c.z}`).toBeDefined();
        expect(cell!.heightSampled).toBe(true);
        if (c.heightM !== null) expect(cell!.terrainHeight).toBeCloseTo(c.heightM, 1);
      }
      expectGentle(r.band);
    }
  });

  it('Galgengasse: ends the band before the hollow car; Georgengasse stays a tunnel', () => {
    const fixture = load('rothenburg-galgengasse');
    // Heights: the two reported columns on the red car (street under it, roof over it), the street around at 485.2.
    const STREET_Y = 485.2;
    const car = new Map(fixture.cells.map((c) => [keyOf(c.x, c.z), c]));
    const columns = (x: number, z: number): BandColumn => {
      const c = car.get(keyOf(x, z));
      return c ? { ground: c.heightM!, top: c.topM! } : { ground: STREET_Y, top: STREET_Y };
    };
    const r = twice(() => run(fixture, columns));
    for (const c of fixture.cells) {
      expect(r.grid.getCellAt(c.x, c.z)).toBeUndefined();
      const st = stationBeside(r.band, c.x, c.z);
      const u = across(st, c.x, c.z);
      expect(u).toBeLessThan(0);
      expect(st.left).toBeGreaterThan(u);
    }
    const tunnel = r.band.stations.filter((st) => r.cut.ways[st.segment]?.id === 139711828);
    expect(tunnel.length).toBeGreaterThan(0);
    for (const st of tunnel) {
      expect(st).toMatchObject({ kind: 'fixed', centre: 0 });
      expect(r.grid.getCellAt(st.x, st.z)?.surface).toBe('tunnel');
    }
    expectGentle(r.band);
  });

  it('Platz der Republik: ends the band before the objects on the square, without bulges one station long', () => {
    const fixture = load('berlin-platz-der-republik');
    const frame = frameOf(fixture.hq);
    const line = fixture.routePoints.map(([lat, lon]) => frame.toLocal({ lat, lon }));
    // Synthetic heights on the real line: the square level at 34 m, on it a bench 0.6 m high 4 m right of the
    // service road across it, a person the mesh made hollow 2.5 m left of it, and a hedge 1 m high 4 to 6 m right
    // of the footway south of it, which runs 18 degrees off the grid.
    const GROUND = 34;
    const beside = (i: number, t: number, u: number) => {
      const a = line[i];
      const b = line[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      return keyOf(a.x + (b.x - a.x) * t - ((b.z - a.z) / len) * u, a.z + (b.z - a.z) * t + ((b.x - a.x) / len) * u);
    };
    const bench = new Set([beside(12, 0.4, 4), beside(12, 0.43, 4)]);
    const person = beside(12, 0.65, -2.5);
    const hedge = new Set<string>();
    for (let i = 19; i < 24; i++) {
      const a = line[i];
      const b = line[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL) - 5; gx <= Math.floor(Math.max(a.x, b.x) / CELL) + 5; gx++) {
        for (let gz = Math.floor(Math.min(a.z, b.z) / CELL) - 5; gz <= Math.floor(Math.max(a.z, b.z) / CELL) + 5; gz++) {
          const x = (gx + 0.5) * CELL;
          const z = (gz + 0.5) * CELL;
          const t = ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (len * len);
          const u = ((x - a.x) * -(b.z - a.z) + (z - a.z) * (b.x - a.x)) / len;
          if (t >= 0 && t <= 1 && u >= 4 && u <= 6) hedge.add(keyOf(x, z));
        }
      }
    }
    const columns = (x: number, z: number): BandColumn => {
      const key = keyOf(x, z);
      if (bench.has(key)) return { ground: GROUND + 0.6, top: GROUND + 0.6 };
      if (hedge.has(key)) return { ground: GROUND + 1, top: GROUND + 1 };
      if (key === person) return { ground: GROUND, top: GROUND + 1.7 };
      return { ground: GROUND, top: GROUND };
    };
    const r = twice(() => run(fixture, columns));

    const objects = [...bench, person, ...hedge];
    const covered = objects.filter((key) => {
      const [x, z] = key.split(',').map(Number);
      return r.grid.getCellAt(x, z) !== undefined;
    });
    expect(covered).toEqual([]);
    for (const key of bench) {
      const [x, z] = key.split(',').map(Number);
      const st = stationBeside(r.band, x, z);
      expect(st.right).toBeLessThan(across(st, x, z));
    }
    const [px, pz] = person.split(',').map(Number);
    const st = stationBeside(r.band, px, pz);
    expect(st.left).toBeGreaterThan(across(st, px, pz));
    expect(spikes(r.band.stations, 'left', 0.5)).toEqual([]);
    expect(spikes(r.band.stations, 'right', 0.5)).toEqual([]);
    expectGentle(r.band);
  });

  it("Pont d'Iéna: keeps the stretch off the bridge end on the OSM line, its cells at deck height", () => {
    const fixture = load('paris-pont-d-iena');
    const frame = frameOf(fixture.hq);
    // Synthetic heights on the real line: the street and the deck at 79.9; under the road for 35 m off the
    // bridge end the second surface of picks A to C (75.99 at 12 m, 77.99 at 16 m, 69.38 at 27 m); the river
    // 20 m under the deck.
    const DECK_Y = 79.9;
    const probe = cutRoute(fixture, frame, () => OPEN_WALL_M);
    const end = probe.route.points[probe.onBridge.indexOf(true)];
    const decks = streetsOf(fixture).filter((s) => s.bridge !== undefined).map((s) => s.nodes.map(frame.toLocal));
    const columns = (x: number, z: number): BandColumn => {
      const cx = centreOf(x);
      const cz = centreOf(z);
      if (decks.some((deck) => distanceToLine(deck, cx, cz) <= 6)) return { ground: DECK_Y - 20, top: DECK_Y };
      const d = Math.hypot(cx - end.x, cz - end.z);
      if (d < 14) return { ground: 75.99, top: DECK_Y };
      if (d < 20) return { ground: 77.99, top: DECK_Y };
      if (d < 35) return { ground: 69.38, top: DECK_Y };
      return { ground: DECK_Y, top: DECK_Y };
    };
    const r = twice(() => run(fixture, columns));

    const approach = r.band.stations.filter((st) => r.cut.approach[st.segment]);
    expect(approach.length).toBeGreaterThan(0);
    for (const st of approach) expect(st).toMatchObject({ kind: 'fixed', centre: 0 });
    const offEnd = approach.filter((st) => Math.hypot(st.x - end.x, st.z - end.z) < 35);
    expect(offEnd.length).toBeGreaterThan(0);
    for (const st of offEnd) {
      const cell = r.grid.getCellAt(st.x, st.z)!;
      expect(cell.surface).toBe('approach');
      expect(cell.terrainHeight).toBeCloseTo(DECK_Y, 1);
    }
    const bridge = r.band.stations.filter((st) => r.cut.onBridge[st.segment]);
    expect(bridge.length).toBeGreaterThan(0);
    for (const st of bridge) {
      expect(st.kind).toBe('fixed');
      expect(r.grid.getCellAt(st.x, st.z)).toMatchObject({ surface: 'deck', terrainHeight: DECK_Y });
    }
    // No cell on the road under the approach or the river under the deck.
    const low = r.grid.getCellsInRange(0, 0, 1e6).filter((c) => c.terrainHeight < DECK_Y - 0.5);
    expect(low.map((c) => `${c.x},${c.z} ${c.surface} ${c.terrainHeight}`)).toEqual([]);
    expectGentle(r.band);
  });

  it('A6: runs the route under the motorway decks as a tunnel at street height', () => {
    const fixture = load('erlenbach-weinsberger-a6');
    const frame = frameOf(fixture.hq);
    // Synthetic heights on the real line: the street at 215 (214.72 and 215.05 under the decks in D2), under the
    // two decks the mesh shows the deck alone at 220.7, the single hit of D2.
    const STREET_Y = 215;
    const DECK_Y = 220.7;
    const decks = streetsOf(fixture).filter((s) => fixture.route.underWayIds.includes(s.id)).map((s) => s.nodes.map(frame.toLocal));
    const columns = (x: number, z: number): BandColumn => {
      const y = decks.some((deck) => distanceToLine(deck, centreOf(x), centreOf(z)) <= 6) ? DECK_Y : STREET_Y;
      return { ground: y, top: y };
    };
    const r = twice(() => run(fixture, columns));

    const under = r.band.stations.filter((st) => r.cut.inTunnel[st.segment]);
    expect(under.length).toBeGreaterThan(0);
    for (const st of under) {
      expect(st).toMatchObject({ kind: 'fixed', centre: 0 });
      const cell = r.grid.getCellAt(st.x, st.z)!;
      expect(cell.surface).toBe('tunnel');
      expect(cell.terrainHeight).toBeCloseTo(STREET_Y, 1);
    }
    expect(r.band.passages).toEqual([]);
    const raised = r.grid.getCellsInRange(0, 0, 1e6).filter((c) => c.terrainHeight > STREET_Y + 0.5);
    expect(raised.map((c) => `${c.x},${c.z} ${c.surface} ${c.terrainHeight}`)).toEqual([]);
    expectGentle(r.band);
  });
});
