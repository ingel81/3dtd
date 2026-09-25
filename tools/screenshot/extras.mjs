// Two more checks (docs/PLAYTEST.md): T60 "Pause: Off", M5 the pressure loop
// starts again at x1.00 on a new place. Starts its own relay for the coop
// part; screenshots in --dir. (A partner's ring on hover, T51, is left to the
// eye: host and guest cameras do not line up reliably enough to find the
// tower on the other screen.)
//
//   node extras.mjs [--dir ../../tmp/checks] [--only pause,m5]
import { mkdirSync } from 'node:fs';
import { args, checker, coopRoom, devAction, gameReady, launch, openGame, startRelay, waveButton } from './lib.mjs';

const opts = args();
const dir = opts.dir ?? '../../tmp/checks';
const only = new Set(String(opts.only ?? 'pause,m5').split(','));
mkdirSync(dir, { recursive: true });
const { check, results } = checker();
const pausePressed = (page) => page.locator('.pause-btn').getAttribute('aria-pressed');

if (only.has('pause')) {
  const relay = await startRelay({ cheats: true });
  try {
    if (only.has('pause')) {
      // T60: with pause off nobody pauses, the host neither
      const room = await coopRoom({ options: { Pause: 'Off' }, start: true });
      const [host, guest] = [room.host.page, room.guests[0].page];
      await host.waitForTimeout(2000);
      for (const [who, page] of [['host', host], ['guest', guest]]) {
        check(`T60 off: ${who}'s pause locked`, (await page.locator('.pause-btn').getAttribute('aria-disabled')) === 'true');
        await page.locator('.pause-btn').click({ force: true });
        await page.keyboard.press('p');
        await page.waitForTimeout(1500);
        check(`T60 off: ${who} does not pause`, (await pausePressed(host)) === 'false' && (await pausePressed(guest)) === 'false');
      }
      await room.close();
    }

  } finally {
    await relay.stop();
  }
}

if (only.has('m5')) {
  // M5: four waves with nothing lost open the pressure loop; a new place starts it again at x1.00
  const browser = await launch(0);
  const page = await openGame(browser);
  const why = async () => {
    const text = await page.locator('body').innerText();
    return text.match(/Pressure loop[^\n]*/)?.[0] ?? '';
  };
  await devAction(page, 'Wave spawner');
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  const playWave = async () => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(2500);
    for (let k = 0; k < 40 && /left/i.test(await waveButton(page).innerText()); k++) {
      await devAction(page, 'Kill all enemies');
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(1500);
  };
  // Four warm-up waves the loop does not count (PRESSURE_WARMUP_WAVES), then three it needs (PRESSURE_MIN_SAMPLES)
  for (let wave = 1; wave <= 7; wave++) await playWave();
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  const opened = await why();
  check('M5 the loop moved after seven clean waves', /opened to ×1\.[0-9]*[1-9]/.test(opened) || /×(?!1\.00)\d\.\d\d/.test(opened), opened);
  await page.screenshot({ path: `${dir}/m5-before.png` });
  await devAction(page, 'Kill all enemies');
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'Random location' }).click();
  await page.waitForTimeout(3000);
  await gameReady(page);
  await page.waitForTimeout(3000);
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);
  const fresh = await why();
  check('M5 a new place starts again at ×1.00', /×1\.00/.test(fresh) && /collecting \(0 of/.test(fresh), fresh);
  await page.screenshot({ path: `${dir}/m5-after.png` });
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exitCode = failed.length ? 1 : 0;
