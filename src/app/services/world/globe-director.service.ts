import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { MathUtils, Matrix4, Vector3 } from 'three';
import type { GlobeQuality } from '../../globe/globe-textures';
import { landingSun, subsolarPoint, sweptSun, type LatLon } from '../../globe/globe-geo';
import { IDLE_ALTITUDE, MENU_SHIFT, WAIT_ALTITUDE, arcDegrees, headingFromMatrix, type GlobeShot } from '../../globe/globe-flight';
import { createGlobeHost, type GlobeHost } from '../../globe/globe-host';
import { epochNow, type GlobeCommand, type GlobeEvent, type SunRun } from '../../globe/globe-runtime';
import { DiveView } from '../../three-engine/dive-view';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { LocationManagementService, LOADING_NAME, NO_LOCATION_NAME } from '../location/location-management.service';
import { LocationChangeCoordinatorService } from '../location/location-change-coordinator.service';
import { BestWaveService } from '../location/best-wave.service';
import { loadRecentLocations, isSamePlace } from '../location/recent-locations';
import { loadFavoriteLocations } from '../location/favorite-locations';
import { DevWorldService } from '../../devworld/devworld.service';
import { startMenuSkipped } from '../../components/main-menu/start-menu-skipped';
import { shortPlaceName } from '../save-game/slot-name';
import { DiveFlightService } from './dive-flight.service';
import { HANDOVER_ALTITUDE, diveDurations, type DivePlan } from '../../globe/dive-path';
import { cameraTimeline } from '../../utils/camera-timeline';
import { GLOBE_LINK } from './globe-link';
import { readJson, writeJson } from '../../utils/storage';

/**
 * What the globe does (docs/GLOBE_PLAN.md, Ablauf):
 * - `off`: no globe (automated runs, DevWorld, switched off, no WebGL 2)
 * - `idle`: the whole earth turns slowly, no place chosen
 * - `turning`: the earth turns to the place that loads, the sun rises over it
 * - `waiting`: over the place while it loads
 * - `warming`: loaded; the tiles along the dive load
 * - `diving`: the globe's camera goes down to the handover
 * - `handover`: the game camera flies on, the globe follows it and fades out
 * - `gone`: the game shows; the globe's context is freed
 * - `rising`: the game camera climbs out of the place, the globe fades in
 */
export type GlobePhase = 'off' | 'idle' | 'turning' | 'waiting' | 'warming' | 'diving' | 'handover' | 'gone' | 'rising';

/** The globe's setting (Settings, Graphics) */
export type GlobeSetting = GlobeQuality | 'off';
export const GLOBE_SETTING_KEY = 'td_globe_quality_v1';

/** A place marked on the globe */
export type GlobeMarkKind = 'target' | 'record' | 'favorite' | 'recent';
export interface GlobeMark {
  kind: GlobeMarkKind;
  name: string;
  /** Wave reached, for records */
  wave?: number;
  lat: number;
  lon: number;
}

/** The marks, their places on screen and the globe's opacity, written straight to the DOM */
export interface GlobeOverlay {
  setMarks(marks: readonly GlobeMark[]): void;
  /** x, y and facing (0 or 1) per mark, as the runtime projected them */
  update(spots: Float32Array): void;
  /** Fade to `value` over `durationMs` after `delayMs`, a CSS transition (the compositor runs it, not this thread) */
  fade(value: number, durationMs: number, delayMs?: number): void;
}

/** The read-out in the corner (concept C): target, coordinates, altitude, what happens */
export interface GlobeHud {
  name: string | null;
  lat: number | null;
  lon: number | null;
  altitudeKm: number;
  status: string;
}

/** Whole dive in ms, globe and game camera together; shorter when Play waits for it */
const DIVE_MS = 7000;
const DIVE_MS_PLAY_WAITS = 4500;
/** The globe fades out over the first part of the game camera's descent */
const HANDOVER_FADE_MS = 700;
/** The rise out of a place, ms; the globe fades in over its upper part */
const RISE_MS = 3200;
/** The fade-in over the rise: from this share of it to that one */
const RISE_FADE_FROM = 0.5;
const RISE_FADE_TO = 0.92;
/** The first fade-in of a globe */
const FADE_IN_MS = 600;
/** Longest wait for a globe's first textures before a rise goes on without them */
const VIEW_READY_TIMEOUT_MS = 2500;
/** The sun's run (D2), ms: into day as the earth turns to the place, back to the hour after a rise */
const SUN_SWEEP_MS = 4500;
/** Clouds part around the place over the dive, radians of arc */
const CLOUD_HOLE = 0.14;
/** Above this, the game camera hangs from a rise, its view is not the place's */
const RISEN_ALTITUDE = 100_000;
/** The read-out refreshes this often, ms */
const HUD_MS = 200;

/** Rough longitude of the player's time zone, 15 degrees an hour from Greenwich */
export function homeLongitude(date = new Date()): number {
  return MathUtils.clamp(-date.getTimezoneOffset() / 4, -180, 180);
}

/** The setting stored, or high */
export function readGlobeSetting(): GlobeSetting {
  const value = readJson(GLOBE_SETTING_KEY);
  return value === 'low' || value === 'off' ? value : 'high';
}

function webgl2Available(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** A matrix as a plain array for a message */
const toArray = (m: Matrix4): number[] => m.toArray() as number[];

/**
 * Runs the menu globe (docs/GLOBE_PLAN.md): its phases, the shots it flies,
 * the sun, the marks and the hand-over with the game camera
 * (DiveFlightService). The drawing and the moves happen in the GlobeRuntime,
 * in a worker where the browser can (globe-host.ts); this side sends it
 * commands. The globe is backdrop only (D3): no input.
 */
@Injectable({ providedIn: 'root' })
export class GlobeDirectorService {
  private readonly zone = inject(NgZone);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly coordinator = inject(LocationChangeCoordinatorService);
  private readonly bestWaves = inject(BestWaveService);
  private readonly devWorld = inject(DevWorldService);
  private readonly diveFlight = inject(DiveFlightService);
  /** What the menu and a change of place see of the globe */
  private readonly link = inject(GLOBE_LINK);

  readonly phase = signal<GlobePhase>('off');
  /** A new canvas for each globe: a context once freed cannot come back on the same canvas */
  readonly generation = signal(0);
  readonly hud = signal<GlobeHud | null>(null);
  /** The game camera still flies down: Play waits */
  private readonly descending = signal(false);

  /** The setting, read once per page */
  readonly setting = signal<GlobeSetting>(readGlobeSetting());

  /** The globe failed here (no context, a context lost): off for this page */
  private readonly failed = signal(false);

  /** The globe may run at all here */
  readonly enabled = computed(
    () =>
      !this.failed() &&
      this.setting() !== 'off' &&
      !this.devWorld.isActive &&
      !startMenuSkipped(typeof window === 'undefined' ? '' : window.location.search) &&
      webgl2Available(),
  );

  /** The globe stands between the player and the place: Play waits for the landing */
  readonly holdsPlay = computed(() => {
    const phase = this.phase();
    return this.descending() || (phase !== 'off' && phase !== 'gone' && phase !== 'idle');
  });

  /**
   * The globe is the picture: the game draws nothing (its tiles load on).
   * From the start, before the globe has faded in, so the game's sky never
   * shows first; not while the game camera rises into it or dives out of it.
   */
  readonly coversGame = computed(() => {
    const phase = this.phase();
    return phase === 'idle' || phase === 'turning' || phase === 'waiting' || phase === 'warming' || phase === 'diving';
  });

  /** The canvas is in the page: from the start until the globe went, again for a rise */
  readonly mounted = computed(() => this.enabled() && this.phase() !== 'gone');

  private host: GlobeHost | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private overlay: GlobeOverlay | null = null;
  /** The globe's first textures are up */
  private ready = false;
  private readyWaiters: (() => void)[] = [];
  private primeWaiter: (() => void) | null = null;

  /** Idle over the player's part of the world (by the clock's offset): their own day or night */
  private shot: GlobeShot = { over: { lat: 30, lon: homeLongitude() }, altitude: IDLE_ALTITUDE, aim: 0, shift: MENU_SHIFT, roll: 0 };
  private place: LatLon | null = null;
  /** The sun's run as last sent, to start the next one from where it stands */
  private sunRun: SunRun | null = null;
  private animId = 0;
  private animDone = new Map<number, () => void>();
  private altitude = IDLE_ALTITUDE;

  private marks: GlobeMark[] = [];

  /** A rise under way, resolved when the globe covers the game */
  private rise: Promise<void> | null = null;
  /** The plan the last rise flew: the way back down when the place did not change */
  private risePlan: DivePlan | null = null;
  /** The place the last rise left */
  private riseFrom: LatLon | null = null;
  private plan: DivePlan | null = null;
  /** The place whose upper dive was warmed while it loaded */
  private upperWarmed: string | null = null;

  private readonly startEcef = new Matrix4();
  private readonly toEcef = new Matrix4();
  private hudAtMs = 0;
  /** DevTools: the timing the runtime last reported */
  private runtimeTiming: Record<string, number> = {};

  constructor() {
    // The place behind the menu: turn to it
    effect(() => {
      const hq = this.locationMgmt.hq();
      const chosen = !this.coordinator.awaitingStartChoice();
      untracked(() => this.onPlace(chosen ? hq : null));
    });
    // A change says where it goes before the place is set: turn there already
    effect(() => {
      const next = this.link.nextPlace();
      untracked(() => this.onPlace(next));
    });
    // Loaded: dive once the turn is done
    effect(() => {
      const loading = this.engineInit.loading();
      const error = this.engineInit.error();
      if (!loading && !error) untracked(() => this.tryDive());
    });
    // Another place starts to load while the game shows: rise out of this one
    effect(() => {
      if (this.engineInit.loading()) untracked(() => this.startRise());
    });
    // The first tiles are there: warm the dive's upper part while the rest loads
    effect(() => {
      const tilesLoading = this.engineInit.tilesLoading();
      const loading = this.engineInit.loading();
      if (!tilesLoading && loading) untracked(() => this.warmUpper());
    });
    // The place got its name: the marks say it
    effect(() => {
      this.locationMgmt.displayName();
      untracked(() => this.collectMarks());
    });
    // The menu's Play waits while the globe holds it; a change of place waits for the rise
    effect(() => this.link.holdsPlay.set(this.holdsPlay()));
    // The game draws nothing while the globe is the picture; an engine made meanwhile asks the link
    effect(() => {
      const covers = this.coversGame();
      this.link.coversGame.set(covers);
      untracked(() => this.engineInit.getEngine()?.setDrawSuppressed(covers));
    });
    this.link.beforeOriginChange = () => this.beforeOriginChange();
    this.registerConsole();
  }

  // ---- The component ----

  /** The component's canvas and overlay for this generation; starts the globe */
  attach(canvas: HTMLCanvasElement, overlay: GlobeOverlay): void {
    this.canvas = canvas;
    this.overlay = overlay;
    overlay.setMarks(this.marks);
    if (this.phase() === 'off' && this.enabled()) {
      // Turned on with a game behind the menu: from the next place on
      if (this.engineInit.getEngine() && !this.engineInit.loading()) this.phase.set('gone');
      else this.boot();
      return;
    }
    if (this.phase() === 'rising' && !this.host) this.createHost();
  }

  /** The canvas went (its component, a new generation) */
  detach(canvas: HTMLCanvasElement): void {
    if (this.canvas !== canvas) return;
    this.disposeHost();
    this.canvas = null;
    this.overlay = null;
  }

  /**
   * The Settings choice, kept. Off ends a globe at once; on starts one at the
   * next place, never over a game that runs.
   */
  setSetting(value: GlobeSetting): void {
    writeJson(GLOBE_SETTING_KEY, value);
    this.setting.set(value);
    if (value === 'off' && this.phase() !== 'off') {
      this.disposeHost();
      this.phase.set('off');
      this.hud.set(null);
    }
  }

  /** The canvas' size changed */
  resize(width: number, height: number): void {
    this.send({ type: 'resize', width, height });
  }

  // ---- The runtime ----

  private send(command: GlobeCommand): void {
    this.host?.send(command);
  }

  private createHost(): void {
    const canvas = this.canvas;
    if (!canvas || this.host) return;
    this.ready = false;
    try {
      this.host = this.zone.runOutsideAngular(() =>
        createGlobeHost(
          canvas,
          {
            quality: this.setting() === 'low' ? 'low' : 'high',
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            pixelRatio: window.devicePixelRatio,
            baseUrl: document.baseURI,
            shot: this.shot,
          },
          (event) => this.onEvent(event),
        ),
      );
    } catch (err) {
      console.warn('[Globe] no globe:', err);
      this.turnOff();
      return;
    }
    cameraTimeline.record('globe.host', { offThread: this.host.offThread });
    this.send({ type: 'marks', points: this.marks.flatMap((m) => [m.lat, m.lon]) });
    if (this.place) this.send({ type: 'region', place: this.place });
    if (this.sunRun) this.send({ type: 'sun', run: this.sunRun });
    this.send({ type: 'idle', on: this.phase() === 'idle' });
  }

  private onEvent(event: GlobeEvent): void {
    switch (event.type) {
      case 'ready':
        this.ready = true;
        this.readyWaiters.splice(0).forEach((resolve) => resolve());
        if (this.phase() !== 'rising' && this.phase() !== 'handover') this.fadeIn();
        return;
      case 'primed':
        this.primeWaiter?.();
        this.primeWaiter = null;
        return;
      case 'animDone': {
        const done = this.animDone.get(event.id);
        this.animDone.delete(event.id);
        done?.();
        return;
      }
      case 'frame':
        this.altitude = event.altitude;
        this.overlay?.update(event.spots);
        this.updateHud();
        return;
      case 'lost':
        console.warn('[Globe] WebGL context lost, the globe stays off');
        this.turnOff();
        return;
      case 'failed':
        console.warn('[Globe] no globe:', event.message);
        this.turnOff();
        return;
      case 'timing':
        this.runtimeTiming = event.timing;
        return;
    }
  }

  private disposeHost(): void {
    // Its numbers come back before it goes (`__globe.timing()`)
    this.send({ type: 'timing' });
    this.host?.dispose();
    this.host = null;
    this.ready = false;
    this.animDone.clear();
    this.readyWaiters.splice(0).forEach((resolve) => resolve());
    this.primeWaiter?.();
    this.primeWaiter = null;
    this.overlay?.fade(0, 0);
    this.overlay?.update(new Float32Array(0));
  }

  /** Fly the globe's camera to `to`; `done` when it is there */
  private animate(to: GlobeShot, durationMs: number, ease: 'inOut' | 'in', done: () => void, heading: Vector3 | null = null): void {
    const id = ++this.animId;
    this.animDone.set(id, () => this.zone.run(done));
    this.shot = to;
    this.send({ type: 'animate', id, to, durationMs, ease, heading: heading ? [heading.x, heading.y, heading.z] : null });
  }

  /** Where the sun stands now on its run, or the hour's sun */
  private sunNow(): LatLon {
    const real = subsolarPoint(new Date());
    const run = this.sunRun;
    if (!run) return real;
    return sweptSun(run.from ?? real, run.to ?? real, MathUtils.smootherstep(epochNow() - run.startEpoch, 0, run.durationMs));
  }

  /** Run the sun from where it stands to `to` (null: back to the hour) */
  private runSun(to: LatLon | null): void {
    this.sunRun = { from: this.sunNow(), to, startEpoch: epochNow(), durationMs: SUN_SWEEP_MS };
    this.send({ type: 'sun', run: this.sunRun });
  }

  // ---- Covering the game ----

  private fadeIn(): void {
    this.overlay?.fade(1, FADE_IN_MS);
  }

  // ---- Phases ----

  private boot(): void {
    this.collectMarks();
    this.createHost();
    this.phase.set('idle');
    const hq = this.locationMgmt.hq();
    if (hq && !this.coordinator.awaitingStartChoice()) this.onPlace(hq);
  }

  private turnOff(): void {
    this.failed.set(true);
    this.disposeHost();
    this.phase.set('off');
    this.hud.set(null);
  }

  private onPlace(hq: { lat: number; lon: number } | null): void {
    if (!hq) return;
    const phase = this.phase();
    const place = { lat: hq.lat, lon: hq.lon };
    const same = this.place !== null && isSamePlace(this.place, place);
    this.place = place;
    this.collectMarks();
    if (phase === 'off' || phase === 'gone' || phase === 'rising' || phase === 'handover') return;
    if (same && phase !== 'idle') return;
    this.send({ type: 'region', place });
    this.turnTo(place);
  }

  /**
   * Turn to the place, the whole earth in view, the place towards the
   * middle; the sun rises over it meanwhile if it lies in the night (D2):
   * it stands in day the whole time it loads.
   */
  private turnTo(place: LatLon): void {
    this.send({ type: 'idle', on: false });
    this.send({ type: 'hole', place, radius: 0, durationMs: 0 });
    this.runSun(landingSun(place, subsolarPoint(new Date())));
    const to: GlobeShot = { over: place, altitude: WAIT_ALTITUDE, aim: 0.15, shift: MENU_SHIFT, roll: 0 };
    const arc = arcDegrees(this.shot.over, place);
    this.phase.set('turning');
    this.animate(to, MathUtils.clamp(arc * 25, 1600, 3200), 'inOut', () => {
      this.phase.set('waiting');
      this.tryDive();
    });
  }

  private warmUpper(): void {
    const phase = this.phase();
    if (phase !== 'turning' && phase !== 'waiting') return;
    const hq = this.locationMgmt.hq();
    const camera = this.engineInit.getEngine()?.getCamera();
    if (!hq || !camera || camera.position.y >= RISEN_ALTITUDE) return;
    const key = `${hq.lat},${hq.lon}`;
    if (this.upperWarmed === key) return;
    const plan = this.diveFlight.planFromView();
    if (!plan) return;
    this.upperWarmed = key;
    void this.diveFlight.warm(plan, undefined, true);
  }

  private tryDive(): void {
    if (this.phase() !== 'waiting') return;
    if (this.engineInit.loading() || this.engineInit.error()) return;
    const engine = this.engineInit.getEngine();
    if (!engine || !this.place) return;
    // A change that did not happen (its streets did not load): back to the place that stands
    const hq = this.locationMgmt.hq();
    if (hq && !isSamePlace(hq, this.place)) {
      this.place = { lat: hq.lat, lon: hq.lon };
      this.collectMarks();
      this.turnTo(this.place);
      return;
    }
    const camera = engine.getCamera();
    const fromView = camera.position.y < RISEN_ALTITUDE ? this.diveFlight.planFromView() : null;
    const plan = fromView ?? this.risePlan;
    if (!plan) {
      // No tiles to dive into (a failed engine waits above)
      this.gone();
      return;
    }
    this.plan = plan;
    this.phase.set('warming');
    cameraTimeline.record('globe.warming');
    void this.diveFlight.warm(plan).then(() => {
      if (this.phase() !== 'warming' || this.plan !== plan) return;
      this.dive(plan);
    });
  }

  private dive(plan: DivePlan): void {
    const startEcef = this.diveFlight.startInEcef(plan, this.startEcef);
    if (!startEcef || !this.place) return;
    const heading = headingFromMatrix(startEcef, new Vector3());
    const hq = this.locationMgmt.hq() ?? this.place;
    const to: GlobeShot = { over: { lat: hq.lat, lon: hq.lon }, altitude: HANDOVER_ALTITUDE, aim: 1, shift: 0, roll: 1 };
    const globeSpan = Math.log(this.shot.altitude / HANDOVER_ALTITUDE);
    const gameSpan = Math.log(HANDOVER_ALTITUDE / plan.endAltitude);
    const total = this.link.playWaits() ? DIVE_MS_PLAY_WAITS : DIVE_MS;
    const { globeMs, gameMs } = diveDurations(Math.max(globeSpan, 0.1), gameSpan, total);
    this.phase.set('diving');
    this.send({ type: 'hole', place: { lat: hq.lat, lon: hq.lon }, radius: CLOUD_HOLE, durationMs: globeMs });
    cameraTimeline.record('globe.dive', { globeMs: Math.round(globeMs), gameMs: Math.round(gameMs) });
    // Quadratic ease-in on the log altitude: the speed at the joint is the game camera's start speed
    this.animate(to, globeMs, 'in', () => this.handOver(plan, gameMs), heading);
  }

  private handOver(plan: DivePlan, gameMs: number): void {
    const engine = this.engineInit.getEngine();
    if (!engine || !engine.sceneToEcef(this.toEcef)) return;
    this.phase.set('handover');
    this.descending.set(true);
    // Both fly the same path from the same instant: the game camera here, the globe in its runtime
    const startMs = performance.now();
    this.send({ type: 'follow', path: this.followPath(plan, startMs, gameMs, true) });
    this.overlay?.fade(0, HANDOVER_FADE_MS);
    setTimeout(() => {
      if (this.phase() === 'handover') this.gone();
    }, HANDOVER_FADE_MS + 50);
    void this.diveFlight.descend(plan, gameMs, null, startMs).then(() => {
      if (this.phase() === 'handover') this.gone();
      this.descending.set(false);
      this.plan = null;
      this.risePlan = null;
    });
  }

  private followPath(plan: DivePlan, startMs: number, durationMs: number, down: boolean): Extract<GlobeCommand, { type: 'follow' }>['path'] {
    const camera = this.engineInit.getEngine()!.getCamera();
    return {
      start: toArray(plan.start),
      end: toArray(plan.end),
      startAltitude: plan.startAltitude,
      endAltitude: plan.endAltitude,
      toEcef: toArray(this.toEcef),
      startEpoch: performance.timeOrigin + startMs,
      durationMs,
      down,
      fov: camera.fov,
    };
  }

  private gone(): void {
    this.disposeHost();
    this.phase.set('gone');
    this.hud.set(null);
    cameraTimeline.record('globe.gone');
  }

  /** The game camera rises out of the place, the globe takes over; resolves when it covers the game */
  beforeOriginChange(): Promise<void> {
    this.startRise();
    return this.rise ?? Promise.resolve();
  }

  private startRise(): void {
    if (this.phase() !== 'gone' || this.rise || !this.enabled()) return;
    const engine = this.engineInit.getEngine();
    const plan = this.diveFlight.planFromView();
    if (!engine || !plan) return;
    this.risePlan = plan;
    // The place the engine stands at; a change may have said its next one already
    const hq = this.locationMgmt.hq();
    this.riseFrom = hq ? { lat: hq.lat, lon: hq.lon } : this.place;
    // The place stands in day in the tiles: so does the globe the camera rises into
    const day = this.riseFrom ? landingSun(this.riseFrom, subsolarPoint(new Date())) : null;
    this.sunRun = day ? { from: day, to: day, startEpoch: 0, durationMs: 1 } : null;
    this.phase.set('rising');
    this.generation.update((g) => g + 1);
    const done = this.flyUp(plan).finally(() => {
      this.rise = null;
    });
    this.rise = done;
  }

  private async flyUp(plan: DivePlan): Promise<void> {
    cameraTimeline.record('globe.rise');
    const engine = this.engineInit.getEngine();
    if (!engine || !engine.sceneToEcef(this.toEcef)) return;
    // The new canvas comes with the next render; its runtime loads its first textures meanwhile
    await this.untilReady();
    // The fresh context's first frame is slow (the driver sets it up): drawn now, unseen, while the game stands still
    await this.prime();
    await this.diveFlight.warmRise(plan);
    if (this.phase() !== 'rising') return;
    const startMs = performance.now();
    this.send({ type: 'follow', path: this.followPath(plan, startMs, RISE_MS, false) });
    this.overlay?.fade(1, RISE_MS * (RISE_FADE_TO - RISE_FADE_FROM), RISE_MS * RISE_FADE_FROM);
    await this.diveFlight.ascend(plan, RISE_MS, null, startMs);
    if (this.phase() !== 'rising') return;
    // On from straight above the old place to the place the change goes to
    const from = this.riseFrom ?? this.place ?? { lat: 0, lon: 0 };
    const startEcef = this.diveFlight.startInEcef(plan, this.startEcef);
    const heading = startEcef ? headingFromMatrix(startEcef, new Vector3()) : null;
    this.shot = { over: from, altitude: HANDOVER_ALTITUDE, aim: 1, shift: 0, roll: 1 };
    this.send({ type: 'shot', shot: this.shot, heading: heading ? [heading.x, heading.y, heading.z] : null });
    this.send({ type: 'follow', path: null });
    const to = this.place ?? from;
    this.place = to;
    this.send({ type: 'region', place: to });
    this.turnTo(to);
  }

  private untilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return Promise.race([
      new Promise<void>((resolve) => this.readyWaiters.push(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, VIEW_READY_TIMEOUT_MS)),
    ]);
  }

  private prime(): Promise<void> {
    if (!this.host) return Promise.resolve();
    return new Promise((resolve) => {
      this.primeWaiter = resolve;
      this.send({ type: 'prime' });
    });
  }

  // ---- Marks and read-out ----

  private collectMarks(): void {
    const marks: GlobeMark[] = [];
    const add = (mark: GlobeMark) => {
      if (marks.some((m) => isSamePlace(m, mark))) return;
      marks.push(mark);
    };
    if (this.place) add({ kind: 'target', name: this.placeName() ?? '', ...this.place });
    for (const r of this.bestWaves.records()) add({ kind: 'record', name: r.name, wave: r.bestWave, ...r.hq });
    for (const f of loadFavoriteLocations()) add({ kind: 'favorite', name: f.name ?? '', ...f.hq });
    for (const r of loadRecentLocations()) add({ kind: 'recent', name: shortPlaceName(r.name), ...r.hq });
    this.marks = marks;
    this.overlay?.setMarks(marks);
    this.send({ type: 'marks', points: marks.flatMap((m) => [m.lat, m.lon]) });
  }

  private placeName(): string | null {
    const name = this.locationMgmt.displayName();
    return name === NO_LOCATION_NAME || name === LOADING_NAME ? null : shortPlaceName(name);
  }

  private updateHud(): void {
    const now = performance.now();
    if (now - this.hudAtMs < HUD_MS) return;
    this.hudAtMs = now;
    const status: Record<GlobePhase, string> = {
      off: '',
      idle: '',
      turning: 'Locating',
      waiting: 'Loading',
      warming: 'Loading the descent',
      diving: 'Descending',
      handover: 'Descending',
      gone: '',
      rising: 'Ascending',
    };
    const place = this.place;
    const name = this.placeName();
    const hud: GlobeHud = {
      name: place ? name : null,
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
      altitudeKm: Math.max(0, Math.round(this.altitude / 1000)),
      status: status[this.phase()],
    };
    this.zone.run(() => this.hud.set(hud));
  }

  /**
   * DevTools: `__globe.shot({ lat, lon, altitude, aim, shift })` holds the
   * camera on a shot, `__globe.sun(lat, lon)` the sun overhead there,
   * `__globe.release()` lets both go, `__globe.state()` tells the phase and
   * the shot, `__globe.timing()` the longest main-thread work of each kind
   * (the runtime's as last asked, the warm-up's here).
   */
  private registerConsole(): void {
    let debugShot: GlobeShot | null = null;
    let debugSun: LatLon | null = null;
    const push = () => this.send({ type: 'debug', shot: debugShot, sun: debugSun });
    (globalThis as Record<string, unknown>)['__globe'] = {
      state: () => ({ phase: this.phase(), shot: debugShot ?? this.shot, covering: this.coversGame(), offThread: this.host?.offThread }),
      shot: (shot: Partial<GlobeShot> & Partial<LatLon>) => {
        const base = debugShot ?? this.shot;
        debugShot = {
          over: { lat: shot.lat ?? base.over.lat, lon: shot.lon ?? base.over.lon },
          altitude: shot.altitude ?? base.altitude,
          aim: shot.aim ?? base.aim,
          shift: shot.shift ?? base.shift,
          roll: shot.roll ?? 0,
        };
        push();
      },
      sun: (lat: number | null, lon = 0) => {
        debugSun = lat === null ? null : { lat, lon };
        push();
      },
      release: () => {
        debugShot = null;
        debugSun = null;
        push();
      },
      timing: () => {
        this.send({ type: 'timing' });
        return { ...this.runtimeTiming, ...DiveView.timing };
      },
    };
  }
}
