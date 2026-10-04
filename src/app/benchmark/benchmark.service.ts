import { Injectable, inject, signal } from '@angular/core';
import { GameLoopFacadeService, type LoadHandle } from '../services/facade/game-loop-facade.service';
import { IntroCameraFlightService } from '../services/world/intro-camera-flight.service';
import { SimClient } from '../sim/client/sim-client.service';
import { PacketSums, loadRates } from '../sim/client/load-stats';
import { sharedMemoryAvailable } from '../sim/protocol/table-store';
import { BUILD_VERSION } from '../configs/build-info.config';
import {
  frameStats, placeTowers, routeSlices, settle, spawnUpTo, startLoadWave, type LoadDriver,
} from './load-scene';
import {
  DEFAULT_BENCHMARK_PLAN, benchmarkUrl, browserOf, isBenchmarkSearch, osOf, shortGpu,
  type BenchmarkEnv, type BenchmarkPlan, type BenchmarkRow,
} from './benchmark-report';

export type BenchmarkPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'failed';

/** What the benchmark panel shows */
export interface BenchmarkState {
  phase: BenchmarkPhase;
  /** The measurement under way, 1 based, of `total` */
  index: number;
  total: number;
  /** What it does right now, e.g. "5,000 enemies at 4x: settling" */
  doing: string;
  env: BenchmarkEnv | null;
  rows: BenchmarkRow[];
  error: string | null;
}

const IDLE: BenchmarkState = { phase: 'idle', index: 0, total: 0, doing: '', env: null, rows: [], error: null };

/**
 * The in-game benchmark (TODO E74, docs/SIM_WORKER.md "Benchmark im Spiel").
 *
 * The game menu's entry reloads the page into the DevWorld with the URL flag
 * (benchmarkUrl): a fresh game on the same world every time, from a real map
 * as well as from the DevWorld, without tiles or a map session. Once the game
 * stands, the component calls runIfRequested(): the flag goes from the URL
 * (a reload plays normally), the scene of the load runner is built through
 * the same steps (load-scene.ts: towers along the routes, enemies with a
 * million HP walking at 0.5 m/s, settle), and every step of the
 * plan is measured at every speed. The panel shows the table at the end;
 * its button copies formatBenchmark's text.
 *
 * Scoped to the game component, next to the GameLoopFacadeService whose
 * load handle it drives.
 */
/** sessionStorage: the page the menu's entry left, to come back to */
const RETURN_KEY = '3dtd-benchmark-return';

function readReturnHref(): string | null {
  try {
    const href = sessionStorage.getItem(RETURN_KEY);
    return href && new URL(href).origin === location.origin ? href : null;
  } catch {
    return null;
  }
}

@Injectable()
export class BenchmarkService {
  private readonly loop = inject(GameLoopFacadeService);
  private readonly intro = inject(IntroCameraFlightService);
  private readonly sim = inject(SimClient);

  /** This page was loaded to run the benchmark */
  readonly requested = isBenchmarkSearch(location.search);
  /** Where the menu's entry came from (its URL carries the place): the panel offers the way back */
  readonly returnHref = this.requested ? readReturnHref() : null;
  readonly state = signal<BenchmarkState>(IDLE);
  private cancelRequested = false;

  /** The menu's entry: reload into the DevWorld with the flag */
  start(): void {
    try {
      sessionStorage.setItem(RETURN_KEY, location.href);
    } catch {
      // No storage: the panel only closes afterwards
    }
    location.assign(benchmarkUrl(location.href));
  }

  cancel(): void {
    this.cancelRequested = true;
  }

  /** The panel's Close: the results go; back to the place the benchmark was started from, if known */
  dismiss(): void {
    this.state.set(IDLE);
    const back = this.returnHref;
    if (!back) return;
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      // nothing to clean up
    }
    location.assign(back);
  }

  /** Once the game stands: run if the page was loaded for it, once */
  runIfRequested(plan: BenchmarkPlan = DEFAULT_BENCHMARK_PLAN): void {
    if (!this.requested || this.state().phase !== 'idle') return;
    // A reload after this plays normally
    const url = new URL(location.href);
    url.searchParams.delete('benchmark');
    history.replaceState(history.state, '', url.toString());
    void this.run(plan);
  }

  private async run(plan: BenchmarkPlan): Promise<void> {
    const total = plan.steps.length * plan.speeds.length;
    this.cancelRequested = false;
    this.state.set({ ...IDLE, phase: 'running', total, doing: 'waiting for the world' });
    try {
      const handle = await this.waitForGame();
      const driver = this.driver(handle);
      const start = handle.state();
      await driver.emit({ type: 'debug:add-credits', amount: 1_000_000 });
      await driver.emit({ type: 'debug:add-health', amount: 1_000_000 });
      this.doing('placing towers');
      await placeTowers(driver, start.paths, plan.towers);
      const env = await this.environment(handle.state().towers);
      this.state.update((s) => ({ ...s, env }));
      await startLoadWave(driver);
      const slices = routeSlices(start.paths);
      const at = { slice: 0 };

      let index = 0;
      for (const target of plan.steps) {
        for (const speed of plan.speeds) {
          if (this.cancelRequested) break;
          index++;
          const label = `${target.toLocaleString('en-US')} enemies at ${speed}x`;
          this.state.update((s) => ({ ...s, index }));
          handle.speed(speed);
          this.doing(`${label}: filling`);
          await spawnUpTo(driver, slices, target, at);
          this.doing(`${label}: settling`);
          const settled = await settle(driver);
          if (this.cancelRequested) break;
          this.doing(`${label}: measuring`);
          const row = await this.measure(handle, target, speed, plan.seconds);
          this.state.update((s) => ({ ...s, rows: [...s.rows, { ...row, settled }] }));
        }
      }
      // The load stays, at speed 1, while the results are read
      handle.speed(1);
      this.state.update((s) => ({ ...s, phase: this.cancelRequested ? 'cancelled' : 'done', doing: '' }));
    } catch (error) {
      console.error('[Benchmark]', error);
      this.state.update((s) => ({ ...s, phase: 'failed', error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private doing(doing: string): void {
    this.state.update((s) => ({ ...s, doing }));
  }

  /** The load handle once the world stands with its routes, the intro flight cut short */
  private async waitForGame(): Promise<LoadHandle> {
    const until = performance.now() + 120_000;
    for (;;) {
      if (this.intro.isRunning()) this.intro.cancel('benchmark');
      const handle = this.loop.loadHandle;
      if (handle && this.sim.hasWorld && handle.state().paths.length > 0 && !this.intro.isRunning()) {
        // The intro's camera settles and the first packets arrive
        await wait(1000);
        return handle;
      }
      if (performance.now() > until) throw new Error('the DevWorld did not come up within 2 minutes');
      await wait(500);
    }
  }

  private driver(handle: LoadHandle): LoadDriver {
    return {
      state: async () => handle.state(),
      emit: async (command) => handle.emit(command as { type: string }),
      groundAt: async (lat, lon) => handle.groundAt(lat, lon),
      fpsOver: (ms) => fpsOver(ms),
      wait,
      // A call to the simulation answers after the commands given before it ran
      sync: async () => {
        await handle.ping();
      },
      log: () => undefined,
      cancelled: () => this.cancelRequested,
    };
  }

  /** One measurement over `seconds`: frames on this thread, the packets' sums, the game time moved */
  private async measure(handle: LoadHandle, target: number, speed: number, seconds: number): Promise<Omit<BenchmarkRow, 'settled'>> {
    const sums = new PacketSums(this.sim);
    sums.start();
    const times = await frameTimes(seconds * 1000);
    const window = sums.take();
    sums.stop();
    const rates = loadRates(window);
    const frames = frameStats(times);
    return {
      enemiesAsked: target,
      enemies: handle.state().enemies,
      speedSet: speed,
      fps: frames.fps,
      p05: frames.p05,
      speed: rates.speed,
      ticksPerS: rates.packetsPerS,
      workerLoad: rates.workerLoad,
      applyPerPacketMs: rates.applyPerPacketMs,
    };
  }

  /** The page and machine: build-info.json, the user agent, WebGL's GPU name, the window */
  private async environment(towers: number): Promise<BenchmarkEnv> {
    const build = await fetch('build-info.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as { version?: string; commit?: string; dirty?: boolean } | null;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      date: new Date().toISOString(),
      version: build?.version ? `v${build.version}` : BUILD_VERSION,
      commit: build?.commit ?? 'unknown',
      dirty: build?.dirty ?? null,
      browser: browserOf(nav.userAgent),
      os: osOf(nav.userAgent),
      threads: nav.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
      gpu: gpuName(),
      devicePixelRatio: Math.round(devicePixelRatio * 100) / 100,
      viewport: [innerWidth, innerHeight],
      sharedMemory: sharedMemoryAvailable(),
      towers,
    };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The rAF times over `ms` of wall clock */
function frameTimes(ms: number): Promise<number[]> {
  return new Promise((resolve) => {
    const times: number[] = [];
    const end = performance.now() + ms;
    const tick = (t: number) => {
      times.push(t);
      if (t < end) requestAnimationFrame(tick);
      else resolve(times);
    };
    requestAnimationFrame(tick);
  });
}

async function fpsOver(ms: number): Promise<number> {
  const times = await frameTimes(ms);
  return frameStats(times).fps;
}

/** The GPU as WebGL names it (Firefox rounds it to a common model on purpose) */
function gpuName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL2';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return shortGpu(name);
}
