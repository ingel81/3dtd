// The room options at work (docs/PLAYTEST.md T59 to T61): cheats by rule,
// pause by rule, how the next wave starts. Starts its own relay (none may run
// on 3003), plays two rooms and a lobby, prints OK/FAIL per check and leaves
// screenshots in --dir (default ../../tmp/checks).
//
//   node coop-rules.mjs [--dir ../../tmp/checks]
import { mkdirSync } from 'node:fs';
import { args, checker, coopRoom, credits, devAction, launch, openGame, startRelay, waveButton } from './lib.mjs';

const opts = args();
const dir = opts.dir ?? '../../tmp/checks';
mkdirSync(dir, { recursive: true });
const { check, results } = checker();
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });
const pausePressed = (page) => page.locator('.pause-btn').getAttribute('aria-pressed');
const squadCredits = (page, name) =>
  page.locator('app-coop-squad .sq', { hasText: name }).locator('.credits').innerText().then((t) => Number(t.replace(/[^0-9]/g, '')));

let relay = await startRelay({ cheats: true });
try {
  // Room A: cheats for the host only, the host starts the waves, pause for the host (default)
  const a = await coopRoom({ options: { Cheats: 'Host only', 'Next wave': 'Host starts' }, start: true });
  const [host, guest] = [a.host.page, a.guests[0].page];
  await host.waitForTimeout(3000);

  // T59: the host's cheat acts on both, the guest's on none
  check('T59 CHEATS ON in the squad', await host.locator('app-coop-squad .chip', { hasText: 'CHEATS ON' }).isVisible());
  const hostBefore = await credits(host);
  await devAction(host, /Add 1000 credits/);
  await host.waitForTimeout(1500);
  check('T59 host cheat, host', (await credits(host)) === hostBefore + 1000, `${hostBefore} -> ${await credits(host)}`);
  check('T59 host cheat, seen by the guest', (await squadCredits(guest, 'Ann')) === hostBefore + 1000, `${await squadCredits(guest, 'Ann')}`);
  const guestBefore = await credits(guest);
  await devAction(guest, /Add 1000 credits/).catch(() => undefined);
  await guest.waitForTimeout(1500);
  check('T59 guest cheat does nothing', (await credits(guest)) === guestBefore, `${guestBefore} -> ${await credits(guest)}`);
  check('T59 guest cheat not at the host either', (await squadCredits(host, 'Bob')) === guestBefore);
  await shot(host, 't59-host');

  // T60: pause for the host only
  check('T60 guest pause locked', (await guest.locator('.pause-btn').getAttribute('aria-disabled')) === 'true');
  await guest.locator('.pause-btn').click({ force: true });
  await guest.waitForTimeout(1500);
  check('T60 guest pause does nothing', (await pausePressed(host)) === 'false');
  await host.locator('.pause-btn').click();
  await host.waitForTimeout(1500);
  check('T60 host pause stops both', (await pausePressed(guest)) === 'true');
  await host.locator('.pause-btn').click();
  await host.waitForTimeout(1500);

  // T61: the host's button starts the wave, the guest's says ready
  check('T61 host button starts', /Start wave 1/i.test(await waveButton(host).innerText()), await waveButton(host).innerText());
  check('T61 guest button readies', /Ready for wave 1/i.test(await waveButton(guest).innerText()), await waveButton(guest).innerText());
  await shot(host, 't61-host-starts');
  await waveButton(host).click();
  await host.waitForTimeout(3000);
  check('T61 the wave runs', /left/i.test(await waveButton(guest).innerText()), await waveButton(guest).innerText());
  await a.close();

  // Room B: anyone may pause, the next wave comes by itself after 10 s
  const b = await coopRoom({ options: { Cheats: 'Host only', Pause: 'Anyone', 'Next wave': 'Auto 10 s' }, start: true });
  const [bHost, bGuest] = [b.host.page, b.guests[0].page];
  await bHost.waitForTimeout(3000);
  await bGuest.locator('.pause-btn').click();
  await bGuest.waitForTimeout(1500);
  check('T60 anyone: the guest pauses both', (await pausePressed(bHost)) === 'true');
  await bGuest.locator('.pause-btn').click();
  await bGuest.waitForTimeout(1500);
  check('T60 anyone: the guest resumes', (await pausePressed(bHost)) === 'false');

  // Wave 1 once both are ready, then kill it off; the next counts down by itself
  await bHost.keyboard.press('Space');
  await bGuest.keyboard.press('Space');
  await bHost.waitForTimeout(3000);
  check('T61 all ready starts wave 1', /left/i.test(await waveButton(bHost).innerText()), await waveButton(bHost).innerText());
  for (let i = 0; i < 40 && /left/i.test(await waveButton(bHost).innerText()); i++) {
    await devAction(bHost, 'Kill all enemies');
    await bHost.waitForTimeout(1500);
  }
  await bHost.waitForTimeout(2000);
  const counting = await waveButton(bGuest).innerText();
  check('T61 auto: the guest counts down', /\d+\s*s/.test(counting), counting);
  await shot(bGuest, 't61-auto-guest');
  await bHost.waitForTimeout(12_000);
  check('T61 auto: wave 2 starts by itself', /Wave 2/i.test(await waveButton(bGuest).innerText()) && /left/i.test(await waveButton(bGuest).innerText()),
    await waveButton(bGuest).innerText());
  await b.close();
} finally {
  await relay.stop();
}

// A relay without cheats: the cheat choices of the room are off
relay = await startRelay({ cheats: false });
try {
  const browser = await launch(0);
  const page = await openGame(browser);
  await page.getByRole('button', { name: 'Coop: play one map together' }).click();
  await page.getByRole('button', { name: 'Open room' }).click();
  await page.locator('app-coop-dock .code b').waitFor({ timeout: 60_000 });
  const group = page.locator('app-coop-dock').getByRole('radiogroup', { name: 'Cheats' });
  check('T59 --no-cheats: Host only off', await group.getByRole('radio', { name: 'Host only' }).isDisabled());
  check('T59 --no-cheats: Everyone off', await group.getByRole('radio', { name: 'Everyone' }).isDisabled());
  await shot(page, 't59-no-cheats');
  await browser.close();
} finally {
  await relay.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exitCode = failed.length ? 1 : 0;
