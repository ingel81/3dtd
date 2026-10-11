import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, viewChild } from '@angular/core';
import { SPAWN_COLORS } from '../../../configs/map-constants.config';
import { TD_THEME } from '../../../styles/td-theme';
import { edgePolyline } from '../../ops/path-graph';
import { EditorSession } from '../editor-session.service';

const SIZE = 200;
/** Re-render the picture at most this often while the map changes */
const PICTURE_EVERY_MS = 1200;

/**
 * The map from above: a top-down render of the view (redrawn a moment after
 * edits), roads, spawns, HQ and what the camera sees drawn over it. A click
 * or drag moves the camera there.
 */
@Component({
  selector: 'app-editor-minimap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-overlay' },
  template: `<canvas #canvas class="mm-canvas" [width]="size" [height]="size" aria-label="Minimap, click to move the view"
                     (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" data-test="minimap"></canvas>`,
  styles: [`:host { display: block; padding: 6px; } .mm-canvas { display: block; width: 200px; height: 200px; cursor: pointer; }`],
})
export class MinimapComponent implements OnDestroy {
  private readonly session = inject(EditorSession);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly size = SIZE;
  private picture: HTMLCanvasElement | null = null;
  private pictureRev = -1;
  private pictureAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dragging = false;

  constructor() {
    effect(() => {
      const rev = this.session.docRev();
      this.session.cameraRev();
      this.session.selection();
      this.schedulePicture(rev);
      this.draw();
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  down(e: PointerEvent): void {
    this.dragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.jump(e);
  }

  move(e: PointerEvent): void {
    if (this.dragging) this.jump(e);
  }

  up(e: PointerEvent): void {
    this.dragging = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  private jump(e: PointerEvent): void {
    const doc = this.session.doc;
    const vp = this.session.viewport;
    if (!doc || !vp) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const box = this.box(doc.terrain.width, doc.terrain.depth);
    const u = (e.clientX - rect.left) * (SIZE / rect.width);
    const v = (e.clientY - rect.top) * (SIZE / rect.height);
    const x = ((u - box.x) / box.w - 0.5) * doc.terrain.width;
    const y = (0.5 - (v - box.y) / box.h) * doc.terrain.depth;
    const c = vp.controller.goal;
    c.target.x = -Math.max(-doc.terrain.width / 2, Math.min(doc.terrain.width / 2, x));
    c.target.z = Math.max(-doc.terrain.depth / 2, Math.min(doc.terrain.depth / 2, y));
  }

  /** The map's rectangle inside the square canvas */
  private box(width: number, depth: number): { x: number; y: number; w: number; h: number } {
    const k = SIZE / Math.max(width, depth);
    const w = width * k;
    const h = depth * k;
    return { x: (SIZE - w) / 2, y: (SIZE - h) / 2, w, h };
  }

  private schedulePicture(rev: number): void {
    if (rev === this.pictureRev) return;
    const wait = Math.max(0, this.pictureAt + PICTURE_EVERY_MS - performance.now());
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const vp = this.session.viewport;
      const doc = this.session.doc;
      if (!vp || !doc) return;
      const b = this.box(doc.terrain.width, doc.terrain.depth);
      this.picture = vp.renderTopDown(Math.max(8, Math.round(b.w)), Math.max(8, Math.round(b.h)), false);
      this.pictureRev = this.session.docRev();
      this.pictureAt = performance.now();
      this.draw();
    }, wait || 50);
  }

  private draw(): void {
    const canvas = this.canvas().nativeElement;
    const c = canvas.getContext('2d');
    const doc = this.session.doc;
    if (!c || !doc) return;
    const t = doc.terrain;
    const b = this.box(t.width, t.depth);
    c.fillStyle = TD_THEME.panelShadow;
    c.fillRect(0, 0, SIZE, SIZE);
    if (this.picture) c.drawImage(this.picture, b.x, b.y, b.w, b.h);
    const px = (x: number) => b.x + (x / t.width + 0.5) * b.w;
    const py = (y: number) => b.y + (0.5 - y / t.depth) * b.h;

    c.lineWidth = 1.5;
    c.strokeStyle = TD_THEME.knobLight;
    for (const e of doc.paths.edges) {
      const line = edgePolyline(doc.paths, e);
      c.beginPath();
      line.forEach((p, k) => (k ? c.lineTo(px(p.x), py(p.y)) : c.moveTo(px(p.x), py(p.y))));
      c.stroke();
    }
    doc.spawns.forEach((s, k) => {
      c.fillStyle = `#${SPAWN_COLORS[k % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`;
      c.beginPath();
      c.arc(px(s.x), py(s.y), 4, 0, Math.PI * 2);
      c.fill();
    });
    c.fillStyle = TD_THEME.brass;
    c.fillRect(px(doc.hq.x) - 4, py(doc.hq.y) - 4, 8, 8);

    const foot = this.session.viewport?.viewFootprint() ?? [];
    if (foot.length >= 3) {
      c.strokeStyle = TD_THEME.brassLight;
      c.lineWidth = 1;
      c.beginPath();
      foot.forEach((p, k) => (k ? c.lineTo(px(p.x), py(p.y)) : c.moveTo(px(p.x), py(p.y))));
      c.closePath();
      c.stroke();
    }
    const target = this.session.viewport?.controller.current.target;
    if (target) {
      c.strokeStyle = TD_THEME.brassLight;
      c.beginPath();
      c.arc(px(-target.x), py(target.z), 3, 0, Math.PI * 2);
      c.stroke();
    }
  }
}
