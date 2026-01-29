/**
 * IGameManager - Lifecycle interface for all game managers
 *
 * Defines the standard lifecycle methods that every manager must implement:
 * - initialize(): Setup resources, register event handlers
 * - update(dt): Per-frame update logic
 * - destroy(): Cleanup resources, clear timeouts, unsubscribe events
 */
export interface IGameManager {
  /**
   * Initialize the manager with required dependencies.
   * Called once when the game starts or the manager is created.
   */
  initialize(...args: unknown[]): void;

  /**
   * Per-frame update. Called every frame during the game loop.
   * @param dt Delta time in milliseconds
   */
  update(dt: number, ...args: unknown[]): void;

  /**
   * Destroy the manager - cleanup all resources.
   * Clear timeouts/intervals, unsubscribe events, release references.
   */
  destroy(): void;
}
