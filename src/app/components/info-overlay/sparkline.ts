/** A mini chart of the info overlay (TODO E91): the line, the bad range as a band, the newest value as a dot */
export interface SparkChart {
  /** SVG polyline points, oldest at the left; empty for fewer than two values */
  points: string;
  /** The band of the bad range, y and height in the box; height 0 when it lies outside the scale */
  band: { y: number; height: number };
  /** The newest value's place, null without values */
  dot: { x: number; y: number } | null;
  /** The newest value, the smallest and the largest of the window; 0 without values */
  last: number;
  min: number;
  max: number;
}

/**
 * The values in a `width` x `height` box on a fixed scale from 0 (bottom) to
 * `top`: a value outside is drawn at the edge, so a spike does not stretch
 * the scale and squash the rest. `bad` is the range shaded as a warning,
 * [from, to] in the values' unit.
 */
export function sparkChart(
  values: readonly number[],
  width: number,
  height: number,
  top: number,
  bad: readonly [number, number],
): SparkChart {
  const y = (v: number) => height - (Math.min(top, Math.max(0, v)) / top) * height;
  const bandTop = y(bad[1]);
  const band = { y: round(bandTop), height: round(Math.max(0, y(bad[0]) - bandTop)) };
  if (values.length === 0) return { points: '', band, dot: null, last: 0, min: 0, max: 0 };
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  let min = Infinity;
  let max = -Infinity;
  const points: string[] = [];
  values.forEach((v, i) => {
    if (v < min) min = v;
    if (v > max) max = v;
    points.push(`${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  });
  const last = values[values.length - 1];
  return {
    points: values.length < 2 ? '' : points.join(' '),
    band,
    dot: { x: values.length > 1 ? width : 0, y: round(y(last)) },
    last,
    min,
    max,
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
