import { Injectable, inject, signal } from '@angular/core';
import type { ThreeTilesEngine } from '../../three-engine';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { GameStore } from '../../store/game.store';
import { perfTrace } from '../../utils/perf-trace';
import { SimClient } from '../../sim/client/sim-client.service';
import { PacketSums, loadRates, type LoadStats } from '../../sim/client/load-stats';
import type { SimProfileSums } from '../../sim/protocol/messages';

/** Main-thread ms of applying one packet, by part (SimClient.applyTimes), and all of them */
export type ApplyParts = LoadStats['apply'] & { total: number };

/** The worker's time by part, ms per tick (rpc profileSums) */
export interface SimParts {
  tickMs: number;
  commandsMs: number;
  /** The sub-steps, split below; `otherMs` is what no part names (spawns, research, abilities, towers aiming, hero) */
  updateMs: number;
  enemyMs: number;
  enemyMoveMs: number;
  enemyGridMs: number;
  enemyHeightMs: number;
  projectileMs: number;
  combatMs: number;
  eventsMs: number;
  otherMs: number;
  packetMs: number;
}

/**
 * What the perf panel shows (TODO E82): the frame on this thread, the apply
 * of the simulation's packets, the simulation in the worker by part. Times
 * are means over the panel's window: ms per drawn frame on this thread, ms
 * per packet for the apply, ms per tick in the worker (one tick per packet).
 */
export interface PerformanceStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  enemies: number;
  towers: number;
  projectiles: number;
  geometries: number;
  textures: number;
  /** Compiled shader programs. Climbing mid-game means programs are being rebuilt. */
  programs: number;

  /** Main thread per drawn frame: the game loop (the apply included) and render() */
  frameMs: number;
  updateMs: number;
  renderMs: number;
  /** Share of the wall time this thread spent in frames, % */
  mainBusyPct: number;
  apply: ApplyParts;

  /** Speed reached against the speed set */
  speed: number;
  speedSet: number;
  ticksPerS: number;
  subStepsPerTick: number;
  /** Share of the wall time the worker spent in ticks, % (SimScalars.tickMs, no timer of its own) */
  workerLoadPct: number;
  /** The worker by part, ms per tick; null until its first sums came back */
  sim: SimParts | null;

  /** The busier of the two threads */
  bottleneck: 'worker' | 'main';
}

const EMPTY_STATS: PerformanceStats = {
  fps: 0, drawCalls: 0, triangles: 0,
  enemies: 0, towers: 0, projectiles: 0,
  geometries: 0, textures: 0, programs: 0,
  frameMs: 0, updateMs: 0, renderMs: 0, mainBusyPct: 0,
  apply: { state: 0, ops: 0, events: 0, present: 0, listeners: 0, total: 0 },
  speed: 0, speedSet: 0, ticksPerS: 0, subStepsPerTick: 0, workerLoadPct: 0, sim: null,
  bottleneck: 'main',
};

/** The worker's sums as ms per tick; null for a window without a tick */
export function simPartsPerTick(sums: SimProfileSums): SimParts | null {
  if (sums.ticks === 0) return null;
  const per = (ms: number) => ms / sums.ticks;
  const named = sums.enemyMs + sums.projectileMs + sums.combatMs + sums.eventsMs;
  return {
    tickMs: per(sums.tickMs),
    commandsMs: per(sums.commandsMs),
    updateMs: per(sums.updateMs),
    enemyMs: per(sums.enemyMs),
    enemyMoveMs: per(sums.enemyMoveMs),
    enemyGridMs: per(sums.enemyGridMs),
    enemyHeightMs: per(sums.enemyHeightMs),
    projectileMs: per(sums.projectileMs),
    combatMs: per(sums.combatMs),
    eventsMs: per(sums.eventsMs),
    otherMs: per(Math.max(0, sums.updateMs - named)),
    packetMs: per(sums.packetMs),
  };
}

/**
 * PerformanceProfilerService
 *
 * The numbers of the Performance debug panel (TODO E82). The simulation runs
 * in the worker (docs/SIM_WORKER.md), so they come from three places, and
 * their timers run only while the panel is open (setProfilingActive):
 *
 * - the worker by part: SimConfig.profile sets a profiler on the
 *   GameStateManager there (sim/core/sim-profile.ts), the panel fetches its
 *   sums by rpc (profileSums). The enemy phases are sampled estimates
 *   (EnemyManager PROFILE_STRIDE), the enemy total is measured;
 * - the apply of each packet on this thread: SimClient.applyTimes, taken on
 *   every packet anyway, summed by PacketSums;
 * - this thread's frame: RenderLoop.setTiming times update() and render().
 *
 * Console logging can be toggled via the UI.
 */
@Injectable({ providedIn: 'root' })
export class PerformanceProfilerService {
  private readonly gameStore = inject(GameStore);
  private engine: ThreeTilesEngine | null = null;
  private readonly mirror = inject(SimMirror);
  private readonly sim = inject(SimClient);
  private profilingActive = false;
  /** The packets' apply times and the worker's tick times, summed while the panel is open */
  private readonly packets = new PacketSums(this.sim);
  /** The worker's parts of the last window that had ticks */
  private simParts: SimParts | null = null;

  /** Toggle for console profiling output */
  readonly consoleLogEnabled = signal(false);

  /** Latest collected stats (updated by the panel while it is open) */
  readonly stats = signal<PerformanceStats>(EMPTY_STATS);

  // Console log timer
  private _logTimer = 0;

  /**
   * Set the engine reference.
   * Called after engine initialization.
   */
  setEngine(engine: ThreeTilesEngine | null): void {
    this.engine = engine;
    engine?.renderLoop.setTiming(this.profilingActive);
    this.exposeDebugApi();
  }

  /**
   * DevTools handle for performance work: `__perf.setRendering(false)`
   * keeps the simulation running while the render path is skipped, which
   * separates JS cost from render + GPU cost without any new instrumentation.
   *
   * The header has a button for this too, but only in DevWorld — and the
   * split is exactly as interesting on real tiles.
   *
   * `__perf.stats()` returns the same numbers the panel shows; note they are
   * only collected while the panel is open, and that its timers (the worker's
   * parts, the frame) add a little cost of their own while it is.
   *
   * `__perf.shakeBench(seconds = 5)` measures the screen shake: no shake,
   * shake running, camera moved every frame (the pre-2026-09-12 shake), each
   * for `seconds`. Logs a table and resolves with its rows, see
   * ThreeTilesEngine.runShakeBenchmark. Keep the camera still meanwhile.
   *
   * `__perf.trace(on = true)` prints the `[PerfTrace]` lines of every tile
   * load and height sweep, off by default (perf-trace.ts).
   *
   * `__perf.loseContext(ms = 2000)` loses the WebGL context through
   * renderer.forceContextLoss() and restores it `ms` later
   * (forceContextRestore()), to check what comes back, e.g. the enemy VATs
   * InstancedEnemyRenderer bakes again.
   *
   * `__bloom.marks(on = true)` paints every NaN pixel the scene writes as a
   * magenta square and every infinite one cyan, with bloom on or off
   * (PostProcessingPipeline.setPixelMarks); where a square shows, a shader
   * writes values the bloom would spread into a black block.
   * `__bloom.guard(on = true)` turns the bloom's guard against them
   * (bloom-guard.ts) on or off, off only to compare with the old bloom.
   */
  private exposeDebugApi(): void {
    (globalThis as Record<string, unknown>)['__bloom'] = {
      marks: (on = true) => this.engine?.setPixelMarks(on) ?? false,
      guard: (on = true) => this.engine?.setBloomGuard(on) ?? false,
    };
    (globalThis as Record<string, unknown>)['__perf'] = {
      trace: (on = true) => {
        perfTrace.enabled = on;
        return `[PerfTrace] lines ${on ? 'on' : 'off'}`;
      },
      setRendering: (enabled: boolean) => {
        this.gameStore.renderingEnabled.set(enabled);
        return enabled;
      },
      isRendering: () => this.gameStore.renderingEnabled(),
      stats: () => this.stats(),
      shakeBench: async (seconds = 5) => {
        if (!this.engine) return null;
        console.log(`[Perf] Shake benchmark: 3 phases of ${seconds} s, keep the camera still`);
        const rows = await this.engine.runShakeBenchmark(seconds);
        console.table(rows);
        return rows;
      },
      loseContext: (ms = 2000) => {
        const renderer = this.engine?.getRenderer();
        if (!renderer) return false;
        renderer.forceContextLoss();
        setTimeout(() => renderer.forceContextRestore(), ms);
        return true;
      },
    };
  }

  /**
   * The perf panel opened or closed: the worker's profiler, the frame timer
   * and the packet sums go on or off with it. Closed, none of them runs.
   */
  setProfilingActive(active: boolean): void {
    if (this.profilingActive === active) return;
    this.profilingActive = active;
    if (this.sim.started) this.sim.configure({ profile: active });
    this.engine?.renderLoop.setTiming(active);
    this.simParts = null;
    if (active) this.packets.start();
    else this.packets.stop();
  }

  /**
   * The stats of the window since the last call. Called by the
   * PerformanceDebuggerComponent while the panel is open.
   */
  async collectStats(): Promise<PerformanceStats> {
    const engine = this.engine;
    if (!engine || !this.profilingActive) return EMPTY_STATS;

    // The worker's parts. None while it runs without the profiler (a worker
    // started after the panel opened): switch it on, the next window has them
    let sums: SimProfileSums | null = null;
    if (this.sim.started) {
      sums = await this.sim.rpc('profileSums').catch(() => null);
      if (!sums && this.profilingActive) this.sim.configure({ profile: true });
    }
    const parts = sums ? simPartsPerTick(sums) : null;
    if (parts) this.simParts = parts;

    const window = this.packets.take(true);
    const rates = loadRates(window);
    const frame = engine.renderLoop.takeTiming();
    const frames = Math.max(1, frame?.frames ?? 0);
    const updateMs = (frame?.updateMs ?? 0) / frames;
    const renderMs = (frame?.renderMs ?? 0) / frames;
    const mainBusy = frame && window.wallMs > 0 ? (frame.updateMs + frame.renderMs) / window.wallMs : 0;
    const packets = Math.max(1, window.packets);
    const applies = Math.max(1, window.applies);
    const apply = window.apply;
    const applyTotal = apply.state + apply.ops + apply.events + apply.present + apply.listeners;

    const info = engine.getRenderer().info;
    const stats: PerformanceStats = {
      fps: engine.renderLoop.getFPS(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      enemies: this.mirror.scalars.enemiesAlive,
      towers: this.mirror.scalars.towerCount,
      projectiles: engine.projectiles.count,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      frameMs: updateMs + renderMs,
      updateMs,
      renderMs,
      mainBusyPct: mainBusy * 100,
      apply: {
        state: apply.state / applies,
        ops: apply.ops / applies,
        events: apply.events / applies,
        present: apply.present / applies,
        listeners: apply.listeners / applies,
        total: applyTotal / applies,
      },
      speed: rates.speed,
      speedSet: this.gameStore.gameSpeed(),
      ticksPerS: rates.packetsPerS,
      subStepsPerTick: window.subSteps / packets,
      workerLoadPct: rates.workerLoad * 100,
      sim: this.simParts,
      bottleneck: rates.workerLoad > mainBusy ? 'worker' : 'main',
    };

    this.stats.set(stats);
    return stats;
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
      const sim = s.sim;
      console.log(
        `[Perf] ${s.enemies} enemies | ${s.fps} FPS | ${s.drawCalls} draws | ${tris} tris | ` +
        `main: frame ${s.frameMs.toFixed(2)} ms (update ${s.updateMs.toFixed(2)}, render ${s.renderMs.toFixed(2)}), ` +
        `apply ${s.apply.total.toFixed(2)} ms/packet, busy ${s.mainBusyPct.toFixed(0)}% | ` +
        `worker: ${s.ticksPerS.toFixed(0)} ticks/s, load ${s.workerLoadPct.toFixed(0)}%` +
        (sim
          ? `, tick ${sim.tickMs.toFixed(2)} ms (enemy ${sim.enemyMs.toFixed(2)}, projectile ${sim.projectileMs.toFixed(2)}, ` +
            `combat ${sim.combatMs.toFixed(2)}, events ${sim.eventsMs.toFixed(2)}, other ${sim.otherMs.toFixed(2)}, ` +
            `packet ${sim.packetMs.toFixed(2)})`
          : '') +
        ` | speed ${s.speed.toFixed(2)}/${s.speedSet} | ${s.towers} towers | ${s.projectiles} proj | ` +
        `mem: ${s.geometries} geo, ${s.textures} tex, ${s.programs} programs`
      );
    }
  }
}
