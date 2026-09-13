import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TD_CSS_VARS, TD_FONTS, TD_THEME } from '../../styles/td-theme';
import { BestWave, byBestWave } from '../../services/location/best-waves';
import { isSamePlace } from '../../services/location/recent-locations';
import { BORDERS, COASTLINES, OUTLINE_FACTOR } from './world-outlines.data';
import {
  GlobeLines,
  GlobeView,
  LabelBox,
  ScreenPoint,
  clampZoom,
  dragged,
  graticule,
  lerpCenter,
  nearestPoint,
  placeLabels,
  project,
  toGlobeLines,
  traceLines,
  viewRotation,
} from './globe-projection';

interface LatLon {
  lat: number;
  lon: number;
}

/** Centre when there is no place to show yet: Europe and Africa, most of the land in view */
const DEFAULT_CENTER: LatLon = { lat: 30, lon: 10 };
/** Space between the rim at zoom 1 and the canvas edge, px */
const RIM_MARGIN = 8;
const HOVER_RADIUS = 10;
/** Pointer travel under which a press counts as a click, not a drag */
const CLICK_SLOP = 4;
const TURN_MS = 700;
const WHEEL_ZOOM = 0.0015;
/** Markers fade out over the last part before the rim */
const RIM_FADE_DEPTH = 0.2;

/** Coastlines, borders and graticule, decoded once on the first globe */
let outlines: { coast: GlobeLines; borders: GlobeLines; grid: GlobeLines } | null = null;
function worldOutlines(): { coast: GlobeLines; borders: GlobeLines; grid: GlobeLines } {
  outlines ??= {
    coast: toGlobeLines(COASTLINES, OUTLINE_FACTOR),
    borders: toGlobeLines(BORDERS, OUTLINE_FACTOR),
    grid: graticule(),
  };
  return outlines;
}

export interface GlobeHover {
  record: BestWave;
  isCurrent: boolean;
  x: number;
  y: number;
  /** The tip goes under the marker when there is no room above it */
  below: boolean;
}

/**
 * A small globe with the defended places and their best wave, drawn on a
 * 2D canvas in orthographic projection: coastlines and land borders from
 * Natural Earth, markers in gold with the wave next to them. Drag turns it,
 * the wheel zooms, hover names a place, a click emits it.
 *
 * Drawing is imperative and runs outside Angular; only the hover tip goes
 * through a signal, and only when the hovered place changes.
 */
@Component({
  selector: 'app-world-globe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './world-globe.component.html',
  styleUrl: './world-globe.component.scss',
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }
  `,
})
export class WorldGlobeComponent implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** Places with their best wave */
  readonly records = input.required<readonly BestWave[]>();
  /** Place to turn to and ring in gold: the new record, a hovered row */
  readonly highlight = input<LatLon | null>(null);
  /** The place being played, ringed in grey and not clickable */
  readonly current = input<LatLon | null>(null);
  /** Edge of the square canvas, CSS px */
  readonly size = input(300);
  /** Clicks on a marker emit it */
  readonly selectable = input(true);

  readonly picked = output<BestWave>();

  readonly hover = signal<GlobeHover | null>(null);
  readonly ariaLabel = computed(() => {
    const n = this.records().length;
    return n === 0 ? 'World map, no places defended yet' : `World map, ${n} ${n === 1 ? 'place' : 'places'} defended`;
  });

  /** Lowest wave first, so the higher records are drawn on top */
  private readonly drawOrder = computed(() => [...this.records()].sort((a, b) => byBestWave(b, a)));

  private ctx: CanvasRenderingContext2D | null = null;
  private center: LatLon = DEFAULT_CENTER;
  private zoom = 1;
  private turn: { from: LatLon; to: LatLon; start: number } | null = null;
  private frame = 0;
  private press: { id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;
  /** Screen position of every marker of the last frame, same order as drawOrder() */
  private markerPoints: ScreenPoint[] = [];
  private view: GlobeView | null = null;
  private readonly listeners = new AbortController();

  constructor() {
    afterNextRender(() => {
      this.ctx = this.canvasRef().nativeElement.getContext('2d');
      this.center = this.startCenter();
      this.zone.runOutsideAngular(() => this.listen(this.canvasRef().nativeElement));
      this.requestDraw();
    });

    // A new highlight turns the globe to it; the first one is where it starts
    effect(() => {
      const target = this.highlight();
      untracked(() => {
        if (target && this.ctx) this.turnTo(target);
      });
    });
    effect(() => {
      this.drawOrder();
      this.current();
      this.size();
      untracked(() => this.requestDraw());
    });
  }

  ngOnDestroy(): void {
    this.listeners.abort();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private startCenter(): LatLon {
    const best = this.drawOrder().at(-1);
    return this.highlight() ?? this.current() ?? (best ? best.hq : DEFAULT_CENTER);
  }

  private turnTo(target: LatLon): void {
    this.turn = { from: { ...this.center }, to: { lat: target.lat, lon: target.lon }, start: performance.now() };
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frame || !this.ctx) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
        if (this.turn) this.requestDraw();
      });
    });
  }

  private listen(canvas: HTMLCanvasElement): void {
    const signal = this.listeners.signal;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = local(e);
      canvas.setPointerCapture(e.pointerId);
      this.press = { id: e.pointerId, x: p.x, y: p.y, lastX: p.x, lastY: p.y, moved: false };
      this.turn = null;
    }, { signal });

    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      const press = this.press;
      if (press && press.id === e.pointerId && this.view) {
        if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > CLICK_SLOP) {
          press.moved = true;
          canvas.style.cursor = 'grabbing';
          this.setHover(null);
        }
        if (press.moved) {
          this.center = dragged(this.view, p.x - press.lastX, p.y - press.lastY);
          press.lastX = p.x;
          press.lastY = p.y;
          this.requestDraw();
        }
        return;
      }
      this.hoverAt(canvas, p.x, p.y);
    }, { signal });

    const release = (e: PointerEvent) => {
      const press = this.press;
      if (!press || press.id !== e.pointerId) return;
      this.press = null;
      canvas.style.cursor = '';
      if (press.moved || e.type === 'pointercancel') return;
      const hit = this.markerAt(press.x, press.y);
      if (hit && !hit.isCurrent && this.selectable()) this.zone.run(() => this.picked.emit(hit.record));
    };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
    canvas.addEventListener('pointerleave', () => {
      if (!this.press) this.setHover(null);
    }, { signal });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = clampZoom(this.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM));
      this.setHover(null);
      this.requestDraw();
    }, { signal, passive: false });
  }

  private markerAt(x: number, y: number): { record: BestWave; isCurrent: boolean; point: ScreenPoint } | null {
    const i = nearestPoint(this.markerPoints, x, y, HOVER_RADIUS);
    if (i < 0) return null;
    const record = this.drawOrder()[i];
    const current = this.current();
    return { record, isCurrent: !!current && isSamePlace(record.hq, current), point: this.markerPoints[i] };
  }

  private hoverAt(canvas: HTMLCanvasElement, x: number, y: number): void {
    const hit = this.markerAt(x, y);
    canvas.style.cursor = hit && !hit.isCurrent && this.selectable() ? 'pointer' : '';
    this.setHover(hit
      ? { record: hit.record, isCurrent: hit.isCurrent, x: hit.point.x, y: hit.point.y, below: hit.point.y < 56 }
      : null);
  }

  private setHover(next: GlobeHover | null): void {
    const prev = this.hover();
    if (prev?.record === next?.record && prev?.x === next?.x && prev?.y === next?.y) return;
    this.zone.run(() => this.hover.set(next));
    this.requestDraw();
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = this.size();
    const canvas = ctx.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }

    if (this.turn) {
      const t = Math.min(1, (performance.now() - this.turn.start) / TURN_MS);
      this.center = lerpCenter(this.turn.from, this.turn.to, 1 - (1 - t) ** 3);
      if (t >= 1) this.turn = null;
    }

    const view: GlobeView = {
      lat: this.center.lat,
      lon: this.center.lon,
      radius: (size / 2 - RIM_MARGIN) * this.zoom,
      cx: size / 2,
      cy: size / 2,
    };
    this.view = view;
    const rot = viewRotation(view.lat, view.lon);
    const { coast, borders, grid } = worldOutlines();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.radius, 0, Math.PI * 2);
    ctx.fillStyle = TD_THEME.panelShadow;
    ctx.fill();

    this.strokeLines(ctx, grid, view, rot, TD_THEME.frameDark, 1);
    this.strokeLines(ctx, borders, view, rot, TD_THEME.frameMid, 0.8);
    this.strokeLines(ctx, coast, view, rot, TD_THEME.textTertiary, 1);

    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.radius, 0, Math.PI * 2);
    ctx.strokeStyle = TD_THEME.frameMid;
    ctx.lineWidth = 1;
    ctx.stroke();

    this.drawMarkers(ctx, view, rot);
  }

  private strokeLines(
    ctx: CanvasRenderingContext2D,
    lines: GlobeLines,
    view: GlobeView,
    rot: ReturnType<typeof viewRotation>,
    color: string,
    width: number,
  ): void {
    ctx.beginPath();
    traceLines(ctx, lines, view, rot);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, view: GlobeView, rot: ReturnType<typeof viewRotation>): void {
    const records = this.drawOrder();
    const highlight = this.highlight();
    const current = this.current();
    const hovered = this.hover()?.record;
    this.markerPoints = records.map((r) => project(r.hq.lat, r.hq.lon, view, rot));

    // The place being played without a record yet still gets its ring
    if (current && !records.some((r) => isSamePlace(r.hq, current))) {
      const p = project(current.lat, current.lon, view, rot);
      if (p.depth > 0) this.ring(ctx, p, 6, TD_THEME.textSecondary, 1, this.fade(p));
    }

    const labels: { box: LabelBox; text: string; color: string; alpha: number; rank: number }[] = [];
    ctx.font = `10px ${TD_FONTS.mono}`;
    records.forEach((r, i) => {
      const p = this.markerPoints[i];
      if (p.depth <= 0) return;
      const alpha = this.fade(p);
      const isHighlight = !!highlight && isSamePlace(r.hq, highlight);
      const isCurrent = !!current && isSamePlace(r.hq, current);
      const strong = isHighlight || r === hovered;

      if (isCurrent) this.ring(ctx, p, 7, TD_THEME.textSecondary, 1, alpha);
      if (isHighlight) this.ring(ctx, p, 9, TD_THEME.gold, 1.5, alpha);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, strong ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = strong ? TD_THEME.goldLight : TD_THEME.gold;
      ctx.fill();
      ctx.strokeStyle = '#1A140A';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      const text = String(r.bestWave);
      const w = ctx.measureText(text).width;
      labels.push({
        box: { x: p.x + 7, y: p.y - 6, w, h: 11 },
        text,
        color: strong ? TD_THEME.goldLight : TD_THEME.textSecondary,
        alpha,
        rank: strong ? Number.MAX_SAFE_INTEGER : r.bestWave,
      });
    });

    // Highlighted and hovered first, then the higher waves; a label that would overlap one already placed is left out
    labels.sort((a, b) => b.rank - a.rank);
    const shown = placeLabels(labels.map((l) => l.box));
    ctx.textBaseline = 'middle';
    labels.forEach((l, i) => {
      if (!shown[i]) return;
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.box.x, l.box.y + l.box.h / 2);
    });
    ctx.globalAlpha = 1;
  }

  private ring(ctx: CanvasRenderingContext2D, p: ScreenPoint, r: number, color: string, width: number, alpha: number): void {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Full strength on the face of the globe, fading out towards the rim */
  private fade(p: ScreenPoint): number {
    return Math.min(1, Math.max(0.25, p.depth / RIM_FADE_DEPTH));
  }
}
