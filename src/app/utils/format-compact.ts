/** Drop a trailing ".0" from a one-decimal figure. */
function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * 950, 1.2k, 12k, 1.2M, 12M: short enough for a stat tile. Rounds down, so the
 * figure never claims more than was reached. Negative input reads as 0.
 */
export function formatCompact(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1_000) return String(v);
  if (v < 10_000) return `${trimZero((Math.floor(v / 100) / 10).toFixed(1))}k`;
  if (v < 1_000_000) return `${Math.floor(v / 1_000)}k`;
  if (v < 10_000_000) return `${trimZero((Math.floor(v / 100_000) / 10).toFixed(1))}M`;
  return `${Math.floor(v / 1_000_000)}M`;
}
