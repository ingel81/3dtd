'use strict';

/**
 * Bundles the coop relay for the desktop app (docs/COOP_PLAN.md, C4d):
 * coop-server/src/desktop.ts with ws and the LAN discovery into one file,
 * desktop/relay/relay.mjs, which the main process runs in a utility process.
 * The relay stays TypeScript in coop-server/; nothing here is written by hand.
 */

const path = require('node:path');
const esbuild = require('esbuild');

const repoRoot = path.join(__dirname, '..', '..');
const outfile = path.join(__dirname, '..', 'relay', 'relay.mjs');

esbuild
  .build({
    entryPoints: [path.join(repoRoot, 'coop-server', 'src', 'desktop.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // ws picks these up when installed, for speed; plain JS works without them
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'warning',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  })
  .then(() => console.log(`[build-relay] ${path.relative(repoRoot, outfile)}`))
  .catch(() => process.exit(1));
