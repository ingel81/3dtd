/**
 * Game Engine - Framework-Agnostic Core
 *
 * Pure TypeScript game engine without Angular dependencies.
 * Can run with React, Vue, or vanilla JavaScript.
 */

// Interfaces
export type { IGameManager } from './game-manager.interface';

// Event Bus
export {
  GameEventBus,
  EventSubscription,
  SubscriptionBag,
  type GameEvent,
} from './game-event-bus';

// Services
export { VFXService } from './vfx.service';
export { AudioService } from './audio.service';
export { ScreenShakeService } from './screen-shake.service';

// Future: GameEngine abstraction
// export { GameEngine } from './game-engine';
