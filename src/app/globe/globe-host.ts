import { GlobeRuntime, type GlobeCommand, type GlobeEvent } from './globe-runtime';

/**
 * Where the menu globe's GlobeRuntime runs (docs/GLOBE_PLAN.md,
 * Architektur): in a worker on an OffscreenCanvas where the browser can
 * (the earth stays smooth while the place loads on the main thread), else on
 * the main thread. Both take the same commands and give the same events.
 */
export interface GlobeHost {
  /** In a worker */
  readonly offThread: boolean;
  send(command: GlobeCommand): void;
  /** Ends the runtime and its context; the canvas cannot take another */
  dispose(): void;
}

/** The browser can draw WebGL 2 into an OffscreenCanvas a worker owns */
export function offscreenGlobeSupported(): boolean {
  // DevTools switch to compare: localStorage td_globe_main_thread = 1 keeps the globe on this thread
  if (typeof localStorage !== 'undefined' && localStorage.getItem('td_globe_main_thread') === '1') return false;
  if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return false;
  try {
    return new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

type InitCommand = Extract<GlobeCommand, { type: 'init' }>;

/**
 * Start a globe on `canvas`. `init` carries everything but the canvas;
 * `onEvent` hears the runtime.
 */
export function createGlobeHost(
  canvas: HTMLCanvasElement,
  init: Omit<InitCommand, 'type' | 'canvas'>,
  onEvent: (event: GlobeEvent) => void,
): GlobeHost {
  if (offscreenGlobeSupported()) {
    const worker = new Worker(new URL('./globe.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (message: MessageEvent<GlobeEvent>) => onEvent(message.data));
    worker.addEventListener('error', (error) => onEvent({ type: 'failed', message: error.message }));
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'init', canvas: offscreen, ...init } satisfies InitCommand, [offscreen]);
    let ended = false;
    return {
      offThread: true,
      send: (command) => {
        if (!ended) worker.postMessage(command);
      },
      dispose: () => {
        if (ended) return;
        ended = true;
        // The worker frees its context and closes itself
        worker.postMessage({ type: 'dispose' } satisfies GlobeCommand);
      },
    };
  }
  const runtime = new GlobeRuntime(
    (event) => onEvent(event),
    (callback) => requestAnimationFrame(callback),
    (handle) => cancelAnimationFrame(handle),
  );
  runtime.handle({ type: 'init', canvas, ...init });
  return {
    offThread: false,
    send: (command) => runtime.handle(command),
    dispose: () => runtime.handle({ type: 'dispose' }),
  };
}
