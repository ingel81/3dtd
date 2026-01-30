import { Injectable, signal } from '@angular/core';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';

export interface PerformanceStats {
  // Rendering
  fps: number;
  drawCalls: number;
  triangles: number;
  // Entities
  enemies: number;
  towers: number;
  projectiles: number;
  // Memory
  geometries: number;
  textures: number;
  // Enemy Update Breakdown (avg ms per frame)
  enemyMove: number;
  enemyGrid: number;
  enemyHeight: number;
  enemyRender: number;
  enemyTotal: number;
}

const EMPTY_STATS: PerformanceStats = {
  fps: 0, drawCalls: 0, triangles: 0,
  enemies: 0, towers: 0, projectiles: 0,
  geometries: 0, textures: 0,
  enemyMove: 0, enemyGrid: 0, enemyHeight: 0, enemyRender: 0, enemyTotal: 0,
};

/**
 * PerformanceProfilerService
 *
 * Collects engine-wide performance metrics and provides them
 * to the Performance debug panel. Enemy update timings are
 * accumulated per frame by EnemyManager and averaged here.
 *
 * Console logging can be toggled via the UI.
 */
@Injectable({ providedIn: 'root' })
export class PerformanceProfilerService {
  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;

  /** Toggle for console profiling output */
  readonly consoleLogEnabled = signal(false);

  /** Latest collected stats (updated ~10 Hz by the component) */
  readonly stats = signal<PerformanceStats>(EMPTY_STATS);

  // Enemy timing accumulator (written by EnemyManager every frame)
  private _enemyAcc = { move: 0, grid: 0, height: 0, render: 0, total: 0, frames: 0 };

  // Console log timer
  private _logTimer = 0;

  /**
   * Set engine and game state references.
   * Called after engine initialization.
   */
  setEngine(engine: ThreeTilesEngine | null, gameState?: GameStateManager): void {
    this.engine = engine;
    if (gameState) this.gameState = gameState;
  }

  /**
   * Called by EnemyManager every frame to accumulate timing data.
   * Costs are negligible (just additions).
   */
  accumulateEnemyTiming(move: number, grid: number, height: number, render: number, total: number): void {
    const a = this._enemyAcc;
    a.move += move;
    a.grid += grid;
    a.height += height;
    a.render += render;
    a.total += total;
    a.frames++;
  }

  /**
   * Collect all performance stats from the engine.
   * Called ~10 Hz by the PerformanceDebuggerComponent.
   */
  collectStats(): PerformanceStats {
    const engine = this.engine;
    const gs = this.gameState;
    if (!engine) return EMPTY_STATS;

    const renderer = engine.getRenderer();
    const info = renderer.info;
    const a = this._enemyAcc;
    const f = a.frames || 1;

    const stats: PerformanceStats = {
      fps: engine.getFPS(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      enemies: gs?.enemyManager.getAliveCount() ?? 0,
      towers: gs?.towerCount() ?? 0,
      projectiles: engine.projectiles.count,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      enemyMove: a.move / f,
      enemyGrid: a.grid / f,
      enemyHeight: a.height / f,
      enemyRender: a.render / f,
      enemyTotal: a.total / f,
    };

    this.stats.set(stats);
    return stats;
  }

  /**
   * Reset enemy timing accumulator.
   * Called after stats are collected to start fresh averaging window.
   */
  resetEnemyTimings(): void {
    this._enemyAcc = { move: 0, grid: 0, height: 0, render: 0, total: 0, frames: 0 };
  }

  /**
   * Called from game loop with deltaTime to handle console log timing.
   */
  tick(deltaTime: number): void {
    if (!this.consoleLogEnabled()) return;

    this._logTimer += deltaTime;
    if (this._logTimer >= 2000) {
      this._logTimer = 0;
      const s = this.stats();
      const tris = s.triangles >= 1_000_000
        ? `${(s.triangles / 1_000_000).toFixed(1)}M`
        : `${(s.triangles / 1_000).toFixed(0)}K`;
      console.log(
        `[Perf] ${s.enemies} enemies | ${s.fps} FPS | ` +
        `${s.drawCalls} draws | ${tris} tris | ` +
        `move:${s.enemyMove.toFixed(2)} grid:${s.enemyGrid.toFixed(2)} ` +
        `height:${s.enemyHeight.toFixed(2)} render:${s.enemyRender.toFixed(2)} ` +
        `TOTAL:${s.enemyTotal.toFixed(2)}ms | ` +
        `${s.towers} towers | ${s.projectiles} proj | ` +
        `mem: ${s.geometries} geo, ${s.textures} tex`
      );
    }
  }
}
