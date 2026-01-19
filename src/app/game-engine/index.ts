/**
 * Game Engine - Framework-Agnostic Core
 *
 * Pure TypeScript game engine without Angular dependencies.
 * Can run with React, Vue, or vanilla JavaScript.
 */

// Event Bus
export {
  GameEventBus,
  EventSubscription,
  SubscriptionBag,
  type GameEvent,
} from './game-event-bus';

// Services
export { VFXService } from './vfx.service';

// Game Engine Core (coming in Phase 2)
// export { GameEngine } from './game-engine';
