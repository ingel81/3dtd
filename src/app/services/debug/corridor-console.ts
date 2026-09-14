import {
  CorridorConfig,
  corridorConfig,
  resetCorridorConfig,
  setCorridorConfig,
} from '../../utils/route-corridor';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { InputHandlerService } from '../input-handler.service';
import type { PathAndRouteService } from '../world/path-route.service';
import type { GameStateManager } from '../../managers/game-state.manager';

/** How far above its cells the red route line runs, m (PathAndRouteService.buildRouteFromPath). */
const ROUTE_LINE_LIFT_M = 1;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** The engine as `__corridor.pick()` reads it. */
type PickEngine = NonNullable<ReturnType<EngineInitializationService['getEngine']>>;

/** What CorridorConsole needs; VisualizationFacadeService passes its services. */
export interface CorridorConsoleDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerManager' | 'getGlobalRouteGrid'>;
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
  inputHandler: Pick<InputHandlerService, 'armPick'>;
  pathRoute: Pick<PathAndRouteService, 'explainCorridorAt'>;
  /** Change the corridor settings and rebuild (CorridorController.change). */
  change: (apply: () => string[]) => string;
}

/**
 * Korridor-API für Playtests, analog zu `__rg` und `__routes`, in
 * DevTools: `__corridor.get()`, `__corridor.set({ maxHalfWidth: 8 })`,
 * `__corridor.reset()`, `__corridor.towerCells()`, `__corridor.pick()`.
 */
export class CorridorConsole {
  /** The `__corridor` this instance registered, see uninstall(). */
  private api: object | null = null;

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
    };
    (globalThis as Record<string, unknown>)['__corridor'] = this.api;
  }

  /**
   * Remove `__corridor` from globalThis, unless another instance has
   * registered its own since: that one belongs to the live game.
   */
  uninstall(): void {
    const global = globalThis as Record<string, unknown>;
    if (this.api && global['__corridor'] === this.api) delete global['__corridor'];
    this.api = null;
  }

  /**
   * `__corridor.pick()`: the next left click on the map prints every grid
   * spot within `radius` of it with its cell, sample state, height, surface,
   * the selected tower's answers and whether its LOS display draws it,
   * nearest to the route line first, and what lies over it (coverAt). Then,
   * for the route station nearest to the click, how the corridor width
   * there came about and the tags of its way
   * (PathAndRouteService.explainCorridorAt). Selection and display stay as
   * they are.
   */
  private armCellPick(radius: number): string {
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return 'No location loaded.';
    this.deps.inputHandler.armPick((hit) => {
      const geo = engine.sync.localToGeo(hit);
      const local = engine.sync.geoToLocalSimple(geo.lat, geo.lon, 0);
      const gameState = this.deps.gameState();
      const towers = gameState.towerManager;
      const tower = towers.getSelected();
      const layer = tower ? towers.getSelectionViz()?.getLayer() ?? null : null;
      const drawn = layer ? new Set(layer.cells.map((c) => `${c.x},${c.z}`)) : null;
      const rows = gameState.getGlobalRouteGrid().getGrid()
        .describeCellsAround(local.x, local.z, radius, tower?.id ?? null)
        .map((row) => ({ ...row, displayed: drawn ? drawn.has(`${row.x},${row.z}`) : null, ...this.coverAt(engine, row) }));
      console.log(
        `[Corridor] pick at ${local.x.toFixed(1)},${local.z.toFixed(1)}: ${rows.length} spots within ${radius} m` +
        (tower ? `, answers and display of ${tower.id}` : ', no tower selected'),
      );
      console.table(rows);

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

  /**
   * What lies over a grid spot and whether the camera sees it, for a place
   * where the red line, the cells and the enemies vanish (a route under a
   * bridge, TODO 1.10):
   * - `columnBottomM`, `columnTopM`: the lowest and the highest surface of
   *   the column there (finest tile), as the cells sample them. A cell takes
   *   the bottom, on a bridge deck the top.
   * - `overM`: how far that top lies above the cell, a bridge deck, a roof
   *   or a crown over it.
   * - `cameraSees`: a straight line from the camera to where the red line
   *   runs over the cell (ROUTE_LINE_LIFT_M) passes no tile. False where the
   *   line and the enemies on the cell are hidden behind or under the tiles.
   * Null without a cell height or without a column.
   */
  private coverAt(
    engine: PickEngine,
    row: { x: number; z: number; heightM?: number | null },
  ): { columnBottomM: number | null; columnTopM: number | null; overM: number | null; cameraSees: boolean | null } {
    const column = engine.terrain.raycastColumnSample(row.x, row.z, 'corridorPick');
    const y = row.heightM ?? null;
    const camera = engine.getCamera().position;
    return {
      columnBottomM: column ? round(column.groundY, 2) : null,
      columnTopM: column ? round(column.topY, 2) : null,
      overM: column && y !== null ? round(column.topY - y, 1) : null,
      cameraSees: y === null ? null
        : !engine.terrain.raycastLineOfSight(camera.x, camera.y, camera.z, row.x, y + ROUTE_LINE_LIFT_M, row.z),
    };
  }

  /**
   * What the grid holds in a tower's range and what its LOS display draws
   * of it, for a gap in the display: a cell missing from the grid (`holes`),
   * a cell without a terrain sample (`unsampled`, the display leaves those
   * out), a cell sampled on a car roof or tree crown (`raised`, its plate
   * floats), a display built before the cells changed (`displayOutdated`,
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
      clamped: report.clamped,
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
      centreClamped: centre.clamped,
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
