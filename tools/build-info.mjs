/**
 * Writes `public/build-info.json` with the commit the build comes from.
 *
 * Runs before `npm run build` and `npm start`. The run log puts the commit in
 * its head, so a batch of runs can be tied to the code that produced it
 * (docs/RUN_LOG.md). Without git (a source zip, a CI without history) it
 * writes `unknown`, which the head then carries as it is.
 *
 * `--serve` keeps it honest while `ng serve` runs: written once the file ages
 * with every commit and every edit, and a dev-server session lasts hours. Bot
 * runs then claim a commit the code has long left behind, which is exactly the
 * case the field exists to rule out. So this mode rewrites the file whenever
 * HEAD or the working tree changes, and starts `ng serve` as its child, which
 * keeps it to one process tree on every platform.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'public/build-info.json';
/** Often enough to catch a commit, rare enough to cost nothing. */
const POLL_MS = 4000;

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function current() {
  const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
  const dirty = git(['status', '--porcelain']).length > 0;
  return { commit, dirty };
}

/**
 * Writes only when something changed: the dev server watches this file, and a
 * rewrite reloads every open tab, bot tabs included.
 *
 * @returns true when the file was written
 */
function write({ quiet = false } = {}) {
  const { commit, dirty } = current();
  const next = `${JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() }, null, 2)}\n`;

  let previous = null;
  try {
    previous = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    // no file yet, or not readable: write it
  }
  if (previous && previous.commit === commit && previous.dirty === dirty) return false;

  mkdirSync('public', { recursive: true });
  writeFileSync(OUT, next, 'utf8');
  if (!quiet) console.log(`build-info.json: ${commit}${dirty ? '-dirty' : ''}`);
  return true;
}

const serve = process.argv.includes('--serve');
const watch = serve || process.argv.includes('--watch');

// Force the first write, so a stale file from an earlier session cannot survive
// a start that happens to sit on the same commit.
try {
  writeFileSync(OUT, '', 'utf8');
} catch {
  // the write below creates it
}
write();

if (watch) {
  const timer = setInterval(() => {
    if (write({ quiet: false })) console.log('build-info.json: repo moved, rewritten');
  }, POLL_MS);
  timer.unref?.();
}

if (serve) {
  const args = ['serve', ...process.argv.slice(2).filter((a) => a !== '--serve' && a !== '--watch')];
  const ng = spawn(process.platform === 'win32' ? 'ng.cmd' : 'ng', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  ng.on('exit', (code) => process.exit(code ?? 0));
}
