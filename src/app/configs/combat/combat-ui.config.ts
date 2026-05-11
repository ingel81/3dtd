/**
 * Combat UI Metadata Configuration
 *
 * Icons, colors, labels, and descriptions for damage and armor types.
 * Used by UI components (tower panel, wave preview, tooltips).
 *
 * Mapped types enforce that every DamageType/ArmorType has an entry.
 * Adding a new type without UI metadata is a compile-time error.
 */

import { DamageType, ArmorType } from './combat.types';

// ==================== Damage Type UI ====================

export interface DamageTypeUIMeta {
  id: DamageType;
  label: string;
  icon: string;
  color: string;
  shortLabel: string;
  description: string;
}

/** UI metadata for each damage type. Compile-time complete. */
export const DAMAGE_TYPE_UI: Readonly<Record<DamageType, DamageTypeUIMeta>> = {
  physical: {
    id: 'physical',
    label: 'Physical',
    icon: '\u2694\uFE0F',
    color: '#B0B0B0',
    shortLabel: 'PHYS',
    description: 'Solid allrounder, falls off vs armor',
  },
  pierce: {
    id: 'pierce',
    label: 'Pierce',
    icon: '\uD83C\uDFAF',
    color: '#FFD700',
    shortLabel: 'PIRC',
    description: 'High fire rate, anti-swarm',
  },
  siege: {
    id: 'siege',
    label: 'Siege',
    icon: '\uD83D\uDCA5',
    color: '#FF6600',
    shortLabel: 'SIEG',
    description: 'Slow AoE, anti-heavy/fortified',
  },
  magic: {
    id: 'magic',
    label: 'Magic',
    icon: '\u2728',
    color: '#9B59B6',
    shortLabel: 'MAGI',
    description: 'Ethereal counter, utility',
  },
  fire: {
    id: 'fire',
    label: 'Fire',
    icon: '\uD83D\uDD25',
    color: '#FF4400',
    shortLabel: 'FIRE',
    description: 'DoT/Burn, anti-regen',
  },
  ice: {
    id: 'ice',
    label: 'Ice',
    icon: '\u2744\uFE0F',
    color: '#00BFFF',
    shortLabel: 'ICE',
    description: 'Low DPS, strong slow/CC',
  },
  poison: {
    id: 'poison',
    label: 'Poison',
    icon: '\u2620\uFE0F',
    color: '#44CC22',
    shortLabel: 'POIS',
    description: 'DoT specialist, anti-regen',
  },
  lightning: {
    id: 'lightning',
    label: 'Lightning',
    icon: '\u26A1',
    color: '#7DD3FC',
    shortLabel: 'LTNG',
    description: 'Chain hitscan, anti-swarm/air',
  },
};

// ==================== Armor Type UI ====================

export interface ArmorTypeUIMeta {
  id: ArmorType;
  label: string;
  icon: string;
  color: string;
  description: string;
  weakTo: string;
}

/** UI metadata for each armor type. Compile-time complete. */
export const ARMOR_TYPE_UI: Readonly<Record<ArmorType, ArmorTypeUIMeta>> = {
  unarmored: {
    id: 'unarmored',
    label: 'Unarmored',
    icon: '\uD83D\uDFE2',
    color: '#4CAF50',
    description: 'No damage resistance',
    weakTo: 'Pierce, Fire',
  },
  light: {
    id: 'light',
    label: 'Light',
    icon: '\uD83D\uDD35',
    color: '#2196F3',
    description: 'Fast, vulnerable to pierce',
    weakTo: 'Pierce, Ice',
  },
  heavy: {
    id: 'heavy',
    label: 'Heavy',
    icon: '\uD83D\uDFE0',
    color: '#FF9800',
    description: 'Tough, requires siege',
    weakTo: 'Siege',
  },
  fortified: {
    id: 'fortified',
    label: 'Fortified',
    icon: '\uD83D\uDD34',
    color: '#F44336',
    description: 'Very tough, DPS check',
    weakTo: 'Siege',
  },
  ethereal: {
    id: 'ethereal',
    label: 'Ethereal',
    icon: '\uD83D\uDFE3',
    color: '#9C27B0',
    description: 'Resists most, weak to magic/ice',
    weakTo: 'Magic, Ice',
  },
};

// ==================== Helpers ====================

export function getDamageTypeMeta(type: DamageType): DamageTypeUIMeta {
  return DAMAGE_TYPE_UI[type];
}

export function getArmorTypeMeta(type: ArmorType): ArmorTypeUIMeta {
  return ARMOR_TYPE_UI[type];
}
