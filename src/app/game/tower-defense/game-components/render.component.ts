import { Component } from '../core/component';
import { GameObject } from '../core/game-object';

/**
 * RenderComponent - placeholder for visual representation
 *
 * Note: Actual rendering is now handled by ThreeTilesEngine renderers.
 * This component exists for entity structure compatibility.
 */
export class RenderComponent extends Component {
  constructor(gameObject: GameObject) {
    super(gameObject);
  }

  update(deltaTime: number): void {
    // Rendering handled by ThreeTilesEngine
  }

  override onDestroy(): void {
    // Cleanup handled by ThreeTilesEngine renderers
  }
}
