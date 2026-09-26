import { SPAWN_COLORS } from '../configs/map-constants.config';

/**
 * A lane's colour as CSS, the same as on the map (SPAWN_COLORS). Without a
 * lane (index below 0) `none`: transparent for a colour bar, a text colour
 * for a name, never pure white (DESIGN_SYSTEM).
 */
export function laneCss(index: number, none = 'transparent'): string {
  if (index < 0) return none;
  return `#${SPAWN_COLORS[index % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`;
}
