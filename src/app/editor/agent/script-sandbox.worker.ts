/**
 * The script sandbox (docs/AGENT_MCP.md): runs one AI agent's map script on
 * a copy of the open map and answers with the commands it kept
 * (map-script.ts). Built on its own into public/agent/script-worker.js
 * (tools/agent/build-script-worker.mjs) and served under a policy that
 * allows evaluating the script and nothing else: no connections, no script
 * loading (desktop/src/protocol.js). The page starts a fresh worker per
 * script and ends it on the answer or at the time limit.
 */
import type { MapAssetCatalog } from '../catalog/asset-catalog';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { runMapScript, type ScriptRunResult } from './map-script';
import { lockDown, lockedEnough } from './sandbox-lockdown';

export interface SandboxRequest {
  source: string;
  doc: CustomMapDocument;
  catalog: MapAssetCatalog;
  seed: number;
}

const scope = globalThis as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<SandboxRequest>) => void) | null };
const post = scope.postMessage.bind(scope);
const failed = lockDown(scope);

let ran = false;
scope.onmessage = (event) => {
  // One script per worker
  if (ran) return;
  ran = true;
  let result: ScriptRunResult;
  if (!lockedEnough(failed)) {
    result = { ok: false, error: `the sandbox could not take away ${failed.join(', ')}; no script runs`, logs: [] };
  } else {
    const { source, doc, catalog, seed } = event.data;
    result = runMapScript(String(source), doc, catalog, { seed });
  }
  post(result);
};
