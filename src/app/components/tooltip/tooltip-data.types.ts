/**
 * Structured tooltip payloads consumed by TdTooltipContentComponent.
 *
 * Replaces the legacy pre-line string formatting (mat-tooltip) for Tower-Cards,
 * giving us proper sections (header / stats / armor / flavor) with semantic markup.
 */

import type { TdIconName } from '../icon/icon.component';

export type TdTooltipAccent = 'gold' | 'teal' | 'fire' | 'cold' | 'lightning' | 'chaos' | 'poison' | 'health' | 'neutral';

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

/**
 * Tower targeting capability — rendered as a banner row in tower tooltips
 * so the player sees the spec at a glance. `via-research` indicates the
 * air capability was unlocked through a research (currently aa-retrofit
 * for dual-gatling) rather than declared in the base config — drives a
 * small "via Research" note next to the label.
 */
export interface TdTooltipTargeting {
  mode: 'air-only' | 'air-ground' | 'ground-only';
  viaResearch?: boolean;
}

/**
 * A line that stands out under the stats: what changes the rules of the
 * thing, like a wave's mutator. `danger` gets the red stripe.
 */
export interface TdTooltipBanner {
  icon: TdIconName;
  text: string;
  tone?: 'danger' | 'neutral';
}

/** An icon with its label, in the color of what it stands for (a damage type) */
export interface TdTooltipChip {
  icon: TdIconName;
  label: string;
  color: string;
}

/** One line of a list section: a dot, the label, a muted detail, a value or chips right, a note under it */
export interface TdTooltipRow {
  label: string;
  /** Muted text after the label, e.g. an enemy's armor */
  detail?: string;
  /** Right-aligned value, e.g. "-6.8" */
  value?: string;
  /** Color of the dot in front; no dot without it */
  color?: string;
  /** Right-aligned chips instead of a value */
  chips?: TdTooltipChip[];
  /** Small line under the row, e.g. what an enemy does beyond walking */
  note?: string;
}

/** A titled list, e.g. the enemies of a wave */
export interface TdTooltipSection {
  title: string;
  /** Muted heading of the right column, e.g. "HQ each" */
  aside?: string;
  rows: TdTooltipRow[];
}

export interface TdTooltipData {
  /** Title, typically the tower or enemy name in caps. */
  title: string;
  /** Sub-label rendered to the right of the title (e.g. "DMG TYPE"). */
  category?: string;
  /** Key cap at the right of the header: the key that does what the hovered control does. */
  hotkey?: string;
  /** Accent color used for header + title. */
  accent?: TdTooltipAccent;
  /** Stat row — flexible column count (1–4). */
  stats?: TdTooltipStat[];
  /** Targeting capability banner (rendered between stats and armor). */
  targeting?: TdTooltipTargeting;
  /** Armor table title (e.g. "vs Armor"). Optional — header is rendered only if rows present. */
  armorTitle?: string;
  /** Armor effectiveness rows. */
  armor?: TdTooltipArmorRow[];
  /** Banners under the stats (and under the targeting banner). */
  banners?: TdTooltipBanner[];
  /** List sections after the armor table. */
  sections?: TdTooltipSection[];
  /** Italic flavor / description line at the bottom. */
  flavor?: string;
}
