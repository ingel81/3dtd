import { ChangeDetectionStrategy, computed, Component, ElementRef, OnDestroy, effect, inject, viewChild } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SPAWN_COLORS } from '../../../configs/map-constants.config';
import { TD_THEME } from '../../../styles/td-theme';
import { edgePolyline } from '../../../map-ops/path-graph';
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
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-overlay' },
  template: `<canvas #canvas class="mm-canvas" [width]="size" [height]="size" aria-label="Minimap, click to move the view"
                     (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" data-test="minimap"></canvas>
    <div class="mm-views" role="group" aria-label="Kept views">
      @for (v of session.view.bookmarks(); track $index) {
        @if (v) {
          <button class="td-tool is-sm mm-view td-tone-brass" type="button" [attr.aria-label]="'View ' + ($index + 1)"
                  [matTooltip]="'Fly to view ' + ($index + 1) + ' (Shift+' + ($index + 1) + '); Alt click keeps the current view here instead'"
                  (click)="view($index, $event)" [attr.data-view]="$index + 1">{{ $index + 1 }}</button>
        }
      }
      @if (freeSlot() >= 0) {
        <button class="td-btn-ghost td-btn-sm mm-keep" type="button" (click)="keep()" data-test="keep-view"
                [matTooltip]="'Keep the current view to fly back later (Alt+' + (freeSlot() + 1) + ')'">+ Keep view</button>
      }
    </div>`,
  styles: [
    `:host { display: block; padding: 6px; } .mm-canvas { display: block; width: 200px; height: 200px; cursor: pointer; }
     .mm-views { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; width: 200px; } .mm-view { width: 22px; font-size: var(--td-fs-small); } .mm-keep { margin-left: auto; }
     @media (max-height: 820px) { .mm-canvas { width: 150px; height: 150px; } .mm-views { width: 150px; } }`,
  ],
})
export class MinimapComponent implements OnDestroy {
  readonly session = inject(EditorSession);
  /** Absent until the view stands: the first draw may come before it */
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  readonly size = SIZE;
  private picture: HTMLCanvasElement | null = null;
  private pictureRev = -1;
  /** The roads drawn as one path (draw), and the revision of the map they show */
  private roads: Path2D | null = null;
  private roadsRev = -1;
  private drawnRev = 0;
  private pictureAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A picture is on its way (renderTopDown); the next waits for it */
  private rendering = false;
  private destroyed = false;
  private dragging = false;

  constructor() {
    effect(() => {
      const rev = this.session.state.anyRev() * 1000 + this.session.view.viewRev();
      this.session.state.selection();
      this.drawnRev = rev;
      this.schedulePicture(rev);
      this.draw();
    });
  }

  /** The first slot without a kept view, -1 when all nine hold one */
  readonly freeSlot = computed(() => this.session.view.bookmarks().findIndex((v) => !v));

  keep(): void {
    const slot = this.freeSlot();
    if (slot >= 0) this.session.view.saveBookmark(slot);
  }

  view(slot: number, e: MouseEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) this.session.view.saveBookmark(slot);
    else this.session.view.showBookmark(slot);
  }

  /** The camera's frame follows the view outside Angular: a flight moves it every frame */
  private readonly offCamera = this.session.view.onCamera(() => this.draw());

  ngOnDestroy(): void {
    this.destroyed = true;
    this.offCamera();
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
    if (!doc || !this.session.view.shown) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const box = this.box(doc.terrain.width, doc.terrain.depth);
    const u = (e.clientX - rect.left) * (SIZE / rect.width);
    const v = (e.clientY - rect.top) * (SIZE / rect.height);
    const x = ((u - box.x) / box.w - 0.5) * doc.terrain.width;
    const y = (0.5 - (v - box.y) / box.h) * doc.terrain.depth;
    this.session.view.lookAt(Math.max(-doc.terrain.width / 2, Math.min(doc.terrain.width / 2, x)), Math.max(-doc.terrain.depth / 2, Math.min(doc.terrain.depth / 2, y)));
  }

  /** The map's rectangle inside the square canvas */
  private box(width: number, depth: number): { x: number; y: number; w: number; h: number } {
    const k = SIZE / Math.max(width, depth);
    const w = width * k;
    const h = depth * k;
    return { x: (SIZE - w) / 2, y: (SIZE - h) / 2, w, h };
  }

  private schedulePicture(rev: number): void {
    if (rev === this.pictureRev || this.rendering) return;
    const wait = Math.max(0, this.pictureAt + PICTURE_EVERY_MS - performance.now());
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const view = this.session.view;
      const doc = this.session.doc;
      if (!view.shown || !doc) return;
      // A whole-map render costs a frame: not while a brush is held
      if (view.dragging) {
        this.schedulePicture(rev);
        return;
      }
      const b = this.box(doc.terrain.width, doc.terrain.depth);
      // The picture is of the map as it is now; later changes ask for the next one
      const now = this.session.state.anyRev() * 1000 + this.session.view.viewRev();
      this.pictureAt = performance.now();
      this.rendering = true;
      view.renderTopDown(Math.max(8, Math.round(b.w)), Math.max(8, Math.round(b.h)), false)
        .then((picture) => {
          if (this.destroyed) return;
          this.picture = picture;
          this.pictureRev = now;
          this.draw();
        })
        .catch(() => undefined)
        .finally(() => {
          this.rendering = false;
          const rev = this.session.state.anyRev() * 1000 + this.session.view.viewRev();
          if (!this.destroyed && rev !== this.pictureRev) this.schedulePicture(rev);
        });
    }, wait || 50);
  }

  private draw(): void {
    const c = this.canvas()?.nativeElement.getContext('2d');
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
    // The roads as one path, made again only when the map changed: the camera's frame redraws every frame
    if (!this.roads || this.roadsRev !== this.drawnRev) {
      const roads = new Path2D();
      for (const e of doc.paths.edges) {
        edgePolyline(doc.paths, e).forEach((p, k) => (k ? roads.lineTo(px(p.x), py(p.y)) : roads.moveTo(px(p.x), py(p.y))));
      }
      this.roads = roads;
      this.roadsRev = this.drawnRev;
    }
    c.stroke(this.roads);
    doc.spawns.forEach((s, k) => {
      c.fillStyle = `#${SPAWN_COLORS[k % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`;
      c.beginPath();
      c.arc(px(s.x), py(s.y), 4, 0, Math.PI * 2);
      c.fill();
    });
    c.fillStyle = TD_THEME.brass;
    c.fillRect(px(doc.hq.x) - 4, py(doc.hq.y) - 4, 8, 8);

    const foot = this.session.view.viewFootprint();
    if (foot.length >= 3) {
      c.strokeStyle = TD_THEME.brassLight;
      c.lineWidth = 1;
      c.beginPath();
      foot.forEach((p, k) => (k ? c.lineTo(px(p.x), py(p.y)) : c.moveTo(px(p.x), py(p.y))));
      c.closePath();
      c.stroke();
    }
    const target = this.session.view.cameraTarget();
    if (target) {
      c.strokeStyle = TD_THEME.brassLight;
      c.beginPath();
      c.arc(px(target.x), py(target.y), 3, 0, Math.PI * 2);
      c.stroke();
    }
  }
}
