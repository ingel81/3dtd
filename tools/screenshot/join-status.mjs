// What the host sees while a guest comes (User, 2026-09-25): the guest opens
// the invite link and joins at once; its row reads "Loading the map…" until
// the map stands there, and the chat says so. Starts its own relay.
//
//   node join-status.mjs [--dir ../../tmp/checks]
import { mkdirSync } from 'node:fs';
import { args, checker, DEFAULT_PLACE, GAME_URL, gameReady, launch, openGame, startRelay } from './lib.mjs';

const opts = args();
const dir = opts.dir ?? '../../tmp/checks';
mkdirSync(dir, { recursive: true });
const { check, results } = checker();

const relay = await startRelay({ cheats: true });
try {
  const hostBrowser = await launch(0);
  const host = await openGame(hostBrowser, { storage: { '3dtd-coop-name': 'Ann' } });
  await host.getByRole('button', { name: 'Coop: play one map together' }).click();
  await host.getByRole('button', { name: 'Open room' }).click();
  const code = (await host.locator('app-coop-dock .code b').innerText({ timeout: 60_000 })).trim();

  // The guest opens the invite link and is not waited for
  const guestBrowser = await launch(1);
  const context = await guestBrowser.newContext({ viewport: { width: 1600, height: 900 } });
  const guest = await context.newPage();
  await guest.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('3dtd-coop-name', 'Bob');
  });
  await guest.goto(`${GAME_URL}/?l=${DEFAULT_PLACE}&room=${code}`);

  const row = host.locator('app-coop-dock .pl', { hasText: 'Bob' });
  await row.waitFor({ timeout: 60_000 });
  const doing = await row.locator('.doing').innerText({ timeout: 10_000 }).catch(() => '');
  check('host sees the guest loading', /loading the map/i.test(doing), doing || 'no status');
  await host.screenshot({ path: `${dir}/join-status-loading.png` });

  await gameReady(guest);
  await host.waitForFunction(() => /map stands/.test(document.querySelector('app-coop-dock .chat')?.textContent ?? ''), null, { timeout: 60_000 })
    .catch(() => undefined);
  const chat = await host.locator('app-coop-dock .chat').innerText();
  check('host chat: joined, loading, stands', /Bob joined/.test(chat) && /Bob is loading the map/.test(chat) && /Bob's map stands/.test(chat),
    chat.replace(/\s+/g, ' ').slice(0, 160));
  await host.screenshot({ path: `${dir}/join-status-ready.png` });
  await guestBrowser.close();
  await hostBrowser.close();
} finally {
  await relay.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exitCode = failed.length ? 1 : 0;
