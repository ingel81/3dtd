import type { Enemy } from '../../entities/enemy.entity';
import type { Tower } from '../../entities/tower.entity';

/**
 * Which camouflaged enemies a scout sees this sub-step (Enemy.revealed, TODO E100): within the detection
 * radius of a built tower that has one (Tower.detectionRadius), flat distance as a tower's range. Run before
 * the combat, so the towers and the hero pick by it. `scouts` is scratch the caller keeps.
 */
export function revealCamo(
  enemies: readonly Enemy[],
  towers: readonly Tower[],
  gameTimeMs: number,
  scouts: Tower[],
): void {
  scouts.length = 0;
  for (const tower of towers) {
    if (tower.detectionRadius > 0 && tower.isBuilt(gameTimeMs)) scouts.push(tower);
  }
  for (const enemy of enemies) {
    if (!enemy.camo) continue;
    let seen = false;
    for (const scout of scouts) {
      const radius = scout.detectionRadius;
      if (scout.distanceSqTo(enemy.position) <= radius * radius) {
        seen = true;
        break;
      }
    }
    enemy.revealed = seen;
  }
}
