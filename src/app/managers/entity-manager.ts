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

  /** Cached arrays — rebuilt only when entities change */
  private _cachedAll: T[] | null = null;
  private _cachedActive: T[] | null = null;

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
    this._cachedAll = null;
    this._cachedActive = null;
  }

  /**
   * Remove an entity from the manager
   */
  remove(entity: T): void {
    entity.destroy();
    this.entities.delete(entity.id);
    this.activeEntities.delete(entity);
    this._cachedAll = null;
    this._cachedActive = null;
  }

  /**
   * Get entity by ID
   */
  getById(id: string): T | null {
    return this.entities.get(id) ?? null;
  }

  /**
   * Get all entities (cached, rebuilt only on add/remove)
   */
  getAll(): T[] {
    if (this._cachedAll === null) {
      this._cachedAll = Array.from(this.entities.values());
    }
    return this._cachedAll;
  }

  /**
   * Get all active entities (cached, rebuilt only on add/remove)
   */
  getAllActive(): T[] {
    if (this._cachedActive === null) {
      this._cachedActive = Array.from(this.activeEntities);
    }
    return this._cachedActive;
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.getAll().forEach((e) => this.remove(e));
    this.entities.clear();
    this.activeEntities.clear();
    this._cachedAll = null;
    this._cachedActive = null;
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
