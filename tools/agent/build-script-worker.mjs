/**
 * Writes public/agent/script-worker.js: the AI agent's script sandbox
 * (src/app/editor/agent/script-sandbox.worker.ts) with the map kit, as one
 * classic worker file at a fixed address. Fixed, so the desktop app can
 * serve it under a policy of its own that allows evaluating the script and
 * forbids every connection (desktop/src/protocol.js, AGENT_WORKER_POLICY);
 * an Angular-built worker gets a hashed name. Run by postinstall, `npm start`
 * and `npm run build`; a change to the kit needs a new run while the dev
 * server keeps going (docs/AGENT_MCP.md).
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Bundles the sandbox into `outfile` */
export async function buildScriptWorker(outfile = resolve(root, 'public/agent/script-worker.js')) {
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(root, 'src/app/editor/agent/script-sandbox.worker.ts')],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    // The build-areas worker's URL (map-validation) is never used in the sandbox
    logOverride: { 'empty-import-meta': 'silent' },
  });
  return outfile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildScriptWorker();
  console.log('Agent script worker written');
}
