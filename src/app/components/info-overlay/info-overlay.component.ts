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
import { sparkChart } from './sparkline';
import { controlTakesKey } from '../../utils/keyboard-target';

/** Size of the mini charts of the wide stage, px */
const CHART_W = 96;
const CHART_H = 20;

/**
 * The charts' fixed scales and the ranges they shade as bad (TODO E91): a
 * frame rate under 30, under 24 of the about 30 simulation ticks a second,
 * the simulation's worker busy over 90 % of the time. A value past the top is
 * drawn at the edge.
 */
const FPS_SCALE = { top: 150, bad: [0, 30] } as const;
const TICKS_SCALE = { top: 40, bad: [0, 24] } as const;
const LOAD_SCALE = { top: 1, bad: [0.9, 1] } as const;

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
 *     minute (TODO E75), each on a fixed scale with its bad range as a band,
 *     the newest value at its end and the minute's minimum or maximum (E91).
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
      fps: sparkChart(history.map((s) => s.fps), CHART_W, CHART_H, FPS_SCALE.top, FPS_SCALE.bad),
      ticks: sparkChart(history.map((s) => s.ticksPerS), CHART_W, CHART_H, TICKS_SCALE.top, TICKS_SCALE.bad),
      load: sparkChart(history.map((s) => s.workerLoad), CHART_W, CHART_H, LOAD_SCALE.top, LOAD_SCALE.bad),
    };
  });

  /** The rows of the charts: the newest value right of each, the minute's range below */
  readonly chartRows = computed(() => {
    const { fps, ticks, load } = this.charts();
    const whole = (v: number) => Math.round(v).toString();
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    return [
      { label: 'FPS', chart: fps, now: whole(fps.last), range: `min ${whole(fps.min)} · max ${whole(fps.max)}` },
      { label: 'Ticks', chart: ticks, now: whole(ticks.last), range: `min ${whole(ticks.min)} · max ${whole(ticks.max)}` },
      { label: 'Sim', chart: load, now: percent(load.last), range: `max ${percent(load.max)}` },
    ];
  });

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  /**
   * Enter or Space steps the overlay when the keyboard focused it (Tab).
   * Focused by a click, the keys stay the game's: Space starts the wave and
   * does not also step the overlay.
   */
  onKey(event: Event): void {
    const key = event as KeyboardEvent;
    if (!controlTakesKey(key.target, key.key)) return;
    key.preventDefault();
    this.uiStore.toggleInfoOverlay();
  }

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
