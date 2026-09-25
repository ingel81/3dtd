// The looks of the coop UI after round 3 (docs/PLAYTEST.md T47, T50, T54,
// T56, T58, T62, T63): what can be read off the page is checked, the rest is
// in screenshots in --dir (default ../../tmp/checks). Starts its own relay.
//
//   node coop-look.mjs [--dir ../../tmp/checks]
import { mkdirSync } from 'node:fs';
import { args, checker, coopRoom, GAME_URL, DEFAULT_PLACE, launch, openGame, startRelay } from './lib.mjs';

const opts = args();
const dir = opts.dir ?? '../../tmp/checks';
mkdirSync(dir, { recursive: true });
const { check, results } = checker();
const shot = (page, name, clip) => page.screenshot({ path: `${dir}/${name}.png`, ...(clip ? { clip } : {}) });

const relay = await startRelay({ cheats: true });
try {
  // T54: the entry dock, no scrolling sideways
  const solo = await launch(0);
  const entry = await openGame(solo);
  await entry.getByRole('button', { name: 'Coop: play one map together' }).click();
  await entry.locator('app-coop-dock').waitFor();
  const sideways = await entry.locator('app-coop-dock .body').evaluate((el) => el.scrollWidth - el.clientWidth);
  check('T54 entry dock does not scroll sideways', sideways <= 0, `overflow ${sideways}px`);
  // T63: the header's coop button keeps no focus after a click
  const focused = await entry.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
  check('T63 no focus left on the coop button', !/coop/i.test(focused ?? ''), `focus on ${focused}`);
  await shot(entry, 't54-entry');
  await solo.close();

  // A room with two players, in the lobby
  const room = await coopRoom();
  const [host, guest] = [room.host.page, room.guests[0].page];
  // T56: the own name reads as a field
  check('T56 own name is a field', await host.locator('app-coop-dock .name-edit input').isVisible());
  // T58: the host sees the options open, the guest a button to show them
  check('T58 options open for the host', await host.locator('app-coop-dock .sets').isVisible());
  const guestToggle = await guest.locator('app-coop-dock .toggle-label').innerText();
  check('T58 guest has a visible toggle', /show all/i.test(guestToggle), guestToggle);
  await shot(host, 't56-t58-lobby-host');
  await shot(guest, 't58-lobby-guest');

  // T62 and T50 in the game
  await host.getByRole('button', { name: 'Start match' }).click();
  await host.locator('app-coop-squad .squad').waitFor({ timeout: 60_000 });
  await guest.locator('app-coop-squad .squad').waitFor({ timeout: 60_000 });
  await guest.waitForTimeout(2000);
  const footer = await guest.locator('app-coop-squad .sq-foot').innerText();
  check('T62 footer says what to do', /ready up for the next wave/i.test(footer) && !/waiting for you/i.test(footer), footer.replace(/\s+/g, ' '));
  await guest.keyboard.press('x');
  await guest.waitForTimeout(800);
  const armed = guest.locator('app-coop-chat .armed');
  check('T50 armed hint shows', await armed.isVisible());
  const box = await guest.locator('app-coop-squad').boundingBox();
  await shot(guest, 't50-t62-guest-bottom-left', box ? { x: 0, y: Math.max(0, box.y - 10), width: 700, height: box.height + 20 } : undefined);
  await guest.keyboard.press('Escape');
  await room.close();

  // T47: an invite link with &nokey in a fresh browser: the token screen with the room's sentence
  const stranger = await launch(1);
  const page = await (await stranger.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await page.goto(`${GAME_URL}/?l=${DEFAULT_PLACE}&room=ABC123&nokey`);
  const lead = page.locator('.token-coop');
  await lead.waitFor({ timeout: 60_000 }).catch(() => undefined);
  const text = (await lead.count()) ? await lead.innerText() : '';
  check('T47 token screen names the room', /ABC123/.test(text), text.slice(0, 80));
  await shot(page, 't47-nokey');
  await stranger.close();
} finally {
  await relay.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exitCode = failed.length ? 1 : 0;
