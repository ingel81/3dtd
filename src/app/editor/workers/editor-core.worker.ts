/// <reference lib="webworker" />
/**
 * The editor's worker (services/editor-core.ts): started with a map, ended
 * when it closes. It keeps a mirror of the map and packs, checks and
 * measures it off the page's thread (editor-core-host.ts).
 */
import { EditorCoreHost } from './editor-core-host';
import type { CoreRequest } from './editor-core-protocol';

const host = new EditorCoreHost(
  (reply, transfer) => postMessage(reply, transfer ?? []),
  (fn) => setTimeout(fn, 0),
);

addEventListener('message', (e: MessageEvent<CoreRequest>) => host.receive(e.data));
