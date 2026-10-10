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
import { GlobeDirectorService, type GlobeMark, type GlobeOverlay } from '../../services/world/globe-director.service';

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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('globeCanvas');
  private readonly marksBox = viewChild<ElementRef<HTMLElement>>('marks');
  private marks: HTMLElement[] = [];
  private pendingMarks: readonly GlobeMark[] = [];

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
    this.marks = marks.map((mark) => {
      const el = document.createElement('span');
      el.className = `td-globe-mark is-${mark.kind}`;
      el.append(document.createElement('i'));
      const label = mark.kind === 'record' && mark.wave ? `${mark.name} | wave ${mark.wave}` : mark.name;
      if (label) el.append(document.createTextNode(label));
      el.style.visibility = 'hidden';
      box.append(el);
      return el;
    });
  }

  update(spots: Float32Array): void {
    for (let i = 0; i < this.marks.length; i++) {
      const el = this.marks[i];
      if (spots[i * 3 + 2] !== 1) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${spots[i * 3].toFixed(1)}px, ${spots[i * 3 + 1].toFixed(1)}px) translateY(-50%)`;
    }
  }

  fade(value: number, durationMs: number, delayMs = 0): void {
    // A transition the compositor runs: smooth while the place loads on this thread
    this.host.style.transition = durationMs > 0 ? `opacity ${durationMs}ms ease-in-out ${delayMs}ms` : 'none';
    this.host.style.opacity = String(value);
  }
}
