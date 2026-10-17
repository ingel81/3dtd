/**
 * The round brush every painting tool shares: radius in metres, strength
 * 0..1 and falloff 0..1 (the outer share of the radius that fades; 0 is a
 * hard edge, 1 fades from the centre).
 */
export interface BrushSettings {
  radius: number;
  strength: number;
  falloff: number;
}

export const BRUSH_LIMITS = {
  radius: { min: 1, max: 200 },
  strength: { min: 0.01, max: 1 },
  falloff: { min: 0, max: 1 },
} as const;

export const DEFAULT_BRUSH: BrushSettings = { radius: 16, strength: 0.5, falloff: 0.6 };

/** Weight 0..1 of a point `d` metres from the centre */
export function brushWeight(d: number, radius: number, falloff: number): number {
  if (d >= radius) return 0;
  const inner = radius * (1 - falloff);
  if (d <= inner) return 1;
  const t = (d - inner) / (radius - inner);
  // Smoothstep down
  return 1 - t * t * (3 - 2 * t);
}

/** The brush one step bigger or smaller ([ and ]): about 15 % per step, clamped */
export function stepRadius(radius: number, dir: 1 | -1): number {
  const next = dir > 0 ? Math.max(radius + 1, radius * 1.15) : Math.min(radius - 1, radius / 1.15);
  return Math.round(Math.min(BRUSH_LIMITS.radius.max, Math.max(BRUSH_LIMITS.radius.min, next)) * 10) / 10;
}
