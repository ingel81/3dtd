/// <reference lib="webworker" />
/**
 * The menu globe's worker (docs/GLOBE_PLAN.md, Architektur): a GlobeRuntime
 * on the OffscreenCanvas the main thread transferred, looping by itself, so
 * the place loading on the main thread does not stall the earth.
 */
import { GlobeRuntime, type GlobeCommand } from './globe-runtime';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// Workers with an OffscreenCanvas have animation frames in Chrome and Firefox; a timer elsewhere
const requestFrame = (callback: (now: number) => void): number =>
  typeof scope.requestAnimationFrame === 'function'
    ? scope.requestAnimationFrame(callback)
    : (setTimeout(() => callback(performance.now()), 16) as unknown as number);
const cancelFrame = (handle: number): void =>
  typeof scope.cancelAnimationFrame === 'function' ? scope.cancelAnimationFrame(handle) : clearTimeout(handle);

const runtime = new GlobeRuntime((event, transfer) => scope.postMessage(event, transfer ?? []), requestFrame, cancelFrame);

scope.addEventListener('message', (message: MessageEvent<GlobeCommand>) => {
  runtime.handle(message.data);
  if (message.data.type === 'dispose') scope.close();
});
