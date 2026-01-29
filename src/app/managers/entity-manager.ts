import { GameObject } from '../core/game-object';
import { IGameManager } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Abstract base class for all entity managers
 *
 * Implements IGameManager lifecycle interface.
 */
export abstract class EntityManager<T extends GameObject> implements IGameManager {
  protected entities = new Map<string, T>();
  protected activeEntities = new Set<T>();
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
    this.activeEntities.add(entity);
  }

  /**
   * Remove an entity from the manager
   */
  remove(entity: T): void {
    entity.destroy();
    this.entities.delete(entity.id);
    this.activeEntities.delete(entity);
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
   * Get all active entities - O(1) via cached Set
   */
  getAllActive(): T[] {
    return Array.from(this.activeEntities);
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.getAll().forEach((e) => this.remove(e));
    this.entities.clear();
    this.activeEntities.clear();
  }

  /**
   * Update all active entities
   */
  update(deltaTime: number): void {
    for (const entity of this.getAllActive()) {
      entity.update(deltaTime);
    }
  }

  /**
   * Destroy the manager - cleanup all resources
   */
  destroy(): void {
    this.clear();
    this.tilesEngine = null;
  }
}
