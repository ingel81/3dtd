import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { WAVE_TABLE, type WaveTable } from '../../../director/sources/table/wave-table';
import { shortNumber, waveCurve, type WavePoint } from './wave-curve';

const W = 300;
const H = 110;
const PAD = { left: 30, right: 6, top: 6, bottom: 16 };

/**
 * Rules panel, own wave list: the HP of every wave against the game's list
 * (log scale), and for the wave under the pointer what it brings: enemies,
 * HP, what it would cost the HQ if all of it got through, how long it
 * spawns. Flags the first wave that alone could take the whole HQ.
 */
@Component({
  selector: 'app-wave-curve-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack' },
  template: `
    <span class="td-label">HP per wave and lane <span class="td-note">(log scale)</span></span>
    <svg class="wc-svg" [attr.viewBox]="'0 0 ' + w + ' ' + h" role="img" aria-label="HP per wave of this list and of the game's list"
         (pointermove)="hover($event)" (pointerleave)="picked.set(null)" data-test="wave-curve">
      @for (t of ticks(); track t.v) {
        <line class="wc-grid" [attr.x1]="pad.left" [attr.x2]="w - pad.right" [attr.y1]="t.y" [attr.y2]="t.y" />
        <text class="wc-tick" font-size="7" [attr.x]="pad.left - 3" [attr.y]="t.y + 3" text-anchor="end">{{ t.label }}</text>
      }
      <polyline class="wc-game" [attr.points]="line(game())" />
      <polyline class="wc-own" [attr.points]="line(own())" />
      @if (point(); as p) {
        <line class="wc-cursor" [attr.x1]="x(p.wave)" [attr.x2]="x(p.wave)" [attr.y1]="pad.top" [attr.y2]="h - pad.bottom" />
        <circle class="wc-dot" [attr.cx]="x(p.wave)" [attr.cy]="y(p.hp)" r="2.5" />
      }
      <text class="wc-tick" font-size="7" [attr.x]="pad.left" [attr.y]="h - 3">1</text>
      <text class="wc-tick" font-size="7" [attr.x]="w - pad.right" [attr.y]="h - 3" text-anchor="end">{{ count() }}</text>
    </svg>
    <div class="wc-legend td-note"><span class="wc-key is-own"></span>This list <span class="wc-key is-game"></span>The game's list</div>
    @if (point(); as p) {
      <p class="td-note td-num" data-test="wave-curve-readout">
        Wave {{ p.wave }} {{ p.name }}: {{ p.enemies }} enemies, {{ short(p.hp) }} HP (game's list {{ short(gameAt(p.wave)) }}),
        all through {{ p.leak }} of {{ hq() }} HQ health, spawning {{ p.seconds }} s
      </p>
    }
    @if (overrun(); as o) {
      <p class="td-note">Wave {{ o.wave }} on one lane alone could take the whole HQ ({{ o.leak }} of {{ hq() }}) if the defense lets it through.</p>
    }
  `,
  styles: [
    `.wc-svg { width: 100%; height: auto; display: block; touch-action: none; }
     .wc-grid { stroke: var(--td-frame-mid); stroke-width: 0.5; }
     .wc-tick { fill: var(--td-text-muted); }
     .wc-own { fill: none; stroke: var(--td-teal-light); stroke-width: 1.5; }
     .wc-game { fill: none; stroke: var(--td-text-muted); stroke-width: 1; stroke-dasharray: 3 2; }
     .wc-cursor { stroke: var(--td-text-muted); stroke-width: 0.5; }
     .wc-dot { fill: var(--td-teal-light); }
     .wc-legend { display: flex; align-items: center; gap: 6px; }
     .wc-key { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--td-teal-light); }
     .wc-key.is-game { border-top: 1px dashed var(--td-text-muted); margin-left: 8px; }`,
  ],
})
export class WaveCurveChartComponent {
  /** The map's own list */
  readonly table = input.required<WaveTable>();
  /** The HQ health of the map's rules */
  readonly hq = input.required<number>();

  readonly w = W;
  readonly h = H;
  readonly pad = PAD;
  readonly picked = signal<number | null>(null);

  /** The list and ten waves of its cycle, at least 30 */
  readonly count = computed(() => Math.max(30, Math.min(120, this.table().waves.length + 10)));
  readonly own = computed(() => waveCurve(this.table(), this.count()));
  readonly game = computed(() => waveCurve(WAVE_TABLE, this.count()));
  private readonly range = computed(() => {
    const all = [...this.own(), ...this.game()].map((p) => p.hp).filter((v) => v > 0);
    const lo = Math.floor(Math.log10(Math.max(1, Math.min(...all, 1e9))));
    const hi = Math.ceil(Math.log10(Math.max(10, ...all)));
    return { lo, hi: Math.max(hi, lo + 1) };
  });
  readonly ticks = computed(() => {
    const { lo, hi } = this.range();
    const out: { v: number; y: number; label: string }[] = [];
    for (let e = lo; e <= hi; e++) out.push({ v: 10 ** e, y: this.y(10 ** e), label: shortNumber(10 ** e) });
    return out;
  });
  readonly point = computed<WavePoint | null>(() => {
    const list = this.own();
    const at = this.picked();
    return (at === null ? list[Math.min(list.length, this.table().waves.length) - 1] : list.find((p) => p.wave === at)) ?? null;
  });
  /** The first wave of the list whose leak alone reaches the HQ's health */
  readonly overrun = computed(() => this.own().find((p) => p.wave <= this.table().waves.length && p.leak >= this.hq()) ?? null);

  x(wave: number): number {
    return PAD.left + ((wave - 1) / Math.max(1, this.count() - 1)) * (W - PAD.left - PAD.right);
  }

  y(hp: number): number {
    const { lo, hi } = this.range();
    const f = (Math.log10(Math.max(1, hp)) - lo) / (hi - lo);
    return H - PAD.bottom - f * (H - PAD.top - PAD.bottom);
  }

  line(points: readonly WavePoint[]): string {
    return points.map((p) => `${this.x(p.wave).toFixed(1)},${this.y(p.hp).toFixed(1)}`).join(' ');
  }

  gameAt(wave: number): number {
    return this.game().find((p) => p.wave === wave)?.hp ?? 0;
  }

  hover(e: PointerEvent): void {
    const svg = e.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const wave = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (this.count() - 1)) + 1;
    this.picked.set(Math.min(this.count(), Math.max(1, wave)));
  }

  short(v: number): string {
    return shortNumber(v);
  }
}
