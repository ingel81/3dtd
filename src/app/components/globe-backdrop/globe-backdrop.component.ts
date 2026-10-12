import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { GlobeDirectorService, type GlobeHud, type GlobeMark, type GlobeOverlay } from '../../services/world/globe-director.service';

/** The room the target's dot and label take, px around its dot: other marks there step back */
const TARGET_CLEAR_Y = 30;
const TARGET_CLEAR_LEFT = 24;
const TARGET_CLEAR_RIGHT = 280;

/**
 * The menu globe behind the start menu (docs/GLOBE_PLAN.md): its canvas,
 * the places marked on it and the read-out in the corner. Backdrop only (D3):
 * pointer events go through. GlobeDirectorService runs it; this component
 * hands it the canvas of each globe (a new one per generation, a context
 * once freed cannot come back on the same canvas; in a worker the canvas
 * belongs to it) and moves the marks straight in the DOM, outside change
 * detection; fades are CSS transitions.
 */
@Component({
  selector: 'app-globe-backdrop',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './globe-backdrop.component.html',
  styleUrl: './globe-backdrop.component.scss',
  host: { 'aria-hidden': 'true' },
})
export class GlobeBackdropComponent implements GlobeOverlay {
  readonly director = inject(GlobeDirectorService);
  /** Coordinates read without sign, the hemisphere letter says it */
  readonly abs = Math.abs;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('globeCanvas');
  private readonly marksBox = viewChild<ElementRef<HTMLElement>>('marks');
  private marks: HTMLElement[] = [];
  private pendingMarks: readonly GlobeMark[] = [];
  /** The place that loads: drawn over the others, its line says what happens */
  private targetIndex = -1;
  private targetStatus: HTMLElement | null = null;

  constructor() {
    let attached: HTMLCanvasElement | null = null;
    const observer = new ResizeObserver(() => {
      if (attached) this.director.resize(attached.clientWidth, attached.clientHeight);
    });
    effect(() => {
      const canvas = this.canvas()?.nativeElement ?? null;
      untracked(() => {
        if (canvas === attached) return;
        if (attached) {
          observer.unobserve(attached);
          this.director.detach(attached);
        }
        attached = canvas;
        if (!canvas) return;
        observer.observe(canvas);
        this.director.attach(canvas, this);
      });
    });
    effect(() => {
      if (this.marksBox()) untracked(() => this.setMarks(this.pendingMarks));
    });
    effect(() => {
      const hud = this.director.hud();
      untracked(() => this.showTargetStatus(hud));
    });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      if (attached) this.director.detach(attached);
    });
  }

  setMarks(marks: readonly GlobeMark[]): void {
    this.pendingMarks = marks;
    const box = this.marksBox()?.nativeElement;
    if (!box) return;
    box.replaceChildren();
    this.targetIndex = marks.findIndex((mark) => mark.kind === 'target');
    this.targetStatus = null;
    this.marks = marks.map((mark) => {
      const el = document.createElement('span');
      el.className = `td-globe-mark is-${mark.kind}`;
      el.append(document.createElement('i'));
      const label = mark.kind === 'record' && mark.wave ? `${mark.name} | wave ${mark.wave}` : mark.name;
      if (mark.kind === 'target') {
        const text = document.createElement('span');
        if (label) text.append(document.createTextNode(label));
        this.targetStatus = document.createElement('small');
        text.append(this.targetStatus);
        el.append(text);
      } else if (label) {
        el.append(document.createTextNode(label));
      }
      el.style.visibility = 'hidden';
      return el;
    });
    // The target last: it paints over every other mark
    box.append(...this.marks.filter((_, i) => i !== this.targetIndex));
    if (this.targetIndex >= 0) box.append(this.marks[this.targetIndex]);
    this.showTargetStatus(this.director.hud());
  }

  update(spots: Float32Array): void {
    const t = this.targetIndex;
    const targetShown = t >= 0 && spots[t * 3 + 2] === 1;
    for (let i = 0; i < this.marks.length; i++) {
      const el = this.marks[i];
      if (spots[i * 3 + 2] !== 1) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${spots[i * 3].toFixed(1)}px, ${spots[i * 3 + 1].toFixed(1)}px) translateY(-50%)`;
      // Marks under the target's label step back, so its name reads clear
      if (i !== t) {
        const dx = spots[i * 3] - spots[t * 3];
        const dy = spots[i * 3 + 1] - spots[t * 3 + 1];
        el.classList.toggle('is-behind', targetShown && Math.abs(dy) < TARGET_CLEAR_Y && dx > -TARGET_CLEAR_LEFT && dx < TARGET_CLEAR_RIGHT);
      }
    }
  }

  /** The target's line: what happens there and how far the place has loaded */
  private showTargetStatus(hud: GlobeHud | null): void {
    const line = this.targetStatus;
    if (!line) return;
    const text = hud?.status ? (hud.progress !== null ? `${hud.status} ${hud.progress} %` : hud.status) : '';
    if (line.textContent !== text) line.textContent = text;
    this.marks[this.targetIndex]?.classList.toggle('is-busy', text !== '');
  }

  fade(value: number, durationMs: number, delayMs = 0): void {
    // A transition the compositor runs: smooth while the place loads on this thread
    this.host.style.transition = durationMs > 0 ? `opacity ${durationMs}ms ease-in-out ${delayMs}ms` : 'none';
    this.host.style.opacity = String(value);
  }
}
