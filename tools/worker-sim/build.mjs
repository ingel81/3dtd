// Bundles the worker lab (docs/WORKER_PLAN.md, stage 1) into dist/: page.js, worker.js and the lab as a
// shared chunk. '@angular/core' goes to angular-shim.ts, as the specs mock it.
//   node tools/worker-sim/build.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SHIM = join(ROOT, 'angular-shim.ts');

rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [join(ROOT, 'page.ts'), join(ROOT, 'worker.ts')],
  outdir: join(ROOT, 'dist'),
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  tsconfig: join(ROOT, '../../tsconfig.app.json'),
  logLevel: 'info',
  plugins: [{
    name: 'angular-shim',
    setup(b) {
      b.onResolve({ filter: /^@angular\/core$/ }, (args) => (args.importer === SHIM ? undefined : { path: SHIM }));
    },
  }],
});
