// One recording on the real display at a time, the others' heavy work held meanwhile (several workers prepare
// their scenes and rehearse headless; a recording beside a build or a test run stutters). A recording on the
// display (run.mjs --record) queues in tmp/showreel/record-queue/ (one file per request, first come, first
// served) and holds tmp/showreel/record.lock (pid, scene, start) while it records; a lock or ticket whose process
// is gone is removed. Headless takes, rehearsals and fixtures wait while the lock is held (between scenes when
// they run already); other heavy work calls --wait first.
//
//   node tools/showreel/quiet.mjs --wait      returns once no recording runs (before probes, vitest, builds)
//   node tools/showreel/quiet.mjs --status    who records, who waits
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA } from './browser.mjs';

export const LOCK = join(DATA, 'record.lock');
export const QUEUE = join(DATA, 'record-queue');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const read = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The lock's holder, null when none records (a lock whose process is gone is removed) */
export function holder() {
  if (!existsSync(LOCK)) return null;
  const held = read(LOCK);
  if (held && alive(held.pid)) return held;
  rmSync(LOCK, { force: true });
  return null;
}

/** The waiting tickets in their order; a ticket whose process is gone is removed */
function tickets() {
  if (!existsSync(QUEUE)) return [];
  return readdirSync(QUEUE)
    .sort()
    .filter((name) => {
      const t = read(join(QUEUE, name));
      if (t && alive(t.pid)) return true;
      rmSync(join(QUEUE, name), { force: true });
      return false;
    });
}

/**
 * Until no recording runs: heavy work (a headless take or rehearsal, fixtures, vitest, a build) waits here, and
 * a rehearsal already running asks between its scenes. The process holding the lock itself never waits.
 */
export async function waitQuiet(what = 'this run') {
  let told = false;
  for (let held = holder(); held && held.pid !== process.pid; held = holder()) {
    if (!told) console.log(`a recording runs (${held.scene}, since ${held.since}): ${what} waits`);
    told = true;
    await sleep(5000);
  }
  if (told) console.log(`recording done, ${what} goes on`);
}

/** The display for one recording: waits in the queue, then holds the lock (pid, scene, start) until `release()` */
export async function recordSlot(what) {
  mkdirSync(QUEUE, { recursive: true });
  const ticket = `${Date.now()}-${process.pid}.json`;
  writeFileSync(join(QUEUE, ticket), JSON.stringify({ pid: process.pid, scene: what, since: new Date().toISOString() }));
  let told = false;
  for (;;) {
    if (tickets()[0] === ticket && !holder()) {
      try {
        const fd = openSync(LOCK, 'wx');
        writeFileSync(fd, JSON.stringify({ pid: process.pid, scene: what, since: new Date().toISOString() }));
        closeSync(fd);
        rmSync(join(QUEUE, ticket), { force: true });
        return { release: () => rmSync(LOCK, { force: true }) };
      } catch {
        // another took it between the two looks
      }
    }
    if (!told) {
      const ahead = tickets().indexOf(ticket);
      console.log(`waiting for the display: ${holder()?.scene ?? 'nobody records'}, ${ahead} ahead in the queue`);
      told = true;
    }
    await sleep(2000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--status')) {
    const held = holder();
    console.log(`recording: ${held ? `${held.scene} (pid ${held.pid}, since ${held.since})` : 'none'}`);
    for (const t of tickets()) console.log(`waiting: ${read(join(QUEUE, t))?.scene}`);
  } else if (process.argv.includes('--wait')) {
    await waitQuiet('quiet.mjs --wait');
  } else {
    console.log('--wait or --status');
  }
}
