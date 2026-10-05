import type { TdTooltipData, TdTooltipTargeting } from './tooltip-data.types';

/** The targeting banner's words, on the card and in its text */
export function targetingLabel(t: TdTooltipTargeting): string {
  switch (t.mode) {
    case 'air-only': return 'Air-only';
    case 'air-ground': return 'Ground and Air';
    case 'ground-only': return 'Ground-only';
  }
}

/**
 * A rich tooltip's card as plain text, for screen readers (aria-describedby
 * on its host): what the card shows, in its order, one sentence per part.
 */
export function tooltipText(data: TdTooltipData): string {
  const parts: string[] = [];
  parts.push([data.title, data.category].filter(Boolean).join(', '));
  if (data.hotkey) parts.push(`Key ${data.hotkey}`);
  for (const stat of data.stats ?? []) parts.push(`${stat.label} ${stat.value}`);
  if (data.targeting) parts.push(`Targets: ${targetingLabel(data.targeting)}${data.targeting.viaResearch ? ' (via Research)' : ''}`);
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
