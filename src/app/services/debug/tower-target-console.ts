import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { COMBAT_TUNING } from '../../configs/combat-tuning.config';
import { geoDistanceFast } from '../../utils/geo-utils';
import type { Enemy } from '../../entities/enemy.entity';
import type { Tower } from '../../entities/tower.entity';
import type { TowerTypeId } from '../../configs/tower-types.config';
import type { RouteCell } from '../../utils/route-cell';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { isAimAligned } from '../../entities/tower-aim';

/** How long `__towerTargets.watch()` logs after an ooze breaks up, s */
const WATCH_SECONDS = 6;

/** What explainTowerTarget reads besides the tower and the enemies. */
export interface TowerTargetLookup {
  /** The route cell under an enemy, undefined off the grid */
  cellOf(enemy: Enemy): RouteCell | undefined;
  /** Whether `cell` is still the grid's cell at its place, false for one a rebuild replaced */
  isGridCell(cell: RouteCell): boolean;
}

const metres = (m: number): string => `${m.toFixed(1)} m`;

/**
 * Why `tower` has or has no target among `enemies`, as one line, or null
 * when none of them is near it: within its range and the candidate margin
 * (COMBAT_TUNING.rangeMargin.standard), and of a kind it can shoot at.
 * Bodies along the route (the ooze) are left out: they are in no cell, the
 * tower finds them through BodyAim.
 *
 * Without a target the first reason that holds, in the order the combat
 * loop meets them (TowerCombatService.updateTowerShooting): LOS not
 * resolved yet, no near enemy in a cell of its visibleCells (and what those
 * cells say for it), candidates only beyond its range, or candidates in
 * range not taken yet (a tower takes one in its next turn). A sleeping
 * tower gets the same analysis behind "asleep, ": one that wakes and finds
 * no target sleeps again in the same sub-step, so "asleep" alone says
 * nothing about why. Visible cells a rebuild of the grid replaced are
 * counted at the end: no enemy stands in them any more.
 * With a target, what holds its fire: the cooldown and, for a projectile
 * tower, the turret alignment gate.
 */
export function explainTowerTarget(tower: Tower, enemies: readonly Enemy[], lookup: TowerTargetLookup): string | null {
  const range = tower.combat.range;
  const reach = range * COMBAT_TUNING.rangeMargin.standard;
  const typeId = tower.typeConfig.id as TowerTypeId;
  // Air as far as research could open it: the console does not know the research
  const air = canTargetAirEffective(typeId, true);
  const ground = tower.typeConfig.canTargetGround ?? true;
  const near: { enemy: Enemy; distance: number }[] = [];
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.body) continue;
    if (enemy.typeConfig.isAirUnit ? !air : !ground) continue;
    const distance = geoDistanceFast(tower.position, enemy.position);
    if (distance <= reach) near.push({ enemy, distance });
  }
  if (near.length === 0) return null;

  const head = `${tower.id} ${typeId}`;
  const target = tower.currentTarget;
  if (target?.alive) {
    const holds: string[] = [];
    const cooldown = tower.combat.cooldownRemaining;
    if (cooldown > 0) holds.push(`cooldown ${(cooldown / 1000).toFixed(1)} s`);
    const projectile = (tower.typeConfig.attackType ?? 'projectile') === 'projectile';
    if (projectile && !isAimAligned(tower.aim)) holds.push('turret not aligned');
    const at = target.body ? '' : ` at ${metres(geoDistanceFast(tower.position, target.position))}`;
    return `${head}: target ${target.typeConfig.id} ${target.id}${at}, ${holds.length > 0 ? holds.join(', ') : 'free to fire'}`;
  }
  if (!tower.losReady) return `${head}: no target, LOS not resolved yet`;
  const why = `${head}: no target, ${tower.isSleeping ? 'asleep, ' : ''}`;
  let replaced = 0;
  for (const cell of tower.visibleCells) if (!lookup.isGridCell(cell)) replaced++;
  const gone = replaced > 0 ? `, ${replaced} of ${tower.visibleCells.length} visibleCells not in the grid any more` : '';

  const visible = new Set(tower.visibleCells);
  let blocked = 0;
  let noEntry = 0;
  let unlisted = 0;
  let offGrid = 0;
  const candidates: number[] = [];
  for (const { enemy, distance } of near) {
    const cell = lookup.cellOf(enemy);
    if (!cell) {
      offGrid++;
    } else if (visible.has(cell)) {
      candidates.push(distance);
    } else {
      const answer = cell.towerVisibility.get(tower.id);
      if (answer === undefined) noEntry++;
      else if (answer) unlisted++;
      else blocked++;
    }
  }
  if (candidates.length === 0) {
    return `${why}no candidate in visibleCells (${near.length} near: ${blocked} in cells it does not see, ` +
      `${noEntry} in cells without its LOS entry, ${unlisted} in cells it sees but missing from visibleCells, ${offGrid} off the grid)${gone}`;
  }
  const nearest = Math.min(...candidates);
  if (nearest > range) return `${why}candidates only beyond its range (nearest ${metres(nearest)} of ${metres(range)})${gone}`;
  return `${why}${candidates.length} candidate(s) in range not taken yet (nearest ${metres(nearest)})${gone}`;
}

/** What TowerTargetConsole needs; VisualizationFacadeService passes its services. */
export interface TowerTargetConsoleDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerManager' | 'enemyManager' | 'getGlobalRouteGrid' | 'getEventBus'>;
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
}

/**
 * Tower targeting probe for playtests, analog zu `__corridor`, in DevTools:
 * `__towerTargets()` prints a table of every tower with an enemy near it
 * and why it has or has no target (explainTowerTarget);
 * `__towerTargets.watch()` logs one line per tower near the clumps each
 * second, for WATCH_SECONDS after each ooze breaks up, the first a second
 * after the split (the clumps join the route cells in the next sub-step);
 * two oozes breaking up within that time are followed side by side, each
 * second's head line names the ooze. `__towerTargets.watch(false)` stops.
 * Reads only. Off it holds no subscription and no timer.
 */
export class TowerTargetConsole {
  /** The `__towerTargets` this instance registered, see uninstall(). */
  private api: object | null = null;
  private splitSub: { dispose(): void } | null = null;
  /** One timer per ooze followed, see follow(). */
  private readonly timers = new Set<ReturnType<typeof setInterval>>();

  constructor(private readonly deps: TowerTargetConsoleDeps) {}

  /** Register `__towerTargets` on globalThis, replacing the one of a previous location. */
  install(): void {
    this.api = Object.assign(() => this.table(), { watch: (on = true) => this.watch(on) });
    (globalThis as Record<string, unknown>)['__towerTargets'] = this.api;
  }

  /** Stop watching and remove `__towerTargets`, unless another instance has registered its own since. */
  uninstall(): void {
    this.watch(false);
    const global = globalThis as Record<string, unknown>;
    if (this.api && global['__towerTargets'] === this.api) delete global['__towerTargets'];
    this.api = null;
  }

  /** The route cells as the live game answers them, null without a location. */
  private lookup(): TowerTargetLookup | null {
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return null;
    const grid = this.deps.gameState().getGlobalRouteGrid();
    return {
      cellOf: (enemy) => {
        const local = engine.sync.geoToLocalSimple(enemy.position.lat, enemy.position.lon, 0);
        return grid.getCellAt(local.x, local.z);
      },
      isGridCell: (cell) => grid.getCellAt(cell.x, cell.z) === cell,
    };
  }

  /** `__towerTargets()`: one row per tower with an enemy near it. */
  private table(): string {
    const lookup = this.lookup();
    if (!lookup) return 'No location loaded.';
    const gameState = this.deps.gameState();
    const enemies = gameState.enemyManager.getAlive();
    const rows: Record<string, string | number | boolean>[] = [];
    for (const tower of gameState.towerManager.getAllActive()) {
      const line = explainTowerTarget(tower, enemies, lookup);
      if (line === null) continue;
      rows.push({
        tower: tower.id,
        why: line.slice(line.indexOf(': ') + 2),
        sleeping: tower.isSleeping,
        visibleCells: tower.visibleCells.length,
      });
    }
    console.table(rows);
    return `${rows.length} tower(s) with an enemy near.`;
  }

  /** `__towerTargets.watch(on)`: follow the clumps of each ooze that breaks up from now on, or stop. */
  private watch(on: boolean): string {
    if (!on) {
      this.splitSub?.dispose();
      this.splitSub = null;
      this.stopFollowing();
      return 'Not watching.';
    }
    this.splitSub ??= this.deps.gameState().getEventBus().on('enemy:split', (event) => {
      if (event.enemy.body !== null) this.follow(event.enemy, event.children);
    });
    return `Watching: after each ooze breaks up, a line per tower near its clumps every second for ${WATCH_SECONDS} s.`;
  }

  /** The towers near the clumps `ooze` broke into, each second, beside any ooze still followed. */
  private follow(ooze: Enemy, clumps: readonly Enemy[]): void {
    let second = 0;
    const timer = setInterval(() => {
      second++;
      const lookup = this.lookup();
      const alive = clumps.filter((clump) => clump.alive);
      if (lookup === null || alive.length === 0 || second > WATCH_SECONDS) {
        if (alive.length === 0) console.log(`[TowerTargets] ${ooze.id}: all clumps gone`);
        clearInterval(timer);
        this.timers.delete(timer);
        return;
      }
      console.log(`[TowerTargets] ${ooze.id} +${second} s, ${alive.length} clump(s)`);
      for (const tower of this.deps.gameState().towerManager.getAllActive()) {
        const line = explainTowerTarget(tower, alive, lookup);
        if (line !== null) console.log(`[TowerTargets] ${line}`);
      }
    }, 1000);
    this.timers.add(timer);
  }

  private stopFollowing(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
  }
}
