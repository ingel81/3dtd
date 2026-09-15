import { Vector3 } from 'three';
import {
  CorridorConfig,
  corridorConfig,
  resetCorridorConfig,
  setCorridorConfig,
} from '../../utils/route-corridor';
import { corridorTrace } from '../../utils/corridor-trace';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { InputHandlerService } from '../input-handler.service';
import type { PathAndRouteService } from '../world/path-route.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { ColumnSample } from '../../three-engine/column-sample';
import type { GlobalRouteGrid } from '../../utils/global-route-grid';
import type { RouteCellProbe } from '../../utils/route-grid-diagnostics';
import type { CellReportService, CellReportSource } from './cell-report.service';
import type { CellProbe, CellSpot, NeighbourRow, ProbedCell, ScreenRect } from './cell-report';
import type { CorridorLodProbe } from './corridor-lod-probe';

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** The engine as `__corridor.pick()` reads it. */
type PickEngine = NonNullable<ReturnType<EngineInitializationService['getEngine']>>;

/** What TerrainQueries.inspectColumn tells about the column at the click. */
type ColumnInspection = NonNullable<ReturnType<PickEngine['terrain']['inspectColumn']>>;

/** A row of `__corridor.pick()` before the cover: the grid spot and what the selected tower's display draws of it. */
type PickRow = RouteCellProbe & { displayed: boolean | null };

/** What a pick or a report reads once: the grid, the selected tower, its display, the height of the red line. */
interface PickView {
  grid: GlobalRouteGrid;
  tower: string | null;
  /** Cells the tower's LOS display draws, as "x,z"; null without a selected tower. */
  drawn: Set<string> | null;
  lift: number;
}

/** Every cell of the grid, for dumpCellsInBox. */
const WHOLE_GRID = { xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity };

/**
 * The column at the click for the console: the sample the cache holds (what
 * the cells read), the one a fresh ray gives now, and every hit of that ray
 * as height@depth/geometricError, top first.
 */
function describeColumn(column: ColumnInspection): Record<string, string | null> {
  const sample = (s: ColumnSample | null) => (s ? `ground ${round(s.groundY, 2)} top ${round(s.topY, 2)} depth ${s.tileDepth}` : null);
  return {
    cached: sample(column.cached),
    fresh: sample(column.fresh),
    hits: column.hits.map((hit) => `${round(hit.y, 2)}@${hit.depth}/${hit.geometricError}`).join(' '),
  };
}

/** What CorridorConsole needs; VisualizationFacadeService passes its services. */
export interface CorridorConsoleDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerManager' | 'getGlobalRouteGrid'>;
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
  inputHandler: Pick<InputHandlerService, 'armPick'>;
  pathRoute: Pick<PathAndRouteService, 'explainCorridorAt' | 'routeLineLift' | 'getCachedPaths'>;
  /** Change the corridor settings and rebuild (CorridorController.change). */
  change: (apply: () => string[]) => string;
  /** The cell report, `__corridor.report()`; this console reads its cells. */
  cellReport: Pick<CellReportService, 'start' | 'connect' | 'disconnect'>;
  /** `__corridor.probeLod()` and `fingerprint()`, see CorridorLodProbe. */
  lodProbe: Pick<CorridorLodProbe, 'run' | 'fingerprint'>;
}

/**
 * Korridor-API für Playtests, analog zu `__rg` und `__routes`, in
 * DevTools: `__corridor.get()`, `__corridor.set({ maxHalfWidth: 8 })`,
 * `__corridor.reset()`, `__corridor.towerCells()`, `__corridor.pick()`,
 * `__corridor.report()`, `__corridor.probeLod()`, `__corridor.fingerprint()`,
 * `__corridor.trace()` (the corridor trace of this location load,
 * `trace(false)` turns it off, see corridor-trace.ts).
 */
export class CorridorConsole {
  /** The `__corridor` this instance registered, see uninstall(). */
  private api: object | null = null;

  /** The cells of the cell report, read the way pick() reads its click. */
  private readonly reportSource: CellReportSource = {
    spotAt: (hit) => this.spotAt(hit),
    cellsInRect: (rect, limit) => this.cellsInRect(rect, limit),
    showSelection: (spots) => this.deps.gameState().getGlobalRouteGrid().showCellSelection(spots),
    describe: (spots) => this.describeCells(spots),
  };

  constructor(private readonly deps: CorridorConsoleDeps) {}

  /** Register `__corridor` on globalThis, replacing the one of a previous location. */
  install(): void {
    this.api = {
      get: () => ({ ...corridorConfig, highwayWidths: { ...corridorConfig.highwayWidths } }),
      set: (patch: Partial<CorridorConfig>) => this.deps.change(() => setCorridorConfig(patch)),
      reset: () => this.deps.change(() => {
        resetCorridorConfig();
        return [];
      }),
      towerCells: (towerId?: string) => this.describeTowerCells(towerId),
      pick: (radius = 4) => this.armCellPick(radius),
      report: () => this.deps.cellReport.start(),
      probeLod: (targets?: number[], timeoutS?: number) => this.deps.lodProbe.run(targets, timeoutS),
      fingerprint: () => this.deps.lodProbe.fingerprint(),
      trace: (on?: boolean) => (on === undefined ? corridorTrace.print() : corridorTrace.setEnabled(on)),
    };
    (globalThis as Record<string, unknown>)['__corridor'] = this.api;
    this.deps.cellReport.connect(this.reportSource);
  }

  /**
   * Remove `__corridor` from globalThis, unless another instance has
   * registered its own since: that one belongs to the live game. The cell
   * report lets go of this console's cells (and ends) the same way.
   */
  uninstall(): void {
    const global = globalThis as Record<string, unknown>;
    if (this.api && global['__corridor'] === this.api) delete global['__corridor'];
    this.api = null;
    this.deps.cellReport.disconnect(this.reportSource);
  }

  /**
   * `__corridor.pick()`: the next left click on the map prints every grid
   * spot within `radius` of it with its cell, sample state, height, surface,
   * the selected tower's answers and whether its LOS display draws it,
   * nearest to the route line first, and what lies over it (coverAt). Then
   * what the column at the click is made of, cached against a fresh ray
   * (TerrainQueries.inspectColumn; not in DevWorld). Then,
   * for the route station nearest to the click, how the corridor width
   * there came about and the tags of its way
   * (PathAndRouteService.explainCorridorAt). Selection and display stay as
   * they are.
   */
  private armCellPick(radius: number): string {
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return 'No location loaded.';
    this.deps.inputHandler.armPick((hit) => {
      const local = this.groundPoint(engine, hit);
      const view = this.pickView();
      const rows = this.rowsAround(view, local.x, local.z, radius)
        .map((row) => ({ ...row, ...this.coverAt(engine, row, view.lift) }));
      console.log(
        `[Corridor] pick at ${local.x.toFixed(1)},${local.z.toFixed(1)}: ${rows.length} spots within ${radius} m` +
        (view.tower ? `, answers and display of ${view.tower}` : ', no tower selected'),
      );
      console.table(rows);

      const column = engine.terrain.inspectColumn(local.x, local.z);
      if (column) console.log('[Corridor] column at the click', describeColumn(column));

      const why = this.deps.pathRoute.explainCorridorAt(local.x, local.z);
      if (why) {
        const { sides, nearby, ...station } = why;
        console.log('[Corridor] width at the nearest route station', station);
        console.table(sides);
        console.table(nearby);
      }
    });
    return `Click the map (left button): the grid within ${radius} m of the click and how the corridor width comes about there are printed here.`;
  }

  /** The point on the ground a picked hit stands for, in the local frame the grid is keyed in. */
  private groundPoint(engine: PickEngine, hit: Vector3): Vector3 {
    const geo = engine.sync.localToGeo(hit);
    return engine.sync.geoToLocalSimple(geo.lat, geo.lon, 0);
  }

  /** Read once per pick or report: the grid, the selected tower, what its LOS display draws, the red line's lift. */
  private pickView(): PickView {
    const gameState = this.deps.gameState();
    const towers = gameState.towerManager;
    const tower = towers.getSelected();
    const layer = tower ? towers.getSelectionViz()?.getLayer() ?? null : null;
    return {
      grid: gameState.getGlobalRouteGrid().getGrid(),
      tower: tower?.id ?? null,
      drawn: layer ? new Set(layer.cells.map((c) => `${c.x},${c.z}`)) : null,
      lift: this.deps.pathRoute.routeLineLift(),
    };
  }

  /** The grid spots within `radius` of (x, z) as pick() prints them, before the cover. */
  private rowsAround(view: PickView, x: number, z: number, radius: number): PickRow[] {
    return view.grid.describeCellsAround(x, z, radius, view.tower)
      .map((row) => ({ ...row, displayed: view.drawn ? view.drawn.has(`${row.x},${row.z}`) : null }));
  }

  /**
   * What lies over a grid spot and whether the camera sees it, for a place
   * where the red line, the cells and the enemies vanish (a route under a
   * bridge, TODO 1.10):
   * - `columnBottomM`, `columnTopM`: the lowest and the highest surface of
   *   the column there (finest tile), as the cells sample them. A cell takes
   *   the bottom, on a bridge deck the top.
   * - `overM`: how far that top lies above the cell, a bridge deck, a roof
   *   or a crown over it.
   * - `cameraSees`: a straight line from the camera to the point `lift`
   *   above the cell (PathAndRouteService.routeLineLift, 1 m, DevWorld 3 m)
   *   passes no tile. The red line runs there over a centre line cell and
   *   nowhere else; beside the centre line the point stands in for the
   *   enemies on the cell. False where they are hidden behind or under the
   *   tiles.
   * Null without a cell height or without a column.
   */
  private coverAt(
    engine: PickEngine,
    row: { x: number; z: number; heightM?: number | null },
    lift: number,
  ): { columnBottomM: number | null; columnTopM: number | null; overM: number | null; cameraSees: boolean | null } {
    const column = engine.terrain.raycastColumnSample(row.x, row.z, 'corridorPick');
    const y = row.heightM ?? null;
    const camera = engine.getCamera().position;
    return {
      columnBottomM: column ? round(column.groundY, 2) : null,
      columnTopM: column ? round(column.topY, 2) : null,
      overM: column && y !== null ? round(column.topY - y, 1) : null,
      cameraSees: y === null ? null
        : !engine.terrain.raycastLineOfSight(camera.x, camera.y, camera.z, row.x, y + lift, row.z),
    };
  }

  /**
   * The grid spot under a click for the cell report: the centre of its
   * square on the grid lattice (the spot pick() would list for it), framed
   * at the hit's height where it has no cell.
   */
  private spotAt(hit: Vector3): CellSpot | null {
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return null;
    const local = this.groundPoint(engine, hit);
    const size = this.deps.gameState().getGlobalRouteGrid().getGrid().getCellSize();
    return { x: (Math.floor(local.x / size) + 0.5) * size, y: hit.y, z: (Math.floor(local.z / size) + 0.5) * size };
  }

  /**
   * The cells whose centre, on its ground (getGroundLocalYAt), the camera
   * shows inside the rectangle (client pixels), at most `limit`, nearest to
   * the rectangle's middle first. A cell counts by where it lies on the
   * screen, also behind a house.
   */
  private cellsInRect(rect: ScreenRect, limit: number): CellSpot[] {
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return [];
    const grid = this.deps.gameState().getGlobalRouteGrid().getGrid();
    const camera = engine.getCamera();
    const canvas = engine.getRenderer().domElement.getBoundingClientRect();
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;
    const p = new Vector3();
    const found: (CellSpot & { d: number })[] = [];
    for (const cell of grid.dumpCellsInBox(WHOLE_GRID)) {
      const y = grid.getGroundLocalYAt(cell.x, cell.z) ?? cell.terrainHeight;
      p.set(cell.x, y, cell.z).project(camera);
      // Behind the camera or past its far plane
      if (p.z < -1 || p.z > 1) continue;
      const sx = canvas.left + ((p.x + 1) / 2) * canvas.width;
      const sy = canvas.top + ((1 - p.y) / 2) * canvas.height;
      if (sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom) continue;
      found.push({ x: cell.x, y, z: cell.z, d: (sx - midX) ** 2 + (sy - midY) ** 2 });
    }
    return found.sort((a, b) => a.d - b.d).slice(0, limit).map(({ x, y, z }) => ({ x, y, z }));
  }

  /**
   * The cell report's spots as pick() sees a click on each: the pick row of
   * the spot with the cover, heightM and walkable of the eight spots around
   * it, the column at its centre and the corridor width at the nearest
   * route station. The rows carry the answers of the selected tower, as in
   * pick(). No cells without a location.
   */
  private describeCells(spots: readonly CellSpot[]): CellProbe {
    const engine = this.deps.engineInit.getEngine();
    const view = this.pickView();
    const size = view.grid.getCellSize();
    const cells = engine ? spots.map((spot): ProbedCell => {
      // The spot and its eight neighbours: the next ring lies 2 cells out
      const rows = this.rowsAround(view, spot.x, spot.z, size * 1.5);
      let centre: PickRow | null = null;
      for (const row of rows) {
        if (!centre || Math.hypot(row.x - spot.x, row.z - spot.z) < Math.hypot(centre.x - spot.x, centre.z - spot.z)) centre = row;
      }
      const neighbours: Record<string, NeighbourRow> = {};
      for (const row of rows) {
        if (row === centre) continue;
        neighbours[`${Math.round((row.x - spot.x) / size)},${Math.round((row.z - spot.z) / size)}`] =
          row.cell ? [row.heightM, row.walkable] : null;
      }
      const column = engine.terrain.inspectColumn(spot.x, spot.z);
      const geo = engine.sync.localToGeo(new Vector3(spot.x, 0, spot.z));
      return {
        geo: `${geo.lat.toFixed(7)},${geo.lon.toFixed(7)}`,
        row: centre ? { ...centre, ...this.coverAt(engine, centre, view.lift) } : { x: spot.x, z: spot.z, cell: false },
        neighbours,
        column: column ? describeColumn(column) : null,
        station: this.deps.pathRoute.explainCorridorAt(spot.x, spot.z),
      };
    }) : [];
    return { tower: view.tower, routes: [...this.deps.pathRoute.getCachedPaths().keys()], cells };
  }

  /**
   * What the grid holds in a tower's range and what its LOS display draws
   * of it, for a gap in the display: a cell missing from the grid (`holes`),
   * a cell without a terrain sample (`unsampled`, the display leaves those
   * out), a cell sampled on a car roof or tree crown (`raised`, its plate
   * floats; `unwalkable` when the corridor could no longer drop it), a
   * display built before the cells changed (`displayOutdated`,
   * `notDisplayed`) or a cube rendered from another tower (`cubeFromTower`
   * false). The selected tower unless an id is given.
   */
  private describeTowerCells(towerId?: string): Record<string, unknown> | string {
    const gameState = this.deps.gameState();
    const towers = gameState.towerManager;
    const tower = towerId ? towers.getById(towerId) : towers.getSelected();
    if (!tower) return 'No tower: select one or pass its id.';
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return 'No engine.';

    const grid = gameState.getGlobalRouteGrid().getGrid();
    const local = engine.sync.geoToLocalSimple(tower.position.lat, tower.position.lon, tower.position.height ?? 0);
    const range = tower.combat.range;
    const report = grid.describeTowerRange(tower.id, local.x, local.z, range);
    const centreLine = grid.centreLineCells(local.x, local.z, range);
    const centre = grid.describeCentreLine(tower.id, local.x, local.z, range);

    // The display is a snapshot of the sampled cells in range, coloured
    // against the shared cube. Only the selected tower has one.
    const layer = towers.getSelected() === tower ? towers.getSelectionViz()?.getLayer() ?? null : null;
    const drawn = layer ? new Set(layer.cells) : null;
    const reference = engine.getTowerShadowMapper().getReferencePos();
    const summary = {
      tower: tower.id,
      range,
      cells: report.cells,
      unsampled: report.unsampled,
      groundVisible: report.groundVisible,
      groundBlocked: report.groundBlocked,
      groundMissing: report.groundMissing,
      airVisible: report.airVisible,
      airBlocked: report.airBlocked,
      airMissing: report.airMissing,
      holes: report.holes.length,
      raised: report.raised.length,
      unwalkable: report.unwalkable,
      displayed: drawn?.size ?? null,
      displayOutdated: layer ? layer.cells.filter((c) => grid.getCellAt(c.x, c.z) !== c).length : null,
      notDisplayed: drawn ? grid.getCellsInRange(local.x, local.z, range).filter((c) => !drawn.has(c)).length : null,
      cubeFromTower: Math.hypot(reference.x - local.x, reference.z - local.z) <= 0.5,
      // The cells the red line runs through, in range.
      centreCells: centre.cells,
      centreMissing: centre.holes.length,
      centreUnsampled: centre.unsampled,
      centreBlocked: centre.groundBlocked,
      centreRaised: centre.raised.length,
      centreNotDisplayed: drawn ? centreLine.cells.filter((c) => c.heightSampled && !drawn.has(c)).length : null,
    };
    console.table(summary);
    return {
      ...summary,
      holeCells: report.holes,
      raisedCells: report.raised.slice(0, 20),
      centreMissingCells: centre.holes,
    };
  }
}
