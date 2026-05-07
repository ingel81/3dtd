import { Injectable, signal } from '@angular/core';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';

/** Subsystem names for timing & bottleneck detection */
export type Subsystem = 'enemy' | 'tower' | 'projectile' | 'combat' | 'events' | 'other';

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
  // Manager Update Timings (avg ms per frame)
  towerUpdate: number;
  projectileUpdate: number;
  combatUpdate: number;
  eventProcessing: number;
  // Frame Budget
  frameTime: number;           // Total game-loop time (ms)
  frameBudgetPct: number;      // % of 16.67ms budget used
  // Bottleneck Detection
  bottleneck: Subsystem;       // Which subsystem took the most time
  bottleneckMs: number;        // How much time that subsystem took
}

const EMPTY_STATS: PerformanceStats = {
  fps: 0, drawCalls: 0, triangles: 0,
  enemies: 0, towers: 0, projectiles: 0,
  geometries: 0, textures: 0,
  enemyMove: 0, enemyGrid: 0, enemyHeight: 0, enemyRender: 0, enemyTotal: 0,
  towerUpdate: 0, projectileUpdate: 0, combatUpdate: 0, eventProcessing: 0,
  frameTime: 0, frameBudgetPct: 0,
  bottleneck: 'other', bottleneckMs: 0,
};

/** Target frame time for 60fps */
const FRAME_BUDGET_MS = 16.67;

/**
 * PerformanceProfilerService
 *
 * Collects engine-wide performance metrics and provides them
 * to the Performance debug panel. Timing data is accumulated
 * per-frame by managers and the game loop, then averaged here.
 *
 * Tracks:
 * - Enemy update breakdown (move/grid/height/render)
 * - Manager update timings (tower, projectile, combat, events)
 * - Frame budget (total frame time, % used of 16.67ms)
 * - Bottleneck detection (which subsystem is slowest)
 *
 * Console logging can be toggled via the UI.
 */
@Injectable({ providedIn: 'root' })
export class PerformanceProfilerService {
  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;
  // Profiling is opt-in: per-enemy performance.now() calls cost ~20% CPU
  // at 10k enemies, so we only wire the timing hooks while the perf panel
  // is open. Stays false until setProfilingActive(true) is called.
  private profilingActive = false;

  /** Toggle for console profiling output */
  readonly consoleLogEnabled = signal(false);

  /** Latest collected stats (updated ~10 Hz by the component) */
  readonly stats = signal<PerformanceStats>(EMPTY_STATS);

  // Enemy timing accumulator (written by EnemyManager every frame)
  private _enemyAcc = { move: 0, grid: 0, height: 0, render: 0, total: 0, frames: 0 };

  // Manager timing accumulators (written by GameStateManager every frame)
  private _towerAcc = { total: 0, frames: 0 };
  private _projectileAcc = { total: 0, frames: 0 };
  private _combatAcc = { total: 0, frames: 0 };
  private _eventsAcc = { total: 0, frames: 0 };

  // Frame timing accumulator
  private _frameAcc = { total: 0, frames: 0 };

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
   * Wire / unwire the per-frame timing callbacks. Called by the perf panel
   * on open/close so the hot-path (per-enemy performance.now()) is silent
   * during normal gameplay.
   */
  setProfilingActive(active: boolean): void {
    if (this.profilingActive === active) return;
    this.profilingActive = active;
    const gs = this.gameState;
    if (!gs) return;
    if (active) {
      gs.enemyManager.onProfileTiming = (move, grid, height, render, total) =>
        this.accumulateEnemyTiming(move, grid, height, render, total);
      gs.setProfiler(this);
    } else {
      gs.enemyManager.onProfileTiming = null;
      gs.setProfiler(null);
      this.resetTimings();
    }
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
   * Called by GameStateManager every frame to accumulate subsystem timings.
   * Each parameter is the ms spent in that subsystem this frame.
   */
  accumulateFrameTiming(
    towerMs: number,
    projectileMs: number,
    combatMs: number,
    eventsMs: number,
    totalFrameMs: number,
  ): void {
    this._towerAcc.total += towerMs;
    this._towerAcc.frames++;
    this._projectileAcc.total += projectileMs;
    this._projectileAcc.frames++;
    this._combatAcc.total += combatMs;
    this._combatAcc.frames++;
    this._eventsAcc.total += eventsMs;
    this._eventsAcc.frames++;
    this._frameAcc.total += totalFrameMs;
    this._frameAcc.frames++;
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

    // Enemy timing averages
    const ea = this._enemyAcc;
    const ef = ea.frames || 1;

    // Manager timing averages
    const tf = this._towerAcc.frames || 1;
    const pf = this._projectileAcc.frames || 1;
    const cf = this._combatAcc.frames || 1;
    const evf = this._eventsAcc.frames || 1;
    const ff = this._frameAcc.frames || 1;

    const enemyTotal = ea.total / ef;
    const towerUpdate = this._towerAcc.total / tf;
    const projectileUpdate = this._projectileAcc.total / pf;
    const combatUpdate = this._combatAcc.total / cf;
    const eventProcessing = this._eventsAcc.total / evf;
    const frameTime = this._frameAcc.total / ff;

    // Bottleneck detection — find the subsystem with the highest avg time
    const subsystems: [Subsystem, number][] = [
      ['enemy', enemyTotal],
      ['tower', towerUpdate],
      ['projectile', projectileUpdate],
      ['combat', combatUpdate],
      ['events', eventProcessing],
    ];
    let bottleneck: Subsystem = 'other';
    let bottleneckMs = 0;
    for (const [name, ms] of subsystems) {
      if (ms > bottleneckMs) {
        bottleneck = name;
        bottleneckMs = ms;
      }
    }

    const stats: PerformanceStats = {
      fps: engine.getFPS(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      enemies: gs?.enemyManager.getAliveCount() ?? 0,
      towers: gs?.towerCount() ?? 0,
      projectiles: engine.projectiles.count,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      // Enemy breakdown
      enemyMove: ea.move / ef,
      enemyGrid: ea.grid / ef,
      enemyHeight: ea.height / ef,
      enemyRender: ea.render / ef,
      enemyTotal: enemyTotal,
      // Manager timings
      towerUpdate,
      projectileUpdate,
      combatUpdate,
      eventProcessing,
      // Frame budget
      frameTime,
      frameBudgetPct: (frameTime / FRAME_BUDGET_MS) * 100,
      // Bottleneck
      bottleneck,
      bottleneckMs,
    };

    this.stats.set(stats);
    return stats;
  }

  /**
   * Reset all timing accumulators.
   * Called after stats are collected to start fresh averaging window.
   */
  resetTimings(): void {
    this._enemyAcc = { move: 0, grid: 0, height: 0, render: 0, total: 0, frames: 0 };
    this._towerAcc = { total: 0, frames: 0 };
    this._projectileAcc = { total: 0, frames: 0 };
    this._combatAcc = { total: 0, frames: 0 };
    this._eventsAcc = { total: 0, frames: 0 };
    this._frameAcc = { total: 0, frames: 0 };
  }

  /** @deprecated Use resetTimings() instead */
  resetEnemyTimings(): void {
    this.resetTimings();
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
        `enemy:${s.enemyTotal.toFixed(2)} tower:${s.towerUpdate.toFixed(2)} ` +
        `proj:${s.projectileUpdate.toFixed(2)} combat:${s.combatUpdate.toFixed(2)} ` +
        `events:${s.eventProcessing.toFixed(2)} | ` +
        `frame:${s.frameTime.toFixed(2)}ms (${s.frameBudgetPct.toFixed(0)}%) | ` +
        `bottleneck:${s.bottleneck}(${s.bottleneckMs.toFixed(2)}ms) | ` +
        `${s.towers} towers | ${s.projectiles} proj | ` +
        `mem: ${s.geometries} geo, ${s.textures} tex`
      );
    }
  }
}
