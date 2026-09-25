// The coop dock of a room with two players (docs/COOP_PLAN.md, C8): the host
// opens a room, a guest joins by the invite link, a few chat lines, the guest
// is ready; then a screenshot of the host's window. Needs npm start and the
// relay (npm run coop-server).
//
//   node coop-dock.mjs --out ../../tmp/coop-dock.png [--place 48.7758,9.1829] [--guest-shot file.png]
import { args, launch, openGame } from './lib.mjs';

const opts = args();
const out = opts.out ?? 'coop-dock.png';
const place = opts.place;

const browser = await launch();
try {
  const host = await openGame(browser, { place, storage: { '3dtd-coop-name': 'Ann' } });
  await host.getByRole('button', { name: 'Coop: play one map together' }).click();
  await host.getByRole('button', { name: 'Open room' }).click();
  const code = (await host.locator('app-coop-dock .code b').innerText({ timeout: 60_000 })).trim();
  console.log('room', code);

  const guest = await openGame(browser, {
    place,
    query: `&room=${code}`,
    viewport: { width: 1600, height: 900 },
    storage: { '3dtd-coop-name': 'Bob' },
  });
  await host.waitForFunction(() => document.querySelectorAll('app-coop-dock .pl').length >= 2, null, { timeout: 120_000 });

  const say = async (page, text) => {
    const input = page.locator('app-coop-dock .composer input');
    await input.fill(text);
    await input.press('Enter');
    await page.waitForTimeout(400);
  };
  await say(host, 'hi Bob!');
  await say(guest, 'hey, which side do you want?');
  await say(host, 'I keep the long one, you get the short one');
  await say(guest, 'deal');
  await guest.getByRole('button', { name: 'Ready up' }).click({ timeout: 10_000 }).catch(() => console.log('guest: no Ready up'));
  await host.waitForTimeout(2500);

  await host.screenshot({ path: out });
  console.log('host shot', out);
  if (opts['guest-shot']) {
    await guest.screenshot({ path: opts['guest-shot'] });
    console.log('guest shot', opts['guest-shot']);
  }
} finally {
  await browser.close();
}
