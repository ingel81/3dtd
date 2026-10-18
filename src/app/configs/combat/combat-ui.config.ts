/**
 * Combat UI Metadata Configuration
 *
 * Colors for damage and armor types; their labels and descriptions are the
 * dictionary's (i18n `damageTypes`, `armorTypes`).
 * Used by UI components (tower panel, wave preview, tooltips).
 *
 * Mapped types enforce that every DamageType/ArmorType has an entry.
 * Adding a new type without UI metadata is a compile-time error.
 */

import { DamageType, ArmorType } from './combat.types';

// ==================== Damage Type UI ====================

export interface DamageTypeUIMeta {
  id: DamageType;
  color: string;
}

/** UI metadata for each damage type. Compile-time complete. */
export const DAMAGE_TYPE_UI: Readonly<Record<DamageType, DamageTypeUIMeta>> = {
  physical: {
    id: 'physical',
    color: '#B0B0B0',
  },
  pierce: {
    id: 'pierce',
    color: '#FFD700',
  },
  siege: {
    id: 'siege',
    color: '#FF6600',
  },
  magic: {
    id: 'magic',
    color: '#9B59B6',
  },
  fire: {
    id: 'fire',
    color: '#FF4400',
  },
  ice: {
    id: 'ice',
    color: '#00BFFF',
  },
  poison: {
    id: 'poison',
    color: '#44CC22',
  },
  lightning: {
    id: 'lightning',
    color: '#7DD3FC',
  },
  chaos: {
    id: 'chaos',
    color: '#D946EF',
  },
};

// ==================== Armor Type UI ====================

export interface ArmorTypeUIMeta {
  id: ArmorType;
  color: string;
}

/**
 * UI metadata for each armor type. Compile-time complete.
 *
 * What an armor is weak to is not listed here: the sidebar reads it off
 * DAMAGE_MATRIX (bestDamageTypesAgainst), so it follows a rebalance.
 */
export const ARMOR_TYPE_UI: Readonly<Record<ArmorType, ArmorTypeUIMeta>> = {
  unarmored: {
    id: 'unarmored',
    color: '#4CAF50',
  },
  light: {
    id: 'light',
    color: '#2196F3',
  },
  heavy: {
    id: 'heavy',
    color: '#FF9800',
  },
  fortified: {
    id: 'fortified',
    color: '#F44336',
  },
  ethereal: {
    id: 'ethereal',
    color: '#9C27B0',
  },
};
