/**
 * Structured tooltip payloads consumed by TdTooltipContentComponent.
 *
 * Replaces the legacy pre-line string formatting (mat-tooltip) for Tower-Cards,
 * giving us proper sections (header / stats / armor / flavor) with semantic markup.
 */

export type TdTooltipAccent = 'gold' | 'teal' | 'fire' | 'cold' | 'poison' | 'health' | 'neutral';

export interface TdTooltipStat {
  /** Short uppercase label, e.g. "DMG", "RATE", "RANGE". */
  label: string;
  /** Display value, e.g. "25", "1.0/s", "60m". */
  value: string;
}

export interface TdTooltipArmorRow {
  /** Armor-type label, e.g. "Unarmored", "Heavy". */
  label: string;
  /** Glyph or short emoji prefix from the armor config (optional). */
  icon?: string;
  /** Effectiveness multiplier as a string, e.g. "1.50×". */
  multiplier: string;
  /** Tint color for the bullet dot (hex / css var ref). */
  color: string;
  /** Whether to dim the row (multiplier near or below 1.0×). */
  dim?: boolean;
}

export interface TdTooltipData {
  /** Title, typically the tower or enemy name in caps. */
  title: string;
  /** Sub-label rendered to the right of the title (e.g. "DMG TYPE"). */
  category?: string;
  /** Accent color used for header + title. */
  accent?: TdTooltipAccent;
  /** Stat row — flexible column count (1–4). */
  stats?: TdTooltipStat[];
  /** Armor table title (e.g. "vs Armor"). Optional — header is rendered only if rows present. */
  armorTitle?: string;
  /** Armor effectiveness rows. */
  armor?: TdTooltipArmorRow[];
  /** Italic flavor / description line at the bottom. */
  flavor?: string;
}
