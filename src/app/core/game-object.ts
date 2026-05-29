import { Component, ComponentType } from './component';

/**
 * GameObject types for type discrimination
 */
export type GameObjectType = 'enemy' | 'tower' | 'projectile';

/**
 * Abstract base class for all game entities.
 * Uses component-based architecture for flexible functionality composition.
 */
export abstract class GameObject {
  readonly id: string;
  readonly type: GameObjectType;

  protected components = new Map<ComponentType, Component>();
  /**
   * Flat mirror of `components` for the per-frame update() hot path: iterating
   * an array (no Map iterator allocation, indexed access) is materially cheaper
   * than `components.values()` per enemy per sub-step. Kept in sync by
   * addComponent/removeComponent/destroy.
   */
  private _componentList: Component[] = [];
  private _active = true;

  private static idCounter = 0;

  constructor(type: GameObjectType) {
    this.id = GameObject.generateId(type);
    this.type = type;
  }

  /**
   * Add a component to this GameObject
   */
  addComponent<T extends Component>(component: T, type: ComponentType): T {
    const existing = this.components.get(type);
    if (existing) {
      console.warn(`GameObject ${this.id} already has component of type ${type}`);
      const idx = this._componentList.indexOf(existing);
      if (idx !== -1) this._componentList[idx] = component;
    } else {
      this._componentList.push(component);
    }
    this.components.set(type, component);
    return component;
  }

  /**
   * Get a component by type (type-safe)
   */
  getComponent<T extends Component>(type: ComponentType): T | null {
    return (this.components.get(type) as T) ?? null;
  }

  /**
   * Check if GameObject has a specific component
   */
  hasComponent(type: ComponentType): boolean {
    return this.components.has(type);
  }

  /**
   * Remove a component from this GameObject
   */
  removeComponent(type: ComponentType): void {
    const component = this.components.get(type);
    if (component) {
      component.onDestroy();
      this.components.delete(type);
      const idx = this._componentList.indexOf(component);
      if (idx !== -1) this._componentList.splice(idx, 1);
    }
  }

  /**
   * Update all enabled components
   */
  update(deltaTime: number): void {
    // Iterate the flat array (V8 optimizes array for-of with no allocation),
    // not the components Map (whose .values() iterator allocates each call).
    for (const component of this._componentList) {
      if (component.enabled) {
        component.update(deltaTime);
      }
    }
  }

  /**
   * Destroy this GameObject and all its components
   */
  destroy(): void {
    for (const component of this.components.values()) {
      component.onDestroy();
    }
    this.components.clear();
    this._componentList.length = 0;
    this._active = false;
  }

  get active(): boolean {
    return this._active;
  }

  /**
   * Generate unique ID for GameObject
   */
  private static generateId(type: GameObjectType): string {
    return `${type}-${++GameObject.idCounter}`;
  }

  /**
   * Reset ID counter (for testing or game reset)
   */
  static resetIdCounter(): void {
    GameObject.idCounter = 0;
  }
}
