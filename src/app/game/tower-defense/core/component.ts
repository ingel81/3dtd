import { GameObject } from './game-object';

/**
 * Component Types for type-safe component retrieval
 */
export enum ComponentType {
  TRANSFORM = 'transform',
  HEALTH = 'health',
  RENDER = 'render',
  AUDIO = 'audio',
  MOVEMENT = 'movement',
  COMBAT = 'combat',
}

/**
 * Abstract base class for all components.
 * Components add specific functionality to GameObjects.
 */
export abstract class Component {
  protected gameObject: GameObject;
  enabled = true;

  constructor(gameObject: GameObject) {
    this.gameObject = gameObject;
  }

  /**
   * Called every frame to update component state
   */
  abstract update(deltaTime: number): void;

  /**
   * Called when component is destroyed
   */
  onDestroy(): void {
    // Optional cleanup in derived classes
  }

  /**
   * Get the GameObject this component is attached to
   */
  getGameObject(): GameObject {
    return this.gameObject;
  }
}
