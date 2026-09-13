import type { Enemy } from '../entities/enemy.entity';

const spot = { lat: 0, lon: 0, height: 0 };

/**
 * Where the effects of a hit on `enemy` go (blood, damage numbers, ice):
 * its position at the height of its model origin (ground plus height
 * offset), or for an enemy with a body along the route (the ooze) the point
 * the hit landed on, on the ground (RouteBody.hit). The damage paths set
 * that point before they deal the damage. The returned object is reused:
 * read it right away.
 */
export function enemyHitSpot(enemy: Enemy): Readonly<{ lat: number; lon: number; height: number }> {
  if (enemy.body) return enemy.body.hit;
  spot.lat = enemy.position.lat;
  spot.lon = enemy.position.lon;
  spot.height = enemy.transform.terrainHeight + enemy.heightOffset;
  return spot;
}

const bloodColors = new Map<string, number | undefined>();

/** The type's blood colour as a hex number, undefined for the default red (EnemyTypeConfig.bloodColor). */
export function enemyBloodColor(enemy: Enemy): number | undefined {
  const type = enemy.typeConfig;
  let color = bloodColors.get(type.id);
  if (color === undefined && !bloodColors.has(type.id)) {
    color = type.bloodColor ? parseInt(type.bloodColor.replace('#', ''), 16) : undefined;
    bloodColors.set(type.id, color);
  }
  return color;
}
