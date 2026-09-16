import type { GameStateManager } from '../../managers/game-state.manager';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import type { PathAndRouteService } from '../world/path-route.service';
import {
  MUTED_CAMERA_ERROR_TARGET,
  nextFrameOrTimeout,
  waitForQuietTiles,
  type TilesLodDebug,
  type TilesLodSnapshot,
} from '../../three-engine/tiles-lod-debug';
import { CORRIDOR_DEFAULTS, corridorConfig, type StationProbe } from '../../utils/route-corridor';
import { raycastStats } from '../../utils/raycast-stats';
import { WHOLE_GRID } from '../../utils/route-grid-diagnostics';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { corridorChanges, reportUrl } from './cell-report';
import { type CorridorFingerprint, corridorFingerprint } from './corridor-fingerprint';
import { showCopyButton } from './copy-result-button';

/** Region error targets a probe loads in turn, metres; 0 is the finest LOD there is. */
export const DEFAULT_PROBE_TARGETS: readonly number[] = [5, 2.5, 0];

/** How long a probe waits for the tiles of one target, seconds. */
export const DEFAULT_PROBE_TIMEOUT_S = 60;

/** Caller the probe's rays are booked on in `__raycastStats()`. */
export const PROBE_CALLER = 'corridorLodProbe';

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
  /** The tiles as the player's view left them, before the probe, as `__tiles.stats()` prints them. */
  tilesBefore: TilesLodSnapshot & { lodVersion: number };
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
  /** Put `text` on the clipboard; false where the browser refuses (DevTools has the focus). */
  copy(text: string): Promise<boolean>;
  /** Show a button on the page that copies `text` on one click (showCopyButton). */
  offerButton(text: string): void;
}

/** What CorridorLodProbe needs; VisualizationFacadeService passes its services. */
export interface CorridorLodProbeDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerCount' | 'enemyManager' | 'waveManager' | 'getGlobalRouteGrid'>;
  engineInit: Pick<EngineInitializationService, 'getEngine' | 'loading'>;
  introFlight: Pick<IntroCameraFlightService, 'isRunning'>;
  pathRoute: Pick<PathAndRouteService, 'measureAllStations' | 'corridorState'>;
  /** The corridor is being built (CorridorBuild.pending): it sets the same error targets. */
  corridorBuilding: () => boolean;
  /** Resolves on the next frame; the default waits for rAF, at most FRAME_FALLBACK_MS. */
  nextFrame?: () => Promise<void>;
  /** Monotonic clock, ms; the default is performance.now(). */
  now?: () => number;
  /** The default is the page's clipboard and showCopyButton. */
  clipboard?: ProbeClipboard;
  /** The page URL for the report, without parameters that could carry a key (reportUrl). */
  pageUrl?: () => string;
}

/** The page's clipboard, as the cell report uses it, and the button for when it refuses. */
const pageClipboard: ProbeClipboard = {
  copy: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
  offerButton: (text) => {
    showCopyButton(text);
  },
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

/**
 * `__corridor.probeLod()` and `__corridor.fingerprint()`, the measuring
 * tools of Phase 0 (docs/ROUTE_CORRIDOR.md): what a corridor measured on a
 * fixed LOD would cost, and whether two loads gave the same corridor.
 *
 * A probe loads the route corridor region at each error target in turn with
 * the camera's own refinement muted (MUTED_CAMERA_ERROR_TARGET), waits for the
 * tiles, and measures every station once into a scratch list
 * (PathAndRouteService.measureAllStations); a station's columns never touch
 * the column cache (TerrainQueries.measureStreetClearance). Nothing of that
 * reaches the corridor: nothing is stored or rebuilt, and the settled tile loads are held
 * back from the game while it runs (SettleHold), so the cells and the
 * re-measurement keep what they saw before. At the end, also on a timeout or
 * an error, both error targets go back to what they were.
 *
 * Refused while the location loads, towers stand, a wave runs, enemies walk,
 * the intro flight runs or a corridor measurement is under way; stops early
 * when one of those comes up between two targets.
 *
 * The console command (run) is meant for a playtest without explanations:
 * one line per target, the report on the clipboard (or on a button at the
 * top of the page) and one last line that says what to do with it. Only
 * console.log.
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
   * `__corridor.probeLod()`: probe(), then the report (buildLodProbeReport)
   * to the clipboard. The clipboard refuses while DevTools has the focus,
   * which it has right after typing the command; the report then waits on a
   * button at the top of the page that copies it on one click. Resolves with
   * the last line, which says which of the two it was, or with the one line
   * that says why it did not run and what to do.
   */
  async run(targets?: readonly number[], timeoutS?: number): Promise<string> {
    let outcome: LodProbeResult | string;
    try {
      outcome = await this.probe(targets, timeoutS);
    } catch (error) {
      return this.say(`Fehler (${error instanceof Error ? error.message : String(error)}): Seite neu laden und Befehl nochmal`);
    }
    if (typeof outcome === 'string') return this.say(outcome);
    const meta = {
      time: new Date().toISOString(),
      url: this.pageUrl(),
      version: BUILD_VERSION,
      corridor: corridorChanges(corridorConfig, CORRIDOR_DEFAULTS),
    };
    const json = buildLodProbeReport(meta, outcome);
    const head = outcome.stoppedEarly ? `Abgebrochen (${outcome.stoppedEarly})` : 'Fertig';
    if (await this.clipboard.copy(json)) return this.say(`${head}: Ergebnis kopiert, bitte in den Chat einfügen`);
    this.clipboard.offerButton(json);
    return this.say(`${head}: Klick oben auf 'Ergebnis kopieren', dann in den Chat einfügen`);
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
    if (this.busy) return "Läuft schon: auf die Zeile 'Fertig' warten";
    if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0)) {
      return 'Ziele sind Meter ab 0: z. B. __corridor.probeLod([5, 2.5, 0])';
    }
    if (!(timeoutS > 0)) return 'Wartezeit in Sekunden über 0: z. B. __corridor.probeLod([5, 2.5, 0], 60)';
    const blocker = this.blocker();
    if (blocker) return `${blocker.why}: ${blocker.todo}`;
    const engine = this.deps.engineInit.getEngine();
    const tiles = engine?.tilesLodDebug() ?? null;
    if (!engine || !tiles) return 'Kein Ort mit 3D-Tiles geladen: Ort laden und Befehl nochmal';
    const before = tiles.snapshot();
    if (before.regionErrorTarget === null) return 'Routen stehen noch nicht: Ladebildschirm abwarten und Befehl nochmal';
    const restored = { regionErrorTarget: before.regionErrorTarget, cameraErrorTarget: before.cameraErrorTarget };
    const tilesBefore = { ...before, lodVersion: engine.terrain.lodVersion };

    this.busy = true;
    const timeoutMs = timeoutS * 1000;
    const fingerprint = this.compute();
    const rows: LodProbeRow[] = [];
    let stoppedEarly: string | null = null;
    let restoreTimedOut: boolean;
    let corridorUnchanged: boolean;
    tiles.holdSettled(true);
    try {
      try {
        tiles.setCameraErrorTarget(MUTED_CAMERA_ERROR_TARGET);
        for (const [i, target] of targets.entries()) {
          stoppedEarly = this.blocker()?.why ?? null;
          if (stoppedEarly) break;
          tiles.setRegionErrorTarget(target);
          const load = await this.settle(tiles, timeoutMs);
          const row = this.measure(target, load, tiles.snapshot());
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
    return { rows, tilesBefore, fingerprint, restored, stoppedEarly, restoreTimedOut, corridorUnchanged };
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

  /** Why the probe must not start or go on (`why`, also the reason of an early stop) and what to do, null if it may. */
  private blocker(): { why: string; todo: string } | null {
    const reload = 'Seite neu laden und Befehl nochmal';
    if (this.deps.engineInit.loading()) return { why: 'Ort lädt noch', todo: 'Ladebildschirm abwarten und Befehl nochmal' };
    const gameState = this.deps.gameState();
    if (gameState.towerCount() > 0) return { why: 'Tower stehen', todo: 'Seite neu laden, keinen Tower setzen, Befehl nochmal' };
    if (gameState.waveManager.phase() === 'wave') return { why: 'Welle läuft', todo: reload };
    if (gameState.enemyManager.getAliveCount() > 0) return { why: 'Gegner auf der Karte', todo: reload };
    if (this.deps.introFlight.isRunning()) return { why: 'Intro noch aktiv', todo: 'warten und Befehl nochmal' };
    if (this.deps.corridorBuilding()) {
      return { why: 'Korridor wird noch gebaut', todo: 'ein paar Sekunden warten und Befehl nochmal' };
    }
    return null;
  }

  /**
   * Wait until the tiles have not loaded for QUIET_MS, at most `timeoutMs`
   * (waitForQuietTiles). `ms` is the time until they stopped, or the whole
   * wait on a timeout.
   */
  private settle(tiles: TilesLodDebug, timeoutMs: number): Promise<{ ms: number; timedOut: boolean }> {
    return waitForQuietTiles(tiles, timeoutMs, this.nextFrame, this.now);
  }

  /** Measure every station once on the tiles loaded now, into a scratch list, and put it in a row. */
  private measure(target: number, load: { ms: number; timedOut: boolean }, snapshot: TilesLodSnapshot): LodProbeRow {
    const raysBefore = raycastStats.totals(PROBE_CALLER);
    const scope = raycastStats.enter(PROBE_CALLER);
    const start = this.now();
    let probes: (StationProbe | null)[];
    try {
      probes = this.deps.pathRoute.measureAllStations() ?? [];
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
