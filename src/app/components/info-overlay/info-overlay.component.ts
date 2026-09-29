import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { UIStore } from '../../store/ui.store';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { observeBottomEdge } from './bottom-edge';
import { SimMeterService, speedShort } from '../../services/debug/sim-meter.service';
import { sparkPoints } from './sparkline';

/** Size of the mini charts of the wide stage, px */
const CHART_W = 96;
const CHART_H = 18;

/**
 * Info overlay (top-left).
 *
 * Flat glass panel with runtime stats, in three stages the caret steps
 * through (`uiStore.infoOverlayVisible()`, `uiStore.infoOverlayWide()`):
 *  1. the FPS only;
 *  2. expanded: speed reached against the speed set and the worker's load,
 *     tiles, cache, sounds asked for against played, streets;
 *  3. wide: a column to the right with the simulation's numbers (ticks,
 *     memory mode, cost per packet, enemies) and mini charts of the last
 *     minute (TODO E75).
 * The simulation's numbers come from SimMeterService, which listens to the
 * packets only from the second stage on.
 *
 * Style follows tmp/td-artboards.jsx HudDebugStats — ambient info, not a
 * "debug" label.
 *
 * Measures its bottom edge into `uiStore.infoOverlayBottom`, collapsed and
 * expanded: the ability bar at the left edge keeps below it.
 */
@Component({
  selector: 'app-info-overlay',
  standalone: true,
  imports: [CommonModule, DecimalPipe, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './info-overlay.component.html',
  styleUrl: './info-overlay.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class InfoOverlayComponent {
  readonly uiStore = inject(UIStore);
  readonly meter = inject(SimMeterService);

  readonly fps = input.required<number>();
  readonly tileStats = input.required<{ visible: number; total: number; cacheMB: number }>();
  readonly streetCount = input.required<number>();

  readonly chartW = CHART_W;
  readonly chartH = CHART_H;

  readonly sample = this.meter.latest;
  readonly speedShort = computed(() => {
    const sample = this.sample();
    return sample !== null && speedShort(sample);
  });
  /** What the next click does: expand, widen, collapse */
  readonly caret = computed(() => {
    if (!this.uiStore.infoOverlayVisible()) return 'caret';
    return this.uiStore.infoOverlayWide() ? 'caretU' : 'caretR';
  });
  readonly charts = computed(() => {
    const history = this.meter.history();
    return {
      fps: sparkPoints(history.map((s) => s.fps), CHART_W, CHART_H, 60),
      ticks: sparkPoints(history.map((s) => s.ticksPerS), CHART_W, CHART_H, 60),
      load: sparkPoints(history.map((s) => s.workerLoad), CHART_W, CHART_H, 1),
    };
  });

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  constructor() {
    const destroyRef = inject(DestroyRef);
    // The meter listens to the packets only while its numbers show
    effect(() => this.meter.setActive(this.uiStore.infoOverlayVisible()));
    destroyRef.onDestroy(() => this.meter.setActive(false));
    afterNextRender(() => {
      const stop = observeBottomEdge(this.box().nativeElement, (px) => this.uiStore.infoOverlayBottom.set(px));
      destroyRef.onDestroy(() => {
        stop();
        this.uiStore.infoOverlayBottom.set(0);
      });
    });
  }
}
