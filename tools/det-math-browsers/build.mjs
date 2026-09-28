// Bundles sim-run.ts for the browsers and Node: @angular/core and three's audio as the specs mock them
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = path.join(here, 'angular-shim.ts');
const threeShim = path.join(here, 'three-shim.ts');

export async function bundle(outfile) {
  await build({
    entryPoints: [path.join(here, 'sim-run.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    keepNames: true,
    outfile,
    logLevel: 'warning',
    loader: { '.json': 'json' },
    alias: { '@': path.join(here, '../../src') },
    plugins: [{
      name: 'angular-shim',
      setup(b) {
        b.onResolve({ filter: /^@angular\/core$/ }, (args) => (args.importer === shim ? undefined : { path: shim }));
        b.onResolve({ filter: /^three$/ }, (args) => (args.importer === threeShim ? undefined : { path: threeShim }));
      },
    }],
  });
}
