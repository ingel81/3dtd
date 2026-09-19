import { GameObject } from '../core/game-object';
import { IGameManager } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';

/**
 * An array in insertion order that callers may iterate while entries come
 * and go. get() hands out the current array; the first change after that
 * copies it (slice, a plain memory copy), so an array already handed out
 * never changes under its reader: clear() and every loop that removes while
 * it iterates rely on that.
 *
 * Replaces rebuilding the array with Array.from on every add and remove. In
 * a wave enemies spawn and die every sub-step, and the rebuild over
 * thousands of entities ran through the iterator protocol, which
 * SpiderMonkey implements in self-hosted JS (Firefox profile 2026-09-19,
 * 5000 enemies: 12 ms/s in Array.from, plus the garbage of each old array).
 */
class SnapshotList<T> {
  private items: T[] = [];
  private handedOut = false;

  get(): T[] {
    this.handedOut = true;
    return this.items;
  }

  add(item: T): void {
    this.writable().push(item);
  }

  /** Put `next` where `previous` was, keeping the order. */
  replace(previous: T, next: T): void {
    const index = this.items.indexOf(previous);
    if (index < 0) this.add(next);
    else this.writable()[index] = next;
  }

  remove(item: T): void {
    const index = this.items.indexOf(item);
    if (index >= 0) this.writable().splice(index, 1);
  }

  clear(): void {
    this.items = [];
    this.handedOut = false;
  }

  private writable(): T[] {
    if (this.handedOut) {
      this.items = this.items.slice();
      this.handedOut = false;
    }
    return this.items;
  }
}

/**
 * Abstract base class for all entity managers
 *
 * Implements IGameManager lifecycle interface.
 */
export abstract class EntityManager<T extends GameObject> implements IGameManager {
  protected entities = new Map<string, T>();
  protected activeEntities = new Set<T>();
  protected tilesEngine: ThreeTilesEngine | null = null;

  /** The arrays getAll() and getAllActive() hand out, kept in step with the two collections above */
  private readonly allList = new SnapshotList<T>();
  private readonly activeList = new SnapshotList<T>();

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
    const previous = this.entities.get(entity.id);
    if (previous === undefined) this.allList.add(entity);
    else if (previous !== entity) this.allList.replace(previous, entity);
    this.entities.set(entity.id, entity);
    if (!this.activeEntities.has(entity)) {
      this.activeEntities.add(entity);
      this.activeList.add(entity);
    }
  }

  /**
   * Remove an entity from the manager
   */
  remove(entity: T): void {
    entity.destroy();
    const stored = this.entities.get(entity.id);
    if (stored !== undefined) {
      this.entities.delete(entity.id);
      this.allList.remove(stored);
    }
    if (this.activeEntities.delete(entity)) this.activeList.remove(entity);
  }

  /**
   * Get entity by ID
   */
  getById(id: string): T | null {
    return this.entities.get(id) ?? null;
  }

  /**
   * All entities in insertion order. The array does not change once handed
   * out; add and remove work on a copy (SnapshotList).
   */
  getAll(): T[] {
    return this.allList.get();
  }

  /** All active entities in insertion order, same guarantee as getAll(). */
  getAllActive(): T[] {
    return this.activeList.get();
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.getAll().forEach((e) => this.remove(e));
    this.entities.clear();
    this.activeEntities.clear();
    this.allList.clear();
    this.activeList.clear();
  }

  /**
   * Update all active entities. `_extra` lets sub-classes accept an extra
   * argument (e.g. EnemyManager passes `gameTimeMs`) without breaking variance.
   */
  update(deltaTime: number, _extra?: unknown): void {
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
