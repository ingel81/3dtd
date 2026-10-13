import { Injectable, inject, signal } from '@angular/core';
import { Vector3 } from 'three';
import { EngineInitializationService } from '../services/infrastructure/engine-initialization.service';
import { IntroCameraFlightService } from '../services/world/intro-camera-flight.service';
import { LocationManagementService } from '../services/location/location-management.service';
import { WorldContext } from '../world/world-context.service';
import { BUILD_VERSION } from '../configs/build-info.config';
import type { ThreeTilesEngine } from '../three-engine/three-tiles-engine';
import { GpuTimer } from './gpu-timer';
import {
  RENDER_VIEWS, RENDER_VIEW_SECONDS, envOf, isRenderBenchmarkSearch, renderBenchmarkUrl, renderRow, viewPose,
  type Pose, type RenderBenchEnv, type RenderRow, type Vec3,
} from './render-benchmark';

export type RenderBenchPhase = 'idle' | 'running' | 'done' | 'failed';

/** What the render benchmark panel shows */
export interface RenderBenchState {
  phase: RenderBenchPhase;
  /** The view under way, 1 based */
  index: number;
  doing: string;
  env: RenderBenchEnv | null;
  rows: RenderRow[];
  error: string | null;
}

const IDLE: RenderBenchState = { phase: 'idle', index: 0, doing: '', env: null, rows: [], error: null };

/** A view settles this long before it is measured: shadows, LODs and impostors switch, ms */
const SETTLE_MS = 2000;
/** Tiles: the view settles until no tile loads, at most this long, ms */
const TILES_SETTLE_MAX_MS = 20_000;

/**
 * The render benchmark (docs/BENCHMARKS.md "Bildkosten"): on the world the
 * page opened with `benchmark=render` (a place, a custom map, the DevWorld),
 * the camera takes the fixed paths of render-benchmark.ts around the HQ, and
 * each view is measured: time between frames, GPU time of the draw through a
 * timer query (where the browser has one), main thread time, draw calls and
 * triangles over every pass. No game runs: no wave, no enemies, the frame
 * as a player sees the world.
 *
 * The result also lands on `window.__renderBenchmark` for tools/render-bench.
 * Scoped to the game component like BenchmarkService.
 */
@Injectable()
export class RenderBenchmarkService {
  private readonly engineInit = inject(EngineInitializationService);
  private readonly intro = inject(IntroCameraFlightService);
  private readonly location = inject(LocationManagementService);
  private readonly worldContext = inject(WorldContext);

  /** This page was loaded to run it */
  readonly requested = isRenderBenchmarkSearch(location.search);
  readonly state = signal<RenderBenchState>(IDLE);

  /** The menu's entry: this world again, with the flag */
  start(): void {
    location.assign(renderBenchmarkUrl(location.href));
  }

  /** The panel's Close: the flag goes from the URL, the camera is the player's again */
  dismiss(): void {
    this.state.set(IDLE);
  }

  /** Once the game stands: run if the page was loaded for it, once */
  runIfRequested(): void {
    if (!this.requested || this.state().phase !== 'idle') return;
    const url = new URL(location.href);
    url.searchParams.delete('benchmark');
    history.replaceState(history.state, '', url.toString());
    void this.run();
  }

  private async run(): Promise<void> {
    this.state.set({ ...IDLE, phase: 'running', doing: 'waiting for the world' });
    let restore: (() => void) | null = null;
    try {
      const engine = await this.waitForWorld();
      const renderer = engine.getRenderer();
      const camera = engine.getCamera();
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const timer = GpuTimer.create(gl);
      const env = await this.environment(engine, timer !== null);
      this.state.update((s) => ({ ...s, env }));

      // The camera is the benchmark's: the controls stop, the pose comes back at the end
      const controls = engine.getControls();
      const controlsWere = controls?.enabled ?? false;
      if (controls) controls.enabled = false;
      const startPosition = camera.position.clone();
      const startTurn = camera.quaternion.clone();
      const start: Pose = { position: startPosition.toArray(), target: [0, 0, 0] };
      const hq = this.hqLocal(engine);

      // Per frame while a view measures: when its draw began, its counters
      let frame = { starts: [] as number[], calls: [] as number[], triangles: [] as number[], measuring: false };
      const info = renderer.info;
      info.autoReset = false;
      engine.setFrameProbe({
        begin: () => {
          info.reset();
          if (!frame.measuring) return;
          frame.starts.push(performance.now());
          timer?.begin();
        },
        end: () => {
          if (!frame.measuring) return;
          timer?.end();
          frame.calls.push(info.render.calls);
          frame.triangles.push(info.render.triangles);
        },
      });
      let pose: Pose | null = null;
      const look = new Vector3();
      const unhook = engine.addFrameHook(() => {
        if (pose) {
          camera.position.set(...pose.position);
          camera.lookAt(look.set(...pose.target));
        } else {
          camera.position.copy(startPosition);
          camera.quaternion.copy(startTurn);
        }
        camera.updateMatrixWorld();
      });
      restore = () => {
        unhook();
        engine.setFrameProbe(null);
        info.autoReset = true;
        engine.renderLoop.setTiming(false);
        timer?.dispose();
        camera.position.copy(startPosition);
        camera.quaternion.copy(startTurn);
        camera.updateMatrixWorld();
        if (controls) controls.enabled = controlsWere;
      };

      const tiles = !!engine.world.tiles;
      for (const [i, view] of RENDER_VIEWS.entries()) {
        this.state.update((s) => ({ ...s, index: i + 1, doing: `${view.label}: settling` }));
        const measureMs = RENDER_VIEW_SECONDS * 1000;
        // The path's start while it settles, then the path over the measurement
        pose = viewPose(view.id, 0, hq, start);
        await this.settle(engine, tiles);
        this.state.update((s) => ({ ...s, doing: `${view.label}: measuring` }));
        frame = { starts: [], calls: [], triangles: [], measuring: true };
        timer?.take();
        engine.renderLoop.setTiming(true);
        const began = performance.now();
        await new Promise<void>((resolve) => {
          const step = () => {
            const t = (performance.now() - began) / measureMs;
            pose = viewPose(view.id, Math.min(1, t), hq, start);
            if (t >= 1) resolve();
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        frame.measuring = false;
        // The last queries come a frame or two later
        await nextFrames(3);
        const timing = engine.renderLoop.takeTiming();
        engine.renderLoop.setTiming(false);
        const cpuMs = timing && timing.frames ? (timing.updateMs + timing.renderMs) / timing.frames : 0;
        const row = renderRow(view.id, frame.starts, timer ? timer.take() : null, cpuMs, frame.calls, frame.triangles);
        this.state.update((s) => ({ ...s, rows: [...s.rows, row] }));
      }
      restore();
      restore = null;
      this.state.update((s) => ({ ...s, phase: 'done', doing: '' }));
      const done = this.state();
      (globalThis as { __renderBenchmark?: unknown }).__renderBenchmark = { env: done.env, rows: done.rows };
    } catch (error) {
      restore?.();
      console.error('[RenderBenchmark]', error);
      this.state.update((s) => ({ ...s, phase: 'failed', error: error instanceof Error ? error.message : String(error) }));
      (globalThis as { __renderBenchmark?: unknown }).__renderBenchmark = { error: this.state().error };
    }
  }

  /** The engine once the world stands, the intro flight cut short */
  private async waitForWorld(): Promise<ThreeTilesEngine> {
    const until = performance.now() + 240_000;
    for (;;) {
      if (this.intro.isRunning()) this.intro.cancel('benchmark');
      const engine = this.engineInit.getEngine();
      if (engine && engine.world.ready() && !this.engineInit.loading() && !this.intro.isRunning() && this.location.hq()) {
        // The start camera settles
        await wait(1000);
        return engine;
      }
      if (performance.now() > until) throw new Error('the world did not come up within 4 minutes');
      await wait(250);
    }
  }

  /** The view settles: SETTLE_MS, on tiles until no tile loads (at most TILES_SETTLE_MAX_MS) */
  private async settle(engine: ThreeTilesEngine, tiles: boolean): Promise<void> {
    await wait(SETTLE_MS);
    if (!tiles) return;
    const until = performance.now() + TILES_SETTLE_MAX_MS;
    let quietSince = performance.now();
    while (performance.now() < until) {
      const stats = engine.world.tiles!.tileStats();
      if (stats.downloading + stats.parsing > 0) quietSince = performance.now();
      else if (performance.now() - quietSince > 1000) return;
      await wait(250);
    }
  }

  /** The HQ in scene metres, on the ground */
  private hqLocal(engine: ThreeTilesEngine): Vec3 {
    const hq = this.location.hq()!;
    const ground = engine.terrain.getTerrainHeightAtGeo(hq.lat, hq.lon) ?? 0;
    const at = engine.sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    return [at.x, ground, at.z];
  }

  private async environment(engine: ThreeTilesEngine, gpuTimer: boolean): Promise<RenderBenchEnv> {
    const renderer = engine.getRenderer();
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const ref = this.worldContext.ref();
    const hq = this.location.hq();
    const world = ref.kind === 'custom-map' ? `map:${ref.mapId}`
      : ref.kind === 'tiles' && hq ? `tiles ${hq.lat.toFixed(4)},${hq.lon.toFixed(4)}`
      : ref.kind;
    const build = await fetch('build-info.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as { version?: string; commit?: string; dirty?: boolean } | null;
    return envOf({
      date: new Date().toISOString(),
      version: build?.version ? `v${build.version}` : BUILD_VERSION,
      commit: build?.commit ?? 'unknown',
      dirty: build?.dirty ?? null,
      world,
      quality: '-',
      devicePixelRatio: Math.round(renderer.getPixelRatio() * 100) / 100,
      canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      gpuTimer,
    }, navigator.userAgent, name);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}
