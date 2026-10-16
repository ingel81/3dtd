// One recording on the real display at a time, the others' heavy work held meanwhile (several workers prepare
// their scenes and rehearse headless; a recording beside a build or a test run stutters). A take on a display
// queues in tmp/showreel/record-queue/ (first come, first served) and holds tmp/showreel/record.lock while it
// records. Headless takes and rehearsals do not queue.
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

/** The display for one recording: waits in the queue, then holds the lock until `release()` */
export async function recordSlot(what) {
  mkdirSync(QUEUE, { recursive: true });
  const ticket = `${Date.now()}-${process.pid}.json`;
  writeFileSync(join(QUEUE, ticket), JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() }));
  let told = false;
  for (;;) {
    if (tickets()[0] === ticket && !holder()) {
      try {
        const fd = openSync(LOCK, 'wx');
        writeFileSync(fd, JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() }));
        closeSync(fd);
        rmSync(join(QUEUE, ticket), { force: true });
        return { release: () => rmSync(LOCK, { force: true }) };
      } catch {
        // another took it between the two looks
      }
    }
    if (!told) {
      console.log(`waiting for the display: ${holder()?.what ?? 'the queue'} first`);
      told = true;
    }
    await sleep(2000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--status')) {
    console.log(`recording: ${holder()?.what ?? 'none'}`);
    for (const t of tickets()) console.log(`waiting: ${read(join(QUEUE, t))?.what}`);
  } else if (process.argv.includes('--wait')) {
    let told = false;
    while (holder()) {
      if (!told) console.log(`a recording runs (${holder()?.what}), waiting`);
      told = true;
      await sleep(5000);
    }
  } else {
    console.log('--wait or --status');
  }
}
