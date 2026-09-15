import type { GameStateManager } from '../../managers/game-state.manager';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import type { PathAndRouteService } from '../world/path-route.service';
import type { TilesLodDebug, TilesLodSnapshot } from '../../three-engine/tiles-lod-debug';
import { CORRIDOR_DEFAULTS, corridorConfig, type StationProbe } from '../../utils/route-corridor';
import { raycastStats } from '../../utils/raycast-stats';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { corridorChanges, reportUrl } from './cell-report';
import { type CorridorFingerprint, corridorFingerprint } from './corridor-fingerprint';

/** Region error targets a probe loads in turn, metres; 0 is the finest LOD there is. */
export const DEFAULT_PROBE_TARGETS: readonly number[] = [5, 2.5, 0];

/** How long a probe waits for the tiles of one target, seconds. */
export const DEFAULT_PROBE_TIMEOUT_S = 60;

/**
 * Camera error target while the probe runs, px. The region's error is
 * `geometricError - regionTarget + errorTarget` (RouteCorridorRegion), so it
 * still refines to its target; the camera's own error in px stays far below
 * this and refines nothing. The tiles in the corridor then depend on the
 * routes alone (docs/ROUTE_CORRIDOR.md, Phase 0).
 */
export const MUTED_CAMERA_ERROR_TARGET = 1e6;

/**
 * The tiles count as loaded once nothing loaded for this long, ms: the
 * debounce the game waits after tiles-load-end as well (TileLoadingTracker).
 */
export const QUIET_MS = 500;

/** Caller the probe's rays are booked on in `__raycastStats()`. */
export const PROBE_CALLER = 'corridorLodProbe';

/** How long the report waits for a click into the page when the clipboard needs the focus, ms. */
export const FOCUS_WAIT_MS = 120_000;

/** Where the probe waits for the next frame: rAF stops in a hidden tab, the timeout keeps counting. */
const FRAME_FALLBACK_MS = 250;

/** One row of `__corridor.probeLod()`, one per region target. */
export interface LodProbeRow {
  /** Region error target, metres (0: finest). */
  target: number;
  /** Seconds from setting the target until the tiles stopped loading; the whole wait when they did not. */
  loadS: number;
  timedOut: boolean;
  /** Tiles in the traversal and their MB, then the LRU cache: tiles, MB, at its cap. */
  active: number;
  activeMB: number;
  cachedTiles: number;
  cachedMB: number;
  cacheFull: boolean;
  /** Stations measured, and how fine the tile under each is, by geometric error in metres. */
  stations: number;
  upTo2: number;
  upTo2_5: number;
  upTo5: number;
  over5: number;
  /** No tile under the station, or no probe (DevWorld). */
  none: number;
  /** One pass over all stations: main-thread ms, per station. */
  measureMs: number;
  msPerStation: number;
  /** Rays of that pass (columns and side rays), their ms, intersections per ray. */
  rays: number;
  rayMs: number;
  hitsPerRay: number;
}

/** What a probe found, see CorridorLodProbe.probe(). */
export interface LodProbeResult {
  rows: LodProbeRow[];
  /** The tiles as the player's view left them, before the probe. */
  tilesBefore: TilesLodSnapshot;
  /** The corridor's fingerprint before the probe. */
  fingerprint: CorridorFingerprint;
  /** Region (m) and camera (px) error target before the run, set back after it. */
  restored: { regionErrorTarget: number; cameraErrorTarget: number };
  /** Why the run stopped before the last target, null when it did not. */
  stoppedEarly: string | null;
  /** The tiles still loaded when the timeout ran out after the restore; the game got its tile loads back anyway. */
  restoreTimedOut: boolean;
  /** The corridor's fingerprint is the same after the run as before it. */
  corridorUnchanged: boolean;
}

/** Where the report goes; the page's clipboard by default, see pageClipboard. */
export interface ProbeClipboard {
  /** Put `text` on the clipboard; false where the browser refuses. */
  copy(text: string): Promise<boolean>;
  /** The page has the focus: the clipboard refuses without it, and typing in DevTools takes it. */
  focused(): boolean;
  /** Resolves true once the page has the focus (the player clicked into it), false after `ms`. */
  focus(ms: number): Promise<boolean>;
}

/** What CorridorLodProbe needs; VisualizationFacadeService passes its services. */
export interface CorridorLodProbeDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerCount' | 'enemyManager' | 'waveManager' | 'getGlobalRouteGrid'>;
  engineInit: Pick<EngineInitializationService, 'getEngine' | 'loading'>;
  introFlight: Pick<IntroCameraFlightService, 'isRunning'>;
  pathRoute: Pick<PathAndRouteService, 'measureAllStations' | 'clearanceProgress' | 'corridorState'>;
  /** Resolves on the next frame; the default waits for rAF, at most FRAME_FALLBACK_MS. */
  nextFrame?: () => Promise<void>;
  /** Monotonic clock, ms; the default is performance.now(). */
  now?: () => number;
  /** The default is the page's clipboard. */
  clipboard?: ProbeClipboard;
  /** The page URL for the report, without parameters that could carry a key (reportUrl). */
  pageUrl?: () => string;
}

/** The engine as the probe reads it. */
type ProbeEngine = NonNullable<ReturnType<EngineInitializationService['getEngine']>>;

/** Every cell of the grid, for dumpCellsInBox. */
const WHOLE_GRID = { xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity };

function nextFrameOrTimeout(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      resolve();
    }, FRAME_FALLBACK_MS);
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The page's clipboard, as the cell report uses it. */
const pageClipboard: ProbeClipboard = {
  copy: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
  focused: () => document.hasFocus(),
  focus: (ms) => new Promise((resolve) => {
    if (document.hasFocus()) {
      resolve(true);
      return;
    }
    const done = (focused: boolean) => {
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      resolve(focused);
    };
    const onFocus = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    window.addEventListener('focus', onFocus);
  }),
};

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Head of the probe's report: when, where and with which settings it ran. Nothing of the tile credentials. */
export interface LodProbeMeta {
  time: string;
  url: string;
  version: string;
  /** Corridor settings that differ from CORRIDOR_DEFAULTS. */
  corridor: Record<string, unknown>;
}

/** The report the probe puts on the clipboard: one line of JSON, fingerprint parts as [entries, hash]. */
export function buildLodProbeReport(meta: LodProbeMeta, result: LodProbeResult): string {
  const parts = Object.fromEntries(
    Object.entries(result.fingerprint.parts).map(([name, part]) => [name, [part.entries, part.hash]]),
  );
  return JSON.stringify({
    report: 'corridor-lod-probe',
    ...meta,
    tiles: result.tilesBefore,
    fingerprint: { hash: result.fingerprint.hash, parts },
    rows: result.rows,
    restored: result.restored,
    stoppedEarly: result.stoppedEarly,
    restoreTimedOut: result.restoreTimedOut,
    corridorUnchanged: result.corridorUnchanged,
  });
}

/** A row of the short table in the console; the report carries all fields. */
function tableRow(row: LodProbeRow): Record<string, string | number> {
  return {
    'Ziel m': row.target,
    'Laden s': row.timedOut ? `${row.loadS} Timeout` : row.loadS,
    Tiles: row.active,
    MB: row.activeMB,
    'Cache MB': row.cacheFull ? `${row.cachedMB} voll` : row.cachedMB,
    Stationen: row.stations,
    'Fehler ≤2/≤2,5/≤5/>5/keins': `${row.upTo2}/${row.upTo2_5}/${row.upTo5}/${row.over5}/${row.none}`,
    'Messen ms': row.measureMs,
    Strahlen: row.rays,
  };
}

/**
 * `__corridor.probeLod()` and `__corridor.fingerprint()`, the measuring
 * tools of Phase 0 (docs/ROUTE_CORRIDOR.md): what a corridor measured on a
 * fixed LOD would cost, and whether two loads gave the same corridor.
 *
 * A probe loads the route corridor region at each error target in turn with
 * the camera's own refinement muted (MUTED_CAMERA_ERROR_TARGET), waits for the
 * tiles, and measures every station once into a scratch list, against a
 * column cache of its own (PathAndRouteService.measureAllStations,
 * TerrainQueries.withScratchColumnCache). Nothing of that reaches the
 * corridor: nothing is stored or rebuilt, and the settled tile loads are held
 * back from the game while it runs (SettleHold), so the cells and the
 * re-measurement keep what they saw before. At the end, also on a timeout or
 * an error, both error targets go back to what they were.
 *
 * Refused while the location loads, towers stand, a wave runs, enemies walk,
 * the intro flight runs or a corridor measurement is under way; stops early
 * when one of those comes up between two targets.
 *
 * The console command (run) is meant for a playtest without explanations:
 * one line per step, a short table, the report on the clipboard and one
 * last line that says so. Only console.log.
 */
export class CorridorLodProbe {
  private busy = false;
  private readonly nextFrame: () => Promise<void>;
  private readonly now: () => number;
  private readonly clipboard: ProbeClipboard;
  private readonly pageUrl: () => string;

  constructor(private readonly deps: CorridorLodProbeDeps) {
    this.nextFrame = deps.nextFrame ?? nextFrameOrTimeout;
    this.now = deps.now ?? (() => performance.now());
    this.clipboard = deps.clipboard ?? pageClipboard;
    this.pageUrl = deps.pageUrl ?? (() => reportUrl(window.location.href));
  }

  /** A probe runs: `__corridor.set()` and `reset()` wait for it. */
  get running(): boolean {
    return this.busy;
  }

  /**
   * `__corridor.probeLod()`: probe(), then a short table, the report on the
   * clipboard (buildLodProbeReport) and one line that says where it is. When
   * the clipboard refuses because DevTools has the focus, it asks for a click
   * into the page and copies then; when it still refuses, the report goes to
   * the console. Resolves with the last line, or with the one line that says
   * why it did not run and what to do.
   */
  async run(targets?: readonly number[], timeoutS?: number): Promise<string> {
    let outcome: LodProbeResult | string;
    try {
      outcome = await this.probe(targets, timeoutS);
    } catch (error) {
      return this.say(`Fehler (${error instanceof Error ? error.message : String(error)}): Seite neu laden und noch einmal.`);
    }
    if (typeof outcome === 'string') return this.say(outcome);
    console.table(outcome.rows.map(tableRow));
    const meta = {
      time: new Date().toISOString(),
      url: this.pageUrl(),
      version: BUILD_VERSION,
      corridor: corridorChanges(corridorConfig, CORRIDOR_DEFAULTS),
    };
    return this.deliver(buildLodProbeReport(meta, outcome), outcome.stoppedEarly);
  }

  /**
   * Load each region target in turn and measure every station on it, see
   * the class comment; one line per target. Resolves with what it found, or
   * with why it did not start and what to do.
   *
   * @param targets Region error targets, metres, 0 for the finest LOD
   * @param timeoutS How long to wait for the tiles of one target
   */
  async probe(targets: readonly number[] = DEFAULT_PROBE_TARGETS, timeoutS = DEFAULT_PROBE_TIMEOUT_S): Promise<LodProbeResult | string> {
    if (this.busy) return 'Läuft schon: auf "Fertig" warten.';
    if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0)) {
      return 'Ziele sind Meter ab 0, z. B. __corridor.probeLod([5, 2.5, 0]).';
    }
    if (!(timeoutS > 0)) return 'Die Wartezeit ist in Sekunden und größer als 0.';
    const blocker = this.blocker();
    if (blocker) return `${blocker.why}: ${blocker.todo}`;
    const engine = this.deps.engineInit.getEngine();
    const tiles = engine?.tilesLodDebug() ?? null;
    if (!engine || !tiles) return 'Kein Ort mit 3D-Tiles geladen: Ort laden, dann noch einmal.';
    const before = tiles.snapshot();
    if (before.regionErrorTarget === null) return 'Die Routen stehen noch nicht: Ladebildschirm abwarten, dann noch einmal.';
    const restored = { regionErrorTarget: before.regionErrorTarget, cameraErrorTarget: before.cameraErrorTarget };

    this.busy = true;
    const timeoutMs = timeoutS * 1000;
    const fingerprint = this.compute();
    const rows: LodProbeRow[] = [];
    let stoppedEarly: string | null = null;
    let restoreTimedOut: boolean;
    let corridorUnchanged: boolean;
    this.say(`startet, ${targets.length} Stufen (${targets.join(', ')} m). Tab vorn lassen, Kamera nicht bewegen, bis "Fertig" kommt.`);
    tiles.holdSettled(true);
    try {
      try {
        tiles.setCameraErrorTarget(MUTED_CAMERA_ERROR_TARGET);
        for (const [i, target] of targets.entries()) {
          stoppedEarly = this.blocker()?.why ?? null;
          if (stoppedEarly) break;
          tiles.setRegionErrorTarget(target);
          const load = await this.settle(tiles, timeoutMs);
          const row = this.measure(engine, target, load, tiles.snapshot());
          rows.push(row);
          this.say(
            `${i + 1}/${targets.length}: ${target} m geladen in ${row.loadS} s${row.timedOut ? ' (Timeout)' : ''}, ` +
            `${row.stations} Stationen gemessen in ${row.measureMs} ms`,
          );
        }
      } catch (error) {
        stoppedEarly = error instanceof Error ? error.message : String(error);
      } finally {
        tiles.setRegionErrorTarget(restored.regionErrorTarget);
        tiles.setCameraErrorTarget(restored.cameraErrorTarget);
      }
      restoreTimedOut = (await this.settle(tiles, timeoutMs)).timedOut;
      // Before the game gets its tile loads back: the sweep they start may move cells.
      corridorUnchanged = this.compute().hash === fingerprint.hash;
    } finally {
      tiles.holdSettled(false);
      this.busy = false;
    }
    return { rows, tilesBefore: before, fingerprint, restored, stoppedEarly, restoreTimedOut, corridorUnchanged };
  }

  /** `__corridor.fingerprint()`: prints and returns the fingerprint of the corridor in use (corridor-fingerprint.ts). */
  fingerprint(): CorridorFingerprint | string {
    if (!this.deps.engineInit.getEngine()) return 'No location loaded.';
    const print = this.compute();
    console.log(`[Corridor] fingerprint ${print.hash}`);
    console.table(print.parts);
    return print;
  }

  private compute(): CorridorFingerprint {
    const grid = this.deps.gameState().getGlobalRouteGrid().getGrid();
    return corridorFingerprint(this.deps.pathRoute.corridorState(), grid.dumpCellsInBox(WHOLE_GRID));
  }

  /** One line of the probe in the console; returned for the caller to hand on. */
  private say(line: string): string {
    console.log(`[Corridor] probeLod: ${line}`);
    return line;
  }

  /** The report to the clipboard and the last line, see run(). */
  private async deliver(json: string, stoppedEarly: string | null): Promise<string> {
    const done = stoppedEarly
      ? `Abgebrochen (${stoppedEarly}), Teilergebnis in der Zwischenablage, bitte in den Chat einfügen.`
      : 'Fertig, Ergebnis in der Zwischenablage, bitte in den Chat einfügen.';
    if (await this.clipboard.copy(json)) return this.say(done);
    if (!this.clipboard.focused()) {
      this.say('Messung fertig. Jetzt einmal in die Spielseite klicken, dann kommt das Ergebnis in die Zwischenablage.');
      if ((await this.clipboard.focus(FOCUS_WAIT_MS)) && (await this.clipboard.copy(json))) return this.say(done);
    }
    console.log(json);
    return this.say('Fertig. Die Zwischenablage hat abgelehnt: Ergebnis steht eine Zeile darüber, bitte kopieren und in den Chat einfügen.');
  }

  /** Why the probe must not start or go on (`why`, also the reason of an early stop) and what to do, null if it may. */
  private blocker(): { why: string; todo: string } | null {
    const reload = 'Seite neu laden, dann noch einmal.';
    if (this.deps.engineInit.loading()) return { why: 'Der Ort lädt noch', todo: 'Ladebildschirm abwarten, dann noch einmal.' };
    const gameState = this.deps.gameState();
    if (gameState.towerCount() > 0) return { why: 'Tower stehen auf der Karte', todo: 'Seite neu laden, keinen Tower setzen, dann noch einmal.' };
    if (gameState.waveManager.phase() === 'wave') return { why: 'Eine Welle läuft', todo: reload };
    if (gameState.enemyManager.getAliveCount() > 0) return { why: 'Gegner sind auf der Karte', todo: reload };
    if (this.deps.introFlight.isRunning()) return { why: 'Der Intro-Flug läuft', todo: 'abwarten oder abbrechen, dann noch einmal.' };
    if (this.deps.pathRoute.clearanceProgress() !== null) {
      return { why: 'Der Korridor wird noch gemessen', todo: 'ein paar Sekunden warten, dann noch einmal.' };
    }
    return null;
  }

  /**
   * Wait until the tiles have not loaded for QUIET_MS, at most `timeoutMs`.
   * `ms` is the time until they stopped, or the whole wait on a timeout.
   */
  private async settle(tiles: TilesLodDebug, timeoutMs: number): Promise<{ ms: number; timedOut: boolean }> {
    const start = this.now();
    let quietSince: number | null = null;
    for (;;) {
      await this.nextFrame();
      const now = this.now();
      if (tiles.busy()) quietSince = null;
      else quietSince ??= now;
      if (quietSince !== null && now - quietSince >= QUIET_MS) return { ms: quietSince - start, timedOut: false };
      if (now - start >= timeoutMs) return { ms: now - start, timedOut: true };
    }
  }

  /** Measure every station once on the tiles loaded now, into a scratch list, and put it in a row. */
  private measure(
    engine: ProbeEngine, target: number, load: { ms: number; timedOut: boolean }, snapshot: TilesLodSnapshot,
  ): LodProbeRow {
    const raysBefore = raycastStats.totals(PROBE_CALLER);
    const scope = raycastStats.enter(PROBE_CALLER);
    const start = this.now();
    let probes: (StationProbe | null)[];
    try {
      probes = engine.terrain.withScratchColumnCache(() => this.deps.pathRoute.measureAllStations()) ?? [];
    } finally {
      raycastStats.exit(scope);
    }
    const measureMs = this.now() - start;
    const raysAfter = raycastStats.totals(PROBE_CALLER);
    const rays = raysAfter.calls - raysBefore.calls;

    const histogram = { upTo2: 0, upTo2_5: 0, upTo5: 0, over5: 0, none: 0 };
    for (const probe of probes) {
      const error = probe?.tileError ?? Infinity;
      if (!Number.isFinite(error)) histogram.none++;
      else if (error <= 2) histogram.upTo2++;
      else if (error <= 2.5) histogram.upTo2_5++;
      else if (error <= 5) histogram.upTo5++;
      else histogram.over5++;
    }
    return {
      target,
      loadS: round(load.ms / 1000, 1),
      timedOut: load.timedOut,
      active: snapshot.active,
      activeMB: snapshot.activeMB,
      cachedTiles: snapshot.cachedTiles,
      cachedMB: snapshot.cachedMB,
      cacheFull: snapshot.cacheFull,
      stations: probes.length,
      ...histogram,
      measureMs: round(measureMs, 1),
      msPerStation: probes.length > 0 ? round(measureMs / probes.length, 2) : 0,
      rays,
      rayMs: round(raysAfter.totalMs - raysBefore.totalMs, 1),
      hitsPerRay: rays > 0 ? round((raysAfter.hits - raysBefore.hits) / rays, 1) : 0,
    };
  }
}
