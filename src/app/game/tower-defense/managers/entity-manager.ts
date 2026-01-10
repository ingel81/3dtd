import { GameObject } from '../core/game-object';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Abstract base class for all entity managers
 */
export abstract class EntityManager<T extends GameObject> {
  protected entities = new Map<string, T>();
  protected tilesEngine: ThreeTilesEngine | null = null;

  /**
   * Initialize with ThreeTilesEngine
   */
  initialize(tilesEngine: ThreeTilesEngine): void {
    this.tilesEngine = tilesEngine;
  }

  /**
   * Add an entity to the manager
   */
  add(entity: T): void {
    this.entities.set(entity.id, entity);
  }

  /**
   * Remove an entity from the manager
   */
  remove(entity: T): void {
    entity.destroy();
    this.entities.delete(entity.id);
  }

  /**
   * Get entity by ID
   */
  getById(id: string): T | null {
    return this.entities.get(id) ?? null;
  }

  /**
   * Get all entities
   */
  getAll(): T[] {
    return Array.from(this.entities.values());
  }

  /**
   * Get all active entities
   */
  getAllActive(): T[] {
    return this.getAll().filter((e) => e.active);
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.getAll().forEach((e) => this.remove(e));
    this.entities.clear();
  }

  /**
   * Update all active entities
   */
  update(deltaTime: number): void {
    for (const entity of this.getAllActive()) {
      entity.update(deltaTime);
    }
  }
}
