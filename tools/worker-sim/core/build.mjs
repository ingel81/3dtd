// The heavy-tick lab (tools/worker-sim/core): the real SimCore, no shim.  node tools/worker-sim/core/build.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
await build({
  entryPoints: [join(ROOT, 'page.ts'), join(ROOT, 'worker.ts')], outdir: join(ROOT, 'dist'), bundle: true, splitting: true,
  format: 'esm', target: 'es2022', sourcemap: true, tsconfig: join(ROOT, '../../../tsconfig.app.json'), logLevel: 'warning',
});
