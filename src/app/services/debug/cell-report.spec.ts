import { describe, expect, it } from 'vitest';
import {
  buildCellReport,
  corridorChanges,
  reportUrl,
  roundNumbers,
  screenRect,
  type CellProbe,
  type CellReportMeta,
  type ProbedCell,
} from './cell-report';
import { CORRIDOR_DEFAULTS, type CorridorConfig } from '../../utils/route-corridor';
import type { CorridorExplanation, CorridorSideRow } from '../world/path-route.service';

/**
 * The cell report replaces three screenshotted console tables per cell with
 * one JSON for many cells: the pick row, the column, the corridor width at the
 * nearest station and the neighbours of every selected cell.
 */
describe('cell report JSON', () => {
  const meta: CellReportMeta = {
    time: '2026-09-15T10:00:00.000Z',
    url: 'http://localhost:4200/?l=49.17327,9.26859&s=49.17555,9.26387',
    version: 'v0.2.0',
    location: 'Erlenbach',
    effects: 'high',
    corridor: { maxHalfWidth: 5 },
  };

  const side = (name: 'left' | 'right'): CorridorSideRow => ({
    side: name,
    streetHalfWidthM: 3,
    lowHitM: 2.346,
    highHitM: 4.5,
    lowRiseM: null,
    wall: true,
    freeM: 2.3,
    smoothedM: 2.3,
    halfWidthM: 1.8,
    inUseM: 1.8,
    rule: 'wall less margin',
  });

  const station = (route: string, id: string, distanceM: number): CorridorExplanation => ({
    route,
    station: id,
    distanceM,
    way: 4242,
    type: 'residential',
    name: 'Weinsberger Straße',
    tags: 'width=6 layer=-1',
    streetWidthM: 6,
    widthSource: 'width',
    onStreet: true,
    inTunnel: false,
    underWay: null,
    backboneM: 0,
    backboneY: 218.4,
    streetY: 218.4,
    bandLeftM: -2.5,
    bandRightM: 2.5,
    bandKind: 'band',
    detourM: null,
    passage: false,
    unmeasured: null,
    tileError: 1.234,
    sides: [side('left'), side('right')],
    nearby: [{ station: '7:2/32', alongM: 100, leftFreeM: 3, leftM: 3, rightFreeM: 3, rightM: 3, unmeasured: null, here: false }],
    shiftM: null,
  });

  /** The fields `__corridor.pick()` prints per spot. */
  const PICK_FIELDS = [
    'x', 'z', 'routeM', 'cell', 'state', 'heightM', 'walkable', 'walkCheck', 'overLineM', 'aboveNeighboursM',
    'surface', 'ground', 'air', 'displayed', 'columnBottomM', 'columnTopM', 'overM', 'cameraSees',
  ];

  const cell = (x: number, z: number, nearest: CorridorExplanation | null): ProbedCell => ({
    geo: '49.1732712,9.2685934',
    row: {
      x, z, routeM: 3.2, cell: true, state: 'stable', heightM: 190.12345, walkable: false, walkCheck: 'roof',
      overLineM: 1.456, aboveNeighboursM: 1.5, surface: 'ground', ground: 'visible', air: '-', displayed: true,
      columnBottomM: 190.1, columnTopM: 191.66666, overM: 1.6, cameraSees: true,
    },
    neighbours: {
      '-1,-1': [188.667, true], '0,-1': [188.7, true], '1,-1': null, '-1,0': [190.2, false],
      '1,0': [188.6, true], '-1,1': [188.5, true], '0,1': [188.5, true], '1,1': [188.4, true],
    },
    column: { cached: 'ground 190.12 top 191.67 depth 21', fresh: 'ground 190.12 top 191.67 depth 21', hits: '191.67@21/1 190.12@21/1' },
    station: nearest,
  });

  const probe = (cells: ProbedCell[]): CellProbe => ({ tower: 't1', routes: ['spawn-1'], cells });

  it('is JSON with the meta, the note, the stations and one cell per line', () => {
    const json = buildCellReport(meta, 'Auto am Rand', probe([
      cell(1, 1, station('spawn-1', '7:3/32', 1.2)),
      cell(3, 1, station('spawn-1', '7:4/32', 0.8)),
    ]));
    const report = JSON.parse(json);

    expect(report.meta).toEqual({ ...meta, tower: 't1', routes: ['spawn-1'], cells: 2 });
    expect(report.note).toBe('Auto am Rand');
    const lines = json.split('\n');
    expect(lines.filter((l) => l.startsWith('{"x":1,') || l.startsWith('{"x":3,'))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith('"spawn-1 7:'))).toHaveLength(2);
  });

  it('carries per cell every field the pick prints, the column, the neighbours and its station', () => {
    const [reported] = JSON.parse(buildCellReport(meta, '', probe([cell(1, 1, station('spawn-1', '7:3/32', 1.2))]))).cells;

    for (const field of PICK_FIELDS) expect(reported, field).toHaveProperty(field);
    expect(reported.geo).toBe('49.1732712,9.2685934');
    expect(reported.column.hits).toBe('191.67@21/1 190.12@21/1');
    expect(Object.keys(reported.nb)).toHaveLength(8);
    expect(reported.nb['1,-1']).toBeNull();
    expect(reported.station).toBe('spawn-1 7:3/32');
    expect(reported.stationM).toBe(1.2);
  });

  it('rounds every number to two decimals, in the neighbours and the side rows as well', () => {
    const report = JSON.parse(buildCellReport(meta, '', probe([cell(1, 1, station('spawn-1', '7:3/32', 1.2))])));
    const [reported] = report.cells;
    const kept = report.stations['spawn-1 7:3/32'];

    expect(reported.heightM).toBe(190.12);
    expect(reported.columnTopM).toBe(191.67);
    expect(reported.nb['-1,-1']).toEqual([188.67, true]);
    expect(kept.tileError).toBe(1.23);
    expect(kept.sides[0].lowHitM).toBe(2.35);
    expect(roundNumbers({ a: [Infinity, NaN, -1.005001] })).toEqual({ a: [null, null, -1.01] });
  });

  it('lists a station once for all the cells nearest to it, without the stations around it', () => {
    const shared = station('spawn-1', '7:3/32', 1.2);
    const report = JSON.parse(buildCellReport(meta, '', probe([
      cell(1, 1, shared),
      cell(3, 1, { ...shared, distanceM: 2.2 }),
      cell(5, 1, null),
    ])));

    expect(Object.keys(report.stations)).toEqual(['spawn-1 7:3/32']);
    const kept = report.stations['spawn-1 7:3/32'];
    expect(kept).not.toHaveProperty('nearby');
    expect(kept).not.toHaveProperty('distanceM');
    expect(kept).toMatchObject({ way: 4242, type: 'residential', tags: 'width=6 layer=-1' });
    expect(kept.sides.map((s: { side: string }) => s.side)).toEqual(['left', 'right']);
    expect(report.cells.map((c: { stationM: number | null }) => c.stationM)).toEqual([1.2, 2.2, null]);
    expect(report.cells[2].station).toBeNull();
  });

  it('stays well under 100 kB for 30 cells, each at a station of its own', () => {
    const cells = Array.from({ length: 30 }, (_, i) => cell(i * 2 + 1, 1, station('spawn-1', `7:${i + 1}/32`, 1)));
    const json = buildCellReport(meta, 'Böschung', probe(cells));

    expect(json.length).toBeLessThan(50 * 1024);
    expect(JSON.parse(json).cells).toHaveLength(30);
  });

  it('is valid JSON without cells or stations', () => {
    expect(JSON.parse(buildCellReport(meta, '', probe([])))).toMatchObject({ stations: {}, cells: [] });
  });

  describe('reportUrl', () => {
    it('keeps the location parameters and drops those that could carry a key', () => {
      expect(reportUrl('http://localhost:4200/?l=49.17327,9.26859&token=abc&s=49.1,9.2;49.2,9.3&apiKey=xyz&access_token=q#frag'))
        .toBe('http://localhost:4200/?l=49.17327,9.26859&s=49.1,9.2;49.2,9.3');
    });

    it('drops user info and a query that holds nothing else', () => {
      expect(reportUrl('https://user:secret@example.org/game?key=1')).toBe('https://example.org/game');
      expect(reportUrl('not a url')).toBe('');
    });
  });

  describe('corridorChanges', () => {
    const copy = (): CorridorConfig => ({ ...CORRIDOR_DEFAULTS, highwayWidths: { ...CORRIDOR_DEFAULTS.highwayWidths } });

    it('is empty for the defaults', () => {
      expect(corridorChanges(copy(), CORRIDOR_DEFAULTS)).toEqual({});
    });

    it('names the changed settings and only the changed or added highway widths', () => {
      const config = copy();
      config.maxHalfWidth = 5;
      config.highwayWidths['residential'] = 7;
      config.highwayWidths['raceway'] = 9;

      expect(corridorChanges(config, CORRIDOR_DEFAULTS)).toEqual({
        maxHalfWidth: 5,
        highwayWidths: { residential: 7, raceway: 9 },
      });
    });
  });

  it('spans a box from two pointer positions, whichever way the drag went', () => {
    expect(screenRect(30, 40, 10, 20)).toEqual({ left: 10, top: 20, right: 30, bottom: 40 });
  });
});
