/**
 * Base error class for game-specific errors
 */
export class GameError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'GameError';
  }
}

/**
 * Error during asset loading (models, textures, audio)
 */
export class AssetLoadError extends GameError {
  constructor(
    public readonly assetUrl: string,
    message?: string,
    public readonly originalError?: unknown
  ) {
    super(message ?? `Failed to load asset: ${assetUrl}`, 'ASSET_LOAD_ERROR');
    this.name = 'AssetLoadError';
  }
}

/**
 * Error during pathfinding (no route found, invalid network)
 */
export class PathfindingError extends GameError {
  constructor(message: string) {
    super(message, 'PATHFINDING_ERROR');
    this.name = 'PathfindingError';
  }
}

/**
 * Error in game state (invalid transition, missing data)
 */
export class GameStateError extends GameError {
  constructor(message: string) {
    super(message, 'GAME_STATE_ERROR');
    this.name = 'GameStateError';
  }
}
