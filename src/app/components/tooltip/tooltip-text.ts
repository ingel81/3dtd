import type { TdTooltipData, TdTooltipTargeting } from './tooltip-data.types';
import type { Messages } from '../../i18n/messages/en';

/** The targeting banner's words, on the card and in its text */
export function targetingLabel(t: Messages, targeting: TdTooltipTargeting): string {
  switch (targeting.mode) {
    case 'air-only': return t.hud.tooltip.airOnly;
    case 'air-ground': return t.hud.tooltip.groundAndAir;
    case 'ground-only': return t.hud.tooltip.groundOnly;
  }
}

/**
 * A rich tooltip's card as plain text, for screen readers (aria-describedby
 * on its host): what the card shows, in its order, one sentence per part.
 */
export function tooltipText(t: Messages, data: TdTooltipData): string {
  const parts: string[] = [];
  parts.push([data.title, data.category].filter(Boolean).join(', '));
  if (data.hotkey) parts.push(t.hud.tooltip.key(data.hotkey));
  for (const stat of data.stats ?? []) parts.push(`${stat.label} ${stat.value}`);
  if (data.targeting) parts.push(t.hud.tooltip.targets(`${targetingLabel(t, data.targeting)}${data.targeting.viaResearch ? t.hud.tooltip.viaResearchNote : ''}`));
  for (const banner of data.banners ?? []) parts.push(banner.text);
  if (data.armor?.length) {
    parts.push([data.armorTitle, ...data.armor.map((row) => `${row.label} ${row.multiplier}`)].filter(Boolean).join(': '));
  }
  for (const section of data.sections ?? []) {
    const rows = section.rows.map((row) => {
      const chips = row.chips?.map((chip) => chip.label).join(', ');
      const line = [row.label, row.detail, row.value, chips].filter(Boolean).join(' ');
      return row.note ? `${line} (${row.note})` : line;
    });
    parts.push(`${section.title}: ${rows.join('; ')}`);
  }
  if (data.flavor) parts.push(data.flavor);
  return parts
    .filter((part) => part.trim().length > 0)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}
