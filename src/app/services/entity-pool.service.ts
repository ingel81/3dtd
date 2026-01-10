import { Injectable } from '@angular/core';

/**
 * Entity pool service - placeholder
 *
 * Note: Entity pooling is now handled by ThreeTilesEngine renderers.
 * This service exists for backwards compatibility.
 */
@Injectable()
export class EntityPoolService {
  /**
   * Cleanup resources (no-op - pooling handled by ThreeTilesEngine)
   */
  destroy(): void {
    // No-op
  }
}
