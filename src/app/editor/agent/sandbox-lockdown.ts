/**
 * Takes away what reaches past the map from the script sandbox's worker
 * scope (docs/AGENT_MCP.md): network, storage, other workers, script
 * loading, timers, messaging. Each name gets an own undefined property over
 * the one the scope inherits, so neither the script nor anything it digs out
 * of the language (`({}).constructor.constructor('return fetch')()`) finds
 * it. The desktop app's policy for the worker file forbids every connection
 * and every script source besides (desktop/src/protocol.js).
 */

/** What the sandbox takes away; the worker refuses to run a script while one of NEEDED is still there */
export const LOCKED_NAMES = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'BroadcastChannel', 'MessageChannel', 'Worker', 'SharedWorker', 'navigator', 'location', 'setTimeout', 'setInterval',
  'queueMicrotask', 'requestAnimationFrame', 'WebAssembly', 'Request', 'Response', 'FileReader', 'FileReaderSync', 'createImageBitmap',
  'OffscreenCanvas', 'Notification', 'postMessage', 'process', 'require', 'Deno', 'Bun',
] as const;

/** Must be gone before a script runs */
export const NEEDED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel'] as const;

/**
 * Locks `scope` (the worker's global scope); returns the names it could not
 * take away and that were there to take. The worker keeps its own
 * postMessage, bound before the lock.
 */
export function lockDown(scope: object): string[] {
  const failed: string[] = [];
  for (const name of LOCKED_NAMES) {
    if (!(name in scope)) continue;
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    } catch {
      // A name the scope will not give up: checked below
    }
    if ((scope as Record<string, unknown>)[name] !== undefined) failed.push(name);
  }
  return failed;
}

/** Whether the locked scope may run a script: nothing of NEEDED left */
export function lockedEnough(failed: readonly string[]): boolean {
  return !failed.some((name) => (NEEDED as readonly string[]).includes(name));
}
