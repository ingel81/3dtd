import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PlayerWaveNumbers, WaveSeriesPoint } from '../../run-log/wave-series';
import { formatCompact } from '../../utils/format-compact';
import { TD_CSS_VARS } from '../../styles/td-theme';

/** A player of the charts: their name and colour (the lane colour in coop) */
export interface RunChartPlayer {
  id: string;
  name: string;
  color: string;
}

/** One line of a chart */
interface ChartLine {
  id: string;
  name: string;
  color: string;
  dash: string | null;
  /** SVG points, "x,y x,y" in the 0..W, 0..H box */
  points: string;
}

/** One of the small charts */
interface RunChart {
  title: string;
  top: number;
  lines: ChartLine[];
  /** A hover target per wave, with every line's value there */
  hovers: { x: number; width: number; label: string }[];
}

/** The plot box, SVG units */
const W = 200;
const H = 64;
/** The line styles past the colour, so two lanes of close colour stay apart (red and orange, TODO E46) */
const DASHES: (string | null)[] = [null, '6 3', '2 2', '8 3 2 3'];

/**
 * Each player's run wave by wave on the game-over screen (TODO E46): kills,
 * towers standing, gold earned, the HQ's health. Four small charts on one
 * scale each; the lanes wear their colour and a line style, with a legend
 * when there is more than one player.
 */
@Component({
  selector: 'app-run-charts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-charts.component.html',
  styleUrl: './run-charts.component.scss',
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }
  `,
})
export class RunChartsComponent {
  readonly points = input.required<readonly WaveSeriesPoint[]>();
  readonly players = input.required<readonly RunChartPlayer[]>();

  readonly width = W;
  readonly height = H;
  readonly compact = formatCompact;

  /** The players with their line style, in roster order */
  readonly legend = computed(() => this.players().map((p, i) => ({ ...p, dash: DASHES[i % DASHES.length] })));

  readonly charts = computed<RunChart[]>(() => {
    const points = this.points();
    if (points.length < 2) return [];
    const legend = this.legend();
    const per = (key: keyof PlayerWaveNumbers) => (id: string) => points.map((p) => p.players[id]?.[key] ?? 0);
    return [
      this.chart('Kills', points, legend, per('kills')),
      this.chart('Towers', points, legend, per('towers')),
      this.chart('Gold earned', points, legend, per('goldEarned')),
      this.chart('HQ health', points, [{ id: 'hq', name: 'HQ', color: 'var(--td-text-secondary)', dash: null }],
        () => points.map((p) => p.hqHealth)),
    ];
  });

  private chart(
    title: string,
    points: readonly WaveSeriesPoint[],
    players: readonly (RunChartPlayer & { dash: string | null })[],
    valuesOf: (id: string) => number[],
  ): RunChart {
    const values = new Map(players.map((p) => [p.id, valuesOf(p.id)]));
    const top = Math.max(1, ...[...values.values()].flat());
    const step = W / (points.length - 1);
    const y = (v: number) => (H - (v / top) * (H - 2) - 1).toFixed(1);
    const lines = players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      dash: p.dash,
      points: values.get(p.id)!.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(' '),
    }));
    const hovers = points.map((point, i) => ({
      x: Math.max(0, i * step - step / 2),
      width: step,
      label: `Wave ${point.wave}: `
        + players.map((p) => `${players.length > 1 ? `${p.name} ` : ''}${formatCompact(values.get(p.id)![i])}`).join(', '),
    }));
    return { title, top, lines, hovers };
  }
}
