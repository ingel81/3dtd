import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  ViewChildren,
  QueryList,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { LosDebugService, HoveredPixelState } from '../../services/debug/los-debug.service';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { FACE_LABELS, FACE_CROSS_LAYOUT } from '../../utils/los-debug-pixel-math';

const FACE_DISPLAY_MIN_PX = 64;
const FACE_DISPLAY_MAX_PX = 360;
const FACE_DISPLAY_DEFAULT_PX = 96;
/** Geschätzter Platzbedarf für Panel-Chrome neben dem 4×3-Face-Grid:
 *  draggable-Panel-Header (~32), .debug-panel-content Padding (16),
 *  .los-content Header (~26), Legend (~22), Readout-Row (~160) +
 *  Gaps (8×3 = 24) + Safety-Padding (60). Real-World Renderings
 *  weichen oft ein paar px ab (line-height, sub-pixel rounding) — knapp
 *  rechnen löst eine Scrollbar aus, die ihrerseits horizontal Platz
 *  klaut und mehr Overflow erzeugt. Daher lieber großzügig. */
const CHROME_HEIGHT_BUDGET_PX = 32 + 16 + 26 + 22 + 160 + 24 + 60;
/** Width-Budget: panel-content padding (16) + Scrollbar-Reserve (16) +
 *  breathing room (8). Scrollbar tritt eher vertikal auf, aber auch eine
 *  unsichtbare 15px-Reserve schadet hier nicht. */
const CHROME_WIDTH_BUDGET_PX = 16 + 16 + 8;
/** Zoom-Viewport: zeigt einen `ZOOM_SOURCE_PX × ZOOM_SOURCE_PX` Ausschnitt
 *  der Cubemap-Face um den hover-pixel, hoch-skaliert auf das Canvas. */
const ZOOM_SOURCE_PX = 24;
const ZOOM_CANVAS_PX = 144;

@Component({
  selector: 'app-los-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.losWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="los"
        title="LOS Cubemap"
        icon="eye"
        [position]="windowService.losWindow().position"
        [zIndex]="windowService.losWindow().zIndex"
        [size]="windowService.losWindow().size ?? { width: 440, height: 540 }"
        [resizable]="true"
        (closed)="windowService.close('los')"
        (positionChange)="windowService.updatePosition('los', $event)"
        (sizeChange)="windowService.updateSize('los', $event)"
        (focused)="windowService.bringToFront('los')"
      >
        <div class="los-content">
          <!-- Header: Tower-Info + Layer-Toggle -->
          <div class="los-header">
            @if (losDebug.activeTower(); as t) {
              <span class="active-tower">{{ t.typeConfig.id }} · {{ losDebug.cellCount() }} cells</span>
            } @else if (mapperReady()) {
              <span class="active-tower">Build-Preview (no cell-hover)</span>
            } @else {
              <span class="active-tower muted">No tower selected</span>
            }
            <div class="layer-toggle">
              <button [class.active]="layer() === 'ground'" (click)="setLayer('ground')">Ground</button>
              <button [class.active]="layer() === 'air'" (click)="setLayer('air')">Air</button>
            </div>
          </div>

          <!-- 4×3 Cross-Layout -->
          <div
            class="cross-grid"
            #crossGrid
            [style.grid-template-columns]="'repeat(4, ' + faceDisplayPx() + 'px)'"
            [style.grid-template-rows]="'repeat(3, ' + faceDisplayPx() + 'px)'"
            [style.width.px]="faceDisplayPx() * 4 + 6"
          >
            @for (f of faceOrder; track f.face) {
              <div
                class="face-slot"
                [style.grid-column]="f.col + 1"
                [style.grid-row]="f.row + 1"
                [style.width.px]="faceDisplayPx()"
                [style.height.px]="faceDisplayPx()"
              >
                <canvas
                  #faceCanvas
                  [width]="faceSize"
                  [height]="faceSize"
                  [attr.data-face]="f.face"
                  (mousemove)="onCanvasMove($event, f.face)"
                  (mouseleave)="onCanvasLeave()"
                ></canvas>
                <span class="face-label">{{ f.label }}</span>
              </div>
            }
          </div>

          <!-- Color-Legende: Mapping depth → color (single source of truth
               passt zum Shader in TowerShadowMapper.ensureDebugResources) -->
          <div class="legend">
            <span class="legend-label">Blocker nah</span>
            <span class="legend-gradient"></span>
            <span class="legend-label">frei (far/no hit)</span>
          </div>

          <!-- Hover-Readout + Zoom-Viewport -->
          <div class="readout-row">
          <div class="readout">
            @if (losDebug.hoveredPixel(); as p) {
              <div class="row">
                <span class="key">Pixel</span>
                <span class="val">face={{ p.face }} ({{ faceLabel(p.face) }}) · ({{ p.px }}, {{ p.py }})</span>
              </div>
              @if (pixelRgb(); as rgb) {
                <div class="row">
                  <span class="key">Color</span>
                  <span class="val">
                    <span class="swatch" [style.background]="rgb.css"></span>
                    R={{ rgb.r }} G={{ rgb.g }} B={{ rgb.b }} · depth={{ rgb.depth }}
                  </span>
                </div>
              }
              <div class="row">
                <span class="key">Cells</span>
                <span class="val">{{ losDebug.cellsAtHoveredPixel().length }}</span>
              </div>
              @if (hoverCellInfo(); as info) {
                <div class="row">
                  <span class="key">Cell</span>
                  <span class="val">key={{ info.key }} · dist={{ info.dist }}m · y={{ info.y }}m</span>
                </div>
                <div class="row">
                  <span class="key">Blocker</span>
                  <span class="val">{{ info.blockerDist }} ({{ info.visible }})</span>
                </div>
              }
            } @else {
              <div class="row muted">Hover a face (or a cell on the route) to inspect</div>
            }
          </div>
          <div class="zoom-wrap">
            <canvas
              #zoomCanvas
              [width]="zoomCanvasPx"
              [height]="zoomCanvasPx"
              class="zoom-canvas"
            ></canvas>
            <span class="zoom-label">{{ zoomSourcePx }}px → {{ zoomFactor }}×</span>
          </div>
          </div>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }

    .los-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 11px;
      color: var(--td-text-secondary);
      min-width: 420px;
    }

    .los-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .active-tower {
      font-weight: 600;
      color: var(--td-gold);
    }

    .active-tower.muted {
      color: var(--td-text-muted);
      font-weight: normal;
    }

    .layer-toggle {
      display: flex;
      gap: 0;
      border: 1px solid var(--td-frame-mid);
      border-radius: 3px;
      overflow: hidden;
    }

    .layer-toggle button {
      padding: 2px 8px;
      background: transparent;
      color: var(--td-text-muted);
      border: none;
      cursor: pointer;
      font-size: 10px;
      font-family: inherit;
    }

    .layer-toggle button.active {
      background: var(--td-teal);
      color: #0E1612;
    }

    .cross-grid {
      display: grid;
      gap: 2px;
      align-self: center;
    }

    .face-slot {
      position: relative;
      border: 1px solid var(--td-frame-dark);
      background: rgba(0, 0, 0, 0.4);
    }

    .face-slot canvas {
      width: 100%;
      height: 100%;
      display: block;
      image-rendering: pixelated;
      cursor: crosshair;
    }

    .face-label {
      position: absolute;
      top: 1px;
      left: 3px;
      font-size: 9px;
      color: var(--td-text-primary);
      text-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
      pointer-events: none;
      letter-spacing: 0.5px;
    }

    .readout-row {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }

    .readout {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--td-frame-dark);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
    }

    .zoom-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }

    .zoom-canvas {
      width: ${ZOOM_CANVAS_PX}px;
      height: ${ZOOM_CANVAS_PX}px;
      image-rendering: pixelated;
      border: 1px solid var(--td-frame-dark);
      background: rgba(0, 0, 0, 0.5);
    }

    .zoom-label {
      font-size: 9px;
      color: var(--td-text-muted);
      letter-spacing: 0.5px;
    }

    .legend {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      font-size: 9px;
      color: var(--td-text-muted);
      letter-spacing: 0.5px;
    }

    /* Gradient = R/G ramp 0→1 with blue tint that fades at depth>=0.99 —
       mirrors the actual shader output, NOT a hand-tuned ramp. */
    .legend-gradient {
      flex: 1;
      height: 10px;
      border: 1px solid var(--td-frame-dark);
      background: linear-gradient(
        to right,
        rgb(0, 0, 178),
        rgb(64, 64, 134),
        rgb(128, 128, 89),
        rgb(192, 192, 45),
        rgb(252, 252, 1),
        rgb(255, 255, 0)
      );
    }

    .legend-label {
      white-space: nowrap;
    }

    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      vertical-align: -1px;
      border: 1px solid var(--td-frame-dark);
      margin-right: 4px;
    }

    .row {
      display: flex;
      gap: 8px;
    }

    .row.muted {
      color: var(--td-text-muted);
    }

    .key {
      min-width: 60px;
      color: var(--td-text-muted);
    }

    .val {
      color: var(--td-text-primary);
    }
  `,
})
export class LosDebuggerComponent implements AfterViewInit, OnDestroy {
  readonly windowService = inject(DebugWindowService);
  readonly losDebug = inject(LosDebugService);

  // Face-Liste sortiert nach Cross-Layout für das Template.
  readonly faceOrder = FACE_LABELS.map((label, face) => ({
    face,
    label,
    col: FACE_CROSS_LAYOUT[face].col,
    row: FACE_CROSS_LAYOUT[face].row,
  }));

  readonly faceSize = this.losDebug.getFaceSize();

  /** Display-Größe je Face in CSS-Pixeln. Mit ResizeObserver dynamisch
   *  aus dem Panel-Inner-Width berechnet. */
  readonly faceDisplayPx = signal<number>(FACE_DISPLAY_DEFAULT_PX);

  readonly zoomCanvasPx = ZOOM_CANVAS_PX;
  readonly zoomSourcePx = ZOOM_SOURCE_PX;
  readonly zoomFactor = ZOOM_CANVAS_PX / ZOOM_SOURCE_PX;

  readonly layer = signal<'ground' | 'air'>('ground');

  /** Reflektiert TowerShadowMapper.isReady() — wird vom RAF-Loop
   *  geupdated. Wird im Template für die Header-Anzeige ("Build-
   *  Preview" wenn ready aber kein Tower selected) benutzt. */
  readonly mapperReady = signal<boolean>(false);

  /**
   * RGB-Werte am hovered Pixel + decoded normalisierte depth. Liest direkt
   * aus dem gecachten ImageData des Mappers (in-CPU, kein Re-readback).
   */
  readonly pixelRgb = computed(() => {
    const pix = this.losDebug.hoveredPixel();
    const mapper = this.losDebug.getMapper();
    if (!pix || !mapper) return null;
    const img = mapper.getFaceImageData(pix.face);
    if (!img) return null;
    const idx = (pix.py * img.width + pix.px) * 4;
    const r = img.data[idx];
    const g = img.data[idx + 1];
    const b = img.data[idx + 2];
    const depth = r / 255;
    return {
      r, g, b,
      depth: depth.toFixed(3),
      css: `rgb(${r}, ${g}, ${b})`,
    };
  });

  // Hover-Readout: hoveredCell info aufgelöst zu strings für das Template.
  readonly hoverCellInfo = computed(() => {
    const cell = this.losDebug.hoveredCell();
    const tip = this.losDebug.towerTip();
    if (!cell || !tip) return null;
    const layer = this.layer();
    const cellY = layer === 'air'
      ? cell.terrainHeight + 15  // mirror of LOS_VIZ_CONFIG.airSampleYOffset
      : cell.terrainHeight + 1.5;
    const dx = cell.x - tip.x;
    const dy = cellY - tip.y;
    const dz = cell.z - tip.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Decode blocker distance from the mapper's cached face ImageData
    // (R channel = depth*255, see TowerShadowMapper.getFaceImageData).
    const pix = this.losDebug.hoveredPixel();
    let blockerDist = '?';
    let visible = '?';
    const mapper = this.losDebug.getMapper();
    if (pix && mapper) {
      const img = mapper.getFaceImageData(pix.face);
      if (img) {
        const idx = (pix.py * img.width + pix.px) * 4;
        const r = img.data[idx];
        const far = mapper.getFarDistance();
        const decoded = (r / 255) * far;
        blockerDist = decoded.toFixed(1) + 'm';
        visible = dist < decoded - 0.5 ? 'visible' : 'blocked';
      }
    }
    return {
      key: cell.key,
      dist: dist.toFixed(1),
      y: cellY.toFixed(1),
      blockerDist,
      visible,
    };
  });

  @ViewChildren('faceCanvas') faceCanvases?: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChild('zoomCanvas') zoomCanvasRef?: ElementRef<HTMLCanvasElement>;

  private rafHandle: number | null = null;
  private lastFrameUpdate = 0;
  private readonly UPDATE_INTERVAL_MS = 100; // 10 Hz refresh

  // Track previous hover-marker pixel so we only repaint changed faces.
  private lastDrawnPixel: HoveredPixelState | null = null;

  constructor() {
    // Punkt 1: Panel-isOpen → setEnabled. Damit ist Reverse-Hover-
    // Listener nur attached wenn das Panel sichtbar ist.
    effect(() => {
      const open = this.windowService.losWindow().isOpen;
      this.losDebug.setEnabled(open);
    });

    // Punkt 2: Face-Size folgt Panel-Größe. Der WindowService trackt
    // die echte Panel-Width/Height aus dem Resize-Handle — das ist die
    // einzige verlässliche Quelle (los-content selber ist content-gross
    // und wächst nicht mit dem Panel).
    effect(() => {
      const win = this.windowService.losWindow();
      const size = win.size ?? { width: 440, height: 540 };
      const widthBudget = size.width - CHROME_WIDTH_BUDGET_PX - 6; // 4 cols + 3×2px gap
      const heightBudget = size.height - CHROME_HEIGHT_BUDGET_PX - 4; // 3 rows + 2×2px gap
      const fromWidth = Math.floor(widthBudget / 4);
      const fromHeight = Math.floor(heightBudget / 3);
      const next = Math.max(
        FACE_DISPLAY_MIN_PX,
        Math.min(FACE_DISPLAY_MAX_PX, Math.min(fromWidth, fromHeight)),
      );
      this.faceDisplayPx.set(next);
    });
  }

  ngAfterViewInit(): void {
    this.startLoop();
  }

  ngOnDestroy(): void {
    if (this.rafHandle != null) cancelAnimationFrame(this.rafHandle);
    this.losDebug.setEnabled(false);
  }

  setLayer(layer: 'ground' | 'air'): void {
    this.layer.set(layer);
    // Single source of truth: Service kennt den aktiven Layer ab jetzt
    // unabhängig vom hoveredPixel-State. Damit greift der Toggle auch
    // beim Reverse-Hover (3D-Cell-Picking).
    this.losDebug.setActiveLayer(layer);
  }

  faceLabel(face: number): string {
    return FACE_LABELS[face] ?? '?';
  }

  onCanvasMove(event: MouseEvent, face: number): void {
    // Hover akzeptieren wenn die Cubemap was zu zeigen hat — das
    // schließt Build-Preview ein (kein selected Tower, aber der Shared-
    // Mapper rendert für die Live-Preview). Ohne Tower fehlen nur Cell-
    // spezifische Infos (Cells am Pixel, Marker); Pixel-RGB + Zoom +
    // Blocker-Distance funktionieren trotzdem.
    const mapper = this.losDebug.getMapper();
    if (!mapper || !mapper.isReady()) return;

    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const xRel = (event.clientX - rect.left) / rect.width;
    const yRel = (event.clientY - rect.top) / rect.height;
    const size = canvas.width;
    const px = Math.min(size - 1, Math.max(0, Math.floor(xRel * size)));
    // Canvas y matches framebuffer y (no flip — see los-debug-pixel-math.ts)
    const py = Math.min(size - 1, Math.max(0, Math.floor(yRel * size)));
    this.losDebug.setHoveredPixel({ face, px, py, layer: this.layer() });
  }

  onCanvasLeave(): void {
    this.losDebug.setHoveredPixel(null);
  }

  private startLoop(): void {
    const tick = (now: number) => {
      this.rafHandle = requestAnimationFrame(tick);
      // Mapper-Status für die Header-Anzeige tracken (cheap)
      const mapper = this.losDebug.getMapper();
      const ready = !!mapper && mapper.isReady();
      if (ready !== this.mapperReady()) this.mapperReady.set(ready);
      if (now - this.lastFrameUpdate < this.UPDATE_INTERVAL_MS) {
        // still keep hover-overlay in sync between face-redraws
        this.refreshHoverOverlay();
        return;
      }
      this.lastFrameUpdate = now;
      this.redrawFaces();
      this.refreshHoverOverlay();
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private redrawFaces(): void {
    if (!this.faceCanvases) return;
    const mapper = this.losDebug.getMapper();

    // Nur clearen wenn der Mapper wirklich nichts hat — Build-Preview
    // ohne selected Tower ist auch ein valider "ready"-Zustand und
    // soll sichtbar bleiben.
    if (!mapper || !mapper.isReady()) {
      for (const ref of this.faceCanvases.toArray()) {
        const el = ref.nativeElement;
        const ctx = el.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, el.width, el.height);
      }
      this.clearZoomCanvas();
      this.lastDrawnPixel = null;
      return;
    }

    for (const ref of this.faceCanvases.toArray()) {
      const el = ref.nativeElement;
      const face = Number(el.dataset['face']);
      const ctx = el.getContext('2d');
      if (!ctx) continue;
      const img = mapper.getFaceImageData(face);
      if (img) ctx.putImageData(img, 0, 0);
    }
    // After a face repaint, our overlay (hover-marker) must be redrawn,
    // since putImageData overwrites previous pixels.
    this.lastDrawnPixel = null;
  }

  private clearZoomCanvas(): void {
    const zc = this.zoomCanvasRef?.nativeElement;
    if (!zc) return;
    const ctx = zc.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, zc.width, zc.height);
  }

  private refreshHoverOverlay(): void {
    if (!this.faceCanvases) return;
    const pix = this.losDebug.hoveredPixel();
    if (this.equalPixel(pix, this.lastDrawnPixel)) return;
    const mapper = this.losDebug.getMapper();
    if (!mapper) return;

    // Wenn der Mapper nicht ready ist, ist der Canvas eh schon geclearred
    // (von redrawFaces). Zoom synchron leeren.
    if (!mapper.isReady()) {
      this.clearZoomCanvas();
      this.lastDrawnPixel = null;
      return;
    }

    for (const ref of this.faceCanvases.toArray()) {
      const el = ref.nativeElement;
      const face = Number(el.dataset['face']);
      const ctx = el.getContext('2d');
      if (!ctx) continue;
      const img = mapper.getFaceImageData(face);
      if (img) ctx.putImageData(img, 0, 0);
      // Hover marker
      if (pix && pix.face === face) {
        ctx.strokeStyle = '#ff44dd';
        ctx.lineWidth = 2;
        const radius = 6;
        ctx.beginPath();
        ctx.arc(pix.px, pix.py, radius, 0, Math.PI * 2);
        ctx.stroke();
        // small crosshair
        ctx.beginPath();
        ctx.moveTo(pix.px - radius - 2, pix.py);
        ctx.lineTo(pix.px - 2, pix.py);
        ctx.moveTo(pix.px + 2, pix.py);
        ctx.lineTo(pix.px + radius + 2, pix.py);
        ctx.moveTo(pix.px, pix.py - radius - 2);
        ctx.lineTo(pix.px, pix.py - 2);
        ctx.moveTo(pix.px, pix.py + 2);
        ctx.lineTo(pix.px, pix.py + radius + 2);
        ctx.stroke();
      }
    }
    this.drawZoom(pix);
    this.lastDrawnPixel = pix;
  }

  /**
   * Punkt 3: Zoom-Viewport. Zeigt einen `ZOOM_SOURCE_PX × ZOOM_SOURCE_PX`
   * Crop um den hover-pixel, hoch-skaliert auf `ZOOM_CANVAS_PX`. Greift
   * direkt aus dem gecachten ImageData des Mappers — kein zusätzlicher
   * GPU-Readback.
   */
  private drawZoom(pix: HoveredPixelState | null): void {
    const zc = this.zoomCanvasRef?.nativeElement;
    if (!zc) return;
    const ctx = zc.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, zc.width, zc.height);
    if (!pix) return;
    const mapper = this.losDebug.getMapper();
    if (!mapper) return;
    const img = mapper.getFaceImageData(pix.face);
    if (!img) return;

    // Source-Crop clamped an die Face-Ränder. Crop ist immer ZOOM_SOURCE_PX
    // breit — wenn der Pixel nahe am Rand ist, "schiebt" sich der Crop
    // einfach an die Kante (kein partielles Sampling).
    const half = Math.floor(ZOOM_SOURCE_PX / 2);
    const sx = Math.max(0, Math.min(img.width - ZOOM_SOURCE_PX, pix.px - half));
    const sy = Math.max(0, Math.min(img.height - ZOOM_SOURCE_PX, pix.py - half));

    // ImageData → temp Canvas-Bitmap (drawImage akzeptiert keine ImageData
    // direkt für Source-Cropping). Wir nutzen ein wiederverwendbares
    // Off-Screen-Canvas pro Face-Size; lazy lazy alloc.
    const off = this.ensureOffscreenForFace(img.width);
    off.ctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      off.canvas,
      sx, sy, ZOOM_SOURCE_PX, ZOOM_SOURCE_PX,
      0, 0, ZOOM_CANVAS_PX, ZOOM_CANVAS_PX,
    );

    // Mittiges Crosshair, plus 1-Pixel-Markierung exakt auf dem hover-
    // pixel (im Zoom-Coordinate-System).
    const center = ZOOM_CANVAS_PX / 2;
    // Position des hover-pixels innerhalb des Crops (kann bei Edge-Clamp
    // vom Center abweichen)
    const inCropX = pix.px - sx;
    const inCropY = pix.py - sy;
    const scale = ZOOM_CANVAS_PX / ZOOM_SOURCE_PX;
    const markerX = (inCropX + 0.5) * scale;
    const markerY = (inCropY + 0.5) * scale;

    ctx.strokeStyle = '#ff44dd';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(markerX - scale / 2, markerY - scale / 2, scale, scale);

    // Hilfs-Achsenkreuz durchs Marker-Zentrum (subtil)
    ctx.strokeStyle = 'rgba(255, 68, 221, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(markerX, 0); ctx.lineTo(markerX, ZOOM_CANVAS_PX);
    ctx.moveTo(0, markerY); ctx.lineTo(ZOOM_CANVAS_PX, markerY);
    ctx.stroke();
    void center; // suppress unused
  }

  private offscreen: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; size: number } | null = null;
  private ensureOffscreenForFace(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (this.offscreen && this.offscreen.size === size) return this.offscreen;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    this.offscreen = { canvas, ctx, size };
    return this.offscreen;
  }

  private equalPixel(a: HoveredPixelState | null, b: HoveredPixelState | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.face === b.face && a.px === b.px && a.py === b.py && a.layer === b.layer;
  }
}
