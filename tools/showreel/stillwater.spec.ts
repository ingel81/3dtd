/**
 * The Stillwater fixtures of the showreel's build-up story (K3, scenes/r4-k3-stages.mjs): F-B0 is the empty map
 * the new-map form makes, each F-B<n> the stage script of scene b<n> played on F-B<n-1>, as the editor agent's
 * run_script plays it. Written to the showreel's data folder (tmp/showreel/fixtures of the main checkout), not
 * into the repo; runs only when asked:
 *   STILLWATER=1 npx vitest run tools/showreel/stillwater.spec.ts          (STILLWATER_TO=<n> stops after F-B<n>)
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCatalog } from '../../src/app/editor/catalog/asset-catalog';
import { runMapScript } from '../../src/app/editor/agent/map-script';
import { createMapDocument } from '../../src/app/world/custom-map/map-create';
import { packMapFile } from '../../src/app/world/custom-map/map-file';
import { erodeJob, runTerrainJob } from '../../src/app/editor/workers/terrain-job';
// @ts-expect-error a plain module of the showreel's scripts
import { NEW_MAP, STAGES } from './scenes/r4-k3-stages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The main checkout's tmp/showreel (worktrees share it) */
function dataDir(): string {
  const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return join(dirname(common), 'tmp/showreel/fixtures');
}

describe.skipIf(!process.env['STILLWATER'])('Stillwater fixtures', () => {
  it('builds F-B0 to F-B9', () => {
    const catalog = normalizeCatalog(JSON.parse(readFileSync(resolve(ROOT, 'public/maps/assets/catalog.json'), 'utf8')), 'http://localhost/maps/assets/');
    const doc = createMapDocument({ id: 'stillwater', name: NEW_MAP.name, width: NEW_MAP.width, depth: NEW_MAP.width, ground: NEW_MAP.ground, baseMaterial: NEW_MAP.material, now: new Date('2026-10-16T00:00:00Z') });
    const out = dataDir();
    mkdirSync(out, { recursive: true });
    const to = Number(process.env['STILLWATER_TO'] ?? STAGES.length - 1);
    const write = (n: number) => {
      const file = join(out, `stillwater-b${n}.3dtdmap`);
      writeFileSync(file, packMapFile(doc));
      return file;
    };
    console.log(write(0));
    for (let n = 1; n <= to && n < STAGES.length; n++) {
      const parts: (string | { erode: number; seed: number })[] = Array.isArray(STAGES[n]) ? STAGES[n] : [STAGES[n]];
      for (const [k, part] of parts.entries()) {
        if (typeof part !== 'string') {
          // The Map panel's Erode the whole map: the editor's terrain job, run here in place
          for (const message of runTerrainJob(erodeJob(doc.terrain.grid, part.erode, part.seed))) void message;
          console.log(`F-B${n}.${k}: eroded, rain ${part.erode}`);
          continue;
        }
        const result = runMapScript(part, doc, catalog, { seed: 100 + n * 10 + k });
        if (!result.ok) throw new Error(`stage ${n}.${k}: ${result.error}`);
        console.log(`F-B${n}.${k}: ${result.commands.length} commands, ${result.ms} ms, ${JSON.stringify(result.value)} ${result.logs.join(' | ')}`);
      }
      console.log(write(n));
    }
    expect(doc.meta.id).toBe('stillwater');
  }, 600_000);
});
