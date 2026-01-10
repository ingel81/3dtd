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
    if (this.components.has(type)) {
      console.warn(`GameObject ${this.id} already has component of type ${type}`);
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
    }
  }

  /**
   * Update all enabled components
   */
  update(deltaTime: number): void {
    for (const component of this.components.values()) {
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
    this._active = false;
  }

  get active(): boolean {
    return this._active;
  }

  set active(value: boolean) {
    this._active = value;
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
