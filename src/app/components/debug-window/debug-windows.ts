/**
 * All debug windows behind one module path.
 *
 * TowerDefenseComponent imports them from here and renders them in a single
 * `@defer` block. Angular emits one dynamic import per deferred component;
 * with a shared path they all resolve to this module, so the windows arrive
 * as one lazy chunk instead of eleven small ones.
 */
export { CameraDebuggerComponent } from './camera-debugger.component';
export { WaveDebuggerComponent } from './wave-debugger.component';
export { SoundDebuggerComponent } from './sound-debugger.component';
export { EventDebuggerComponent } from './event-debugger.component';
export { DevWorldDebuggerComponent } from '../../devworld/devworld-debugger.component';
export { TrainingDebuggerComponent } from './training-debugger.component';
export { TowerDebuggerComponent } from './tower-debugger.component';
export { EnemyDebuggerComponent } from './enemy-debugger.component';
export { DisplayOptionsComponent } from './display-options.component';
export { PerformanceDebuggerComponent } from './performance-debugger.component';
export { LosDebuggerComponent } from './los-debugger.component';
