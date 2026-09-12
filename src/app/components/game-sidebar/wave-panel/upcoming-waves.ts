import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { EnemyTypeId, ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { templateObjectForWave } from '../../../configs/wave-curriculum.config';
import { splitTraitLabel } from '../sidebar-tooltips';

/** Eine Zeile der COMING-UP-Vorschau im WAVE-Panel. */
export interface WavePeek {
  wave: number;
  name: string;
  description: string;
  /** Armor-Glyphen der Gegnertypen, dazu ✈️, wenn Lufteinheiten dabei sind. */
  armorIcons: string;
  /** Tooltip der Zeile: die Beschreibung, dazu, in was ein Kill Gegner der Welle teilt. */
  tooltip: string;
}

/**
 * Phase 5.16: Show next 2 curriculum-forced waves so the player can
 * prepare their defense (e.g. build Anti-Air before W7 bat_swarm).
 * Returns empty array once we're past the curriculum (NN-loop range).
 */
export function peekUpcomingWaves(currentWave: number): WavePeek[] {
  const peeks: WavePeek[] = [];
  for (const offset of [1, 2]) {
    const w = currentWave + offset;
    const t = templateObjectForWave(w);
    if (!t) continue;
    const armors = new Set<string>();
    const traits: string[] = [];
    let hasAir = false;
    for (const [enemyId] of t.enemies) {
      const cfg = ENEMY_TYPES[enemyId as EnemyTypeId];
      if (!cfg) continue;
      armors.add(cfg.armorType);
      if (cfg.isAirUnit) hasAir = true;
      const split = splitTraitLabel(enemyId);
      if (split) traits.push(`${cfg.name}: ${split}.`);
    }
    const armorIcons = Array.from(armors)
      .map((a) => ARMOR_TYPE_UI[a as keyof typeof ARMOR_TYPE_UI]?.icon ?? '')
      .filter(Boolean)
      .join(' ') + (hasAir ? ' ✈️' : '');
    peeks.push({
      wave: w,
      name: t.name,
      description: t.description,
      armorIcons,
      tooltip: [t.description, ...traits].join(' '),
    });
  }
  return peeks;
}
