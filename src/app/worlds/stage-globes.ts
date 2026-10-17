import { MathUtils } from 'three';
import { GlobeStage, type StageGlobeId, type StageSlot } from '../globe/globe-stage';
import type { LatLon } from '../globe/globe-geo';
import type { GlobeQuality } from '../globe/globe-textures';
import { epochNow } from '../globe/globe-runtime';

/** What a globe shows this frame, as the stage asks it */
export interface StageGlobeState {
  /** The point to turn to (the pick), null: turn slowly on its own */
  target: LatLon | null;
  /** 0 grey (locked) to 1 */
  saturation: number;
}

/** Degrees a globe turns per second while nothing is picked */
const IDLE_DEG_PER_S = 4;
/** ... and while the pointer or the keyboard's focus is on it (E207): it wakes up and turns toward the player */
const HOVER_DEG_PER_S = 36;
/** How fast the spin follows: the share of the way per second (exponential), so it speeds up and settles softly */
const SPIN_RATE = 3;
/** How fast a globe turns to its target: the share of the way per second (exponential) */
const TURN_RATE = 3.2;
/** Frames while only idling: 30 a second, as the menu globe */
const IDLE_FRAME_MS = 1000 / 30;

/** The shortest way from one longitude to another, degrees */
function lonDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Drives the globes of the stage (docs/WORLDS_NAVIGATION_PLAN.md, 4.3): reads
 * the squares the page holds for them (`[data-globe]`, the big one with
 * `data-globe-mark` carries the pick's mark), turns each globe to its pick
 * or slowly on its own, and draws them all with one GlobeStage. Runs
 * outside Angular on requestAnimationFrame; the mark is moved straight in
 * the DOM.
 */
export class StageGlobes {
  private stage: GlobeStage | null = null;
  private raf = 0;
  private last = 0;
  private resizer: ResizeObserver | null = null;
  /** Each globe's spin now, degrees a second (IDLE_DEG_PER_S, up to HOVER_DEG_PER_S under the pointer) */
  private readonly spin: Record<StageGlobeId, number> = { real: IDLE_DEG_PER_S, osm: IDLE_DEG_PER_S, maps: IDLE_DEG_PER_S };
  /** The squares' places last drawn: a square that moves or grows (the hover's scale) draws every frame */
  private lastLayout = '';
  private readonly centers: Record<StageGlobeId, LatLon> = {
    real: { lat: 22, lon: 10 },
    osm: { lat: 28, lon: -60 },
    maps: { lat: 18, lon: 30 },
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly state: (globe: StageGlobeId) => StageGlobeState,
    private readonly mark: () => { globe: StageGlobeId; at: LatLon } | null,
    private readonly onFailed: () => void,
  ) {}

  /** The maps' globe: a tower per map, the pick in brass; returns where a map's tower stands */
  setMaps(maps: readonly { id: string }[], picked: string | null): void {
    this.stage?.maps.setMaps(maps, picked);
  }

  spotOf(mapId: string): LatLon | null {
    return this.stage?.maps.spotOf(mapId) ?? null;
  }

  start(quality: GlobeQuality, homeLon: number): void {
    this.centers.real.lon = homeLon;
    try {
      this.stage = new GlobeStage(this.canvas, quality, { pixelRatio: window.devicePixelRatio, baseUrl: document.baseURI });
    } catch (err) {
      console.warn('[Worlds] no globes:', err);
      this.onFailed();
      return;
    }
    this.canvas.addEventListener('webglcontextlost', this.lost);
    const size = () => this.stage?.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    size();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizer = new ResizeObserver(size);
      this.resizer.observe(this.canvas);
    }
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizer?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.stage?.dispose();
    this.stage = null;
  }

  private readonly lost = (): void => {
    this.dispose();
    this.onFailed();
  };

  private frame(now: number): void {
    const stage = this.stage;
    if (!stage) return;
    const base = this.canvas.getBoundingClientRect();
    const squares: { el: HTMLElement; globe: StageGlobeId; x: number; y: number; size: number; hover: boolean }[] = [];
    let layout = '';
    for (const el of this.host.querySelectorAll<HTMLElement>('[data-globe]')) {
      const rect = el.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const x = rect.left - base.left + (rect.width - size) / 2;
      const y = rect.top - base.top + (rect.height - size) / 2;
      // The card or mini globe it stands in, under the pointer or focused by the keyboard
      const hover = el.closest('button')?.matches(':hover, :focus-visible') ?? false;
      squares.push({ el, globe: el.dataset['globe'] as StageGlobeId, x, y, size, hover });
      layout += `${x.toFixed(1)},${y.toFixed(1)},${size.toFixed(1)};`;
    }
    const moved = layout !== this.lastLayout;
    const waking = squares.some((q) => q.hover) || (['real', 'osm', 'maps'] as const).some((g) => Math.abs(this.spin[g] - IDLE_DEG_PER_S) > 0.05);
    const moving = moved || waking || (['real', 'osm', 'maps'] as const).some((g) => {
      const target = this.state(g).target;
      return target !== null && (Math.abs(target.lat - this.centers[g].lat) > 0.05 || Math.abs(lonDelta(this.centers[g].lon, target.lon)) > 0.05);
    });
    if (!moving && now - this.last < IDLE_FRAME_MS) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.lastLayout = layout;

    const slots: StageSlot[] = [];
    const mark = this.mark();
    const k = 1 - Math.exp(-SPIN_RATE * dt);
    for (const g of ['real', 'osm', 'maps'] as const) {
      const wanted = squares.some((q) => q.globe === g && q.hover) ? HOVER_DEG_PER_S : IDLE_DEG_PER_S;
      this.spin[g] += (wanted - this.spin[g]) * k;
    }
    for (const { el, globe, x, y, size } of squares) {
      const state = this.state(globe);
      this.turn(globe, state.target, dt);
      slots.push({
        globe,
        x,
        y,
        size,
        center: this.centers[globe],
        saturation: state.saturation,
        mark: mark && mark.globe === globe && 'globeMark' in el.dataset ? mark.at : null,
      });
    }
    const spots = stage.render(slots, epochNow());
    const markEl = this.host.querySelector<HTMLElement>('[data-mark]');
    if (!markEl) return;
    const i = slots.findIndex((s) => s.mark !== null);
    const spot = i >= 0 ? spots[i] : null;
    if (!spot || !spot.facing) {
      markEl.style.visibility = 'hidden';
      return;
    }
    markEl.style.visibility = 'visible';
    markEl.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px) translateY(-50%)`;
  }

  /** Toward the target the shortest way, or on round slowly */
  private turn(globe: StageGlobeId, target: LatLon | null, dt: number): void {
    const c = this.centers[globe];
    if (!target) {
      c.lon = ((c.lon + this.spin[globe] * dt + 540) % 360) - 180;
      return;
    }
    const k = 1 - Math.exp(-TURN_RATE * dt);
    // Not over a pole: the globe would turn its face away
    const lat = MathUtils.clamp(target.lat, -70, 70);
    c.lat += (lat - c.lat) * k;
    c.lon = ((c.lon + lonDelta(c.lon, target.lon) * k + 540) % 360) - 180;
  }
}
