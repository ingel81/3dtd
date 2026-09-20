/**
 * Writes `public/build-info.json` with the commit the build comes from.
 *
 * Runs before `npm run build` and `npm start`. The run log puts the commit in
 * its head, so a batch of runs can be tied to the code that produced it
 * (docs/RUN_LOG.md). Without git (a source zip, a CI without history) it
 * writes `unknown`, which the head then carries as it is.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = git(['status', '--porcelain']).length > 0;

mkdirSync('public', { recursive: true });
writeFileSync(
  'public/build-info.json',
  `${JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);
console.log(`build-info.json: ${commit}${dirty ? '-dirty' : ''}`);
