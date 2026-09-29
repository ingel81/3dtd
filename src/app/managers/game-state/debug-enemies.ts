import type { Enemy } from '../../entities/enemy.entity';

/**
 * The enemies the dev tools placed (debug:spawn-enemy), by id: while there
 * are any, towers fight outside a wave too, and no snapshot is taken. The
 * list stays until the wave ends, the game is over, a restore or a restart,
 * or the dev tools remove one (debug:remove-enemy), killed ones included,
 * as Enemy Debug keeps them.
 */
export class DebugEnemies {
  private readonly enemies = new Map<string, Enemy>();

  get size(): number {
    return this.enemies.size;
  }

  add(enemy: Enemy): void {
    this.enemies.set(enemy.id, enemy);
  }

  remove(id: string): void {
    this.enemies.delete(id);
  }

  has(id: string): boolean {
    return this.enemies.has(id);
  }

  all(): IterableIterator<Enemy> {
    return this.enemies.values();
  }

  clear(): void {
    this.enemies.clear();
  }
}
