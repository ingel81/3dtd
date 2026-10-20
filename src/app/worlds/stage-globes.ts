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

/**
 * How long the squares are read again every frame after something that moves them: the hover's scale and a
 * card's size are CSS transitions of --td-dur-slow (450 ms), with room to spare
 */
const SETTLE_MS = 600;

/** A globe's still picture (the menu's Continue): drawn this large, CSS pixels, shown smaller for a crisp edge */
const PICTURE_SIZE = 64;

/** A globe's square on the stage's canvas, CSS pixels */
export interface GlobeSquare {
  el: HTMLElement;
  globe: StageGlobeId;
  x: number;
  y: number;
  size: number;
}

/**
 * The squares of the globes (`[data-globe]` in `host`) and which globes the
 * pointer or the keyboard's focus is on (E207). The places are read again
 * only after something that moves them: a resize, a change of the page
 * (another view, a card's size), the hover; then every frame for SETTLE_MS
 * while their transitions run. At rest a frame reads nothing from the
 * layout. The hover comes from the events of the cards and mini globes
 * (pointer over and out, focus in and out with :focus-visible).
 */
export class GlobeSquares {
  private list: GlobeSquare[] = [];
  private dirty = true;
  private settleUntil = 0;
  private pointerOn: Element | null = null;
  private focusOn: Element | null = null;
  private readonly hover = new Set<StageGlobeId>();
  private readonly observers: { disconnect(): void }[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLElement,
    private readonly clock: () => number = () => performance.now(),
  ) {
    host.addEventListener('pointerover', this.onPointerOver);
    host.addEventListener('pointerleave', this.onPointerLeave);
    host.addEventListener('focusin', this.onFocusIn);
    host.addEventListener('focusout', this.onFocusOut);
    if (typeof ResizeObserver !== 'undefined') {
      const resizes = new ResizeObserver(this.touch);
      resizes.observe(canvas);
      resizes.observe(host);
      this.observers.push(resizes);
    }
    if (typeof MutationObserver !== 'undefined') {
      const changes = new MutationObserver(this.touch);
      changes.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-globe'] });
      this.observers.push(changes);
    }
  }

  /** The squares now: read again only while something moves them */
  read(): readonly GlobeSquare[] {
    if (!this.dirty && this.clock() >= this.settleUntil) return this.list;
    this.dirty = false;
    const base = this.canvas.getBoundingClientRect();
    this.list = [...this.host.querySelectorAll<HTMLElement>('[data-globe]')].map((el) => {
      const rect = el.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      return { el, globe: el.dataset['globe'] as StageGlobeId, x: rect.left - base.left + (rect.width - size) / 2, y: rect.top - base.top + (rect.height - size) / 2, size };
    });
    return this.list;
  }

  /** The squares are moving (a transition runs): the stage draws every frame meanwhile */
  get moving(): boolean {
    return this.dirty || this.clock() < this.settleUntil;
  }

  /** The pointer or the keyboard's focus is on this globe's card or mini globe */
  hovered(globe: StageGlobeId): boolean {
    return this.hover.has(globe);
  }

  get anyHovered(): boolean {
    return this.hover.size > 0;
  }

  dispose(): void {
    this.host.removeEventListener('pointerover', this.onPointerOver);
    this.host.removeEventListener('pointerleave', this.onPointerLeave);
    this.host.removeEventListener('focusin', this.onFocusIn);
    this.host.removeEventListener('focusout', this.onFocusOut);
    for (const o of this.observers) o.disconnect();
  }

  /** Something moved the squares: read them again, every frame while their transitions run */
  private readonly touch = (): void => {
    this.dirty = true;
    this.settleUntil = this.clock() + SETTLE_MS;
  };

  /** The button around `target` that holds a globe, null for anything else */
  private globeButton(target: EventTarget | null): Element | null {
    const button = target instanceof Element ? target.closest('button') : null;
    return button && this.host.contains(button) && button.querySelector('[data-globe]') ? button : null;
  }

  private readonly onPointerOver = (e: Event): void => this.setOn('pointer', this.globeButton(e.target));
  private readonly onPointerLeave = (): void => this.setOn('pointer', null);
  private readonly onFocusIn = (e: Event): void => {
    const button = this.globeButton(e.target);
    this.setOn('focus', button && button.matches(':focus-visible') ? button : null);
  };
  private readonly onFocusOut = (): void => this.setOn('focus', null);

  private setOn(by: 'pointer' | 'focus', button: Element | null): void {
    if ((by === 'pointer' ? this.pointerOn : this.focusOn) === button) return;
    if (by === 'pointer') this.pointerOn = button;
    else this.focusOn = button;
    this.hover.clear();
    for (const on of [this.pointerOn, this.focusOn]) {
      const globe = on?.querySelector<HTMLElement>('[data-globe]')?.dataset['globe'] as StageGlobeId | undefined;
      if (globe) this.hover.add(globe);
    }
    // The hover's scale is a transition of the square
    this.touch();
  }
}

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
  private squares: GlobeSquares | null = null;
  /** Each globe's spin now, degrees a second (IDLE_DEG_PER_S, up to HOVER_DEG_PER_S under the pointer) */
  private readonly spin: Record<StageGlobeId, number> = { real: IDLE_DEG_PER_S, osm: IDLE_DEG_PER_S, maps: IDLE_DEG_PER_S };
  private readonly centers: Record<StageGlobeId, LatLon> = {
    real: { lat: 22, lon: 10 },
    osm: { lat: 28, lon: -60 },
    maps: { lat: 18, lon: 30 },
  };
  /** Where each still picture looks: the globes' first faces, the earth's on the player's home */
  private readonly pictureCenters: Record<StageGlobeId, LatLon> = structuredClone(this.centers);
  /** The globes whose still picture is still to take: all once the earth's maps are up, the maps' after new towers */
  private readonly toPicture = new Set<StageGlobeId>();
  private pictureCtx: CanvasRenderingContext2D | null = null;
  private ready = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly state: (globe: StageGlobeId) => StageGlobeState,
    private readonly mark: () => { globe: StageGlobeId; at: LatLon } | null,
    private readonly onFailed: () => void,
    /** A globe's still picture as a PNG data URL: once per globe a visit, the maps' again after its towers changed */
    private readonly onPicture: (globe: StageGlobeId, url: string) => void = () => undefined,
  ) {}

  /** The maps' globe: a tower per map, the pick in brass; returns where a map's tower stands */
  setMaps(maps: readonly { id: string }[], picked: string | null): void {
    if (!this.stage) return;
    this.stage.maps.setMaps(maps, picked);
    if (this.ready) this.toPicture.add('maps');
  }

  spotOf(mapId: string): LatLon | null {
    return this.stage?.maps.spotOf(mapId) ?? null;
  }

  start(quality: GlobeQuality, homeLon: number): void {
    this.centers.real.lon = homeLon;
    this.pictureCenters.real.lon = homeLon;
    let stage: GlobeStage;
    try {
      stage = new GlobeStage(this.canvas, quality, { pixelRatio: window.devicePixelRatio, baseUrl: document.baseURI });
    } catch (err) {
      console.warn('[Worlds] no globes:', err);
      this.onFailed();
      return;
    }
    this.stage = stage;
    // The pictures wait for the earth's maps (OpenStreetMap's globe draws from them too)
    stage.ready.then(() => {
      if (this.stage !== stage) return;
      this.ready = true;
      for (const g of ['real', 'osm', 'maps'] as const) this.toPicture.add(g);
    }, () => undefined);
    this.canvas.addEventListener('webglcontextlost', this.lost);
    const size = () => this.stage?.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    size();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizer = new ResizeObserver(size);
      this.resizer.observe(this.canvas);
    }
    this.squares = new GlobeSquares(this.host, this.canvas);
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizer?.disconnect();
    this.squares?.dispose();
    this.squares = null;
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
    const squares = this.squares;
    if (!stage || !squares) return;
    const spinning = squares.anyHovered || (['real', 'osm', 'maps'] as const).some((g) => Math.abs(this.spin[g] - IDLE_DEG_PER_S) > 0.05);
    const moving = squares.moving || spinning || (['real', 'osm', 'maps'] as const).some((g) => {
      const target = this.state(g).target;
      return target !== null && (Math.abs(target.lat - this.centers[g].lat) > 0.05 || Math.abs(lonDelta(this.centers[g].lon, target.lon)) > 0.05);
    });
    if (!moving && this.toPicture.size === 0 && now - this.last < IDLE_FRAME_MS) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    // Before the frame's globes, which draw over them in this same frame
    if (this.toPicture.size > 0) this.takePictures(stage);

    const slots: StageSlot[] = [];
    const mark = this.mark();
    const k = 1 - Math.exp(-SPIN_RATE * dt);
    for (const g of ['real', 'osm', 'maps'] as const) {
      const wanted = squares.hovered(g) ? HOVER_DEG_PER_S : IDLE_DEG_PER_S;
      this.spin[g] += (wanted - this.spin[g]) * k;
    }
    for (const { el, globe, x, y, size } of squares.read()) {
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

  /** The still pictures still to take, each read back into a small canvas at once */
  private takePictures(stage: GlobeStage): void {
    this.pictureCtx ??= document.createElement('canvas').getContext('2d');
    const ctx = this.pictureCtx;
    // One try each: a canvas too small for it keeps the disc (no frames spent asking again)
    for (const globe of this.toPicture) {
      if (ctx && stage.picture(globe, this.pictureCenters[globe], PICTURE_SIZE, epochNow(), ctx)) this.onPicture(globe, ctx.canvas.toDataURL('image/png'));
    }
    this.toPicture.clear();
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
