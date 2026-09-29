/**
 * SVG polyline points of `values` in a `width` x `height` box, oldest at the
 * left, 0 at the bottom and `max` (at least the largest value) at the top.
 * Fewer than two values draw nothing.
 */
export function sparkPoints(values: readonly number[], width: number, height: number, max = 0): string {
  if (values.length < 2) return '';
  const top = Math.max(max, ...values) || 1;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (Math.max(0, v) / top) * height).toFixed(1)}`)
    .join(' ');
}
