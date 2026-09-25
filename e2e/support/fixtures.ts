// `test` for the end-to-end tests (docs/E2E.md).
//
// Map sessions are counted by the tile provider for every page that loads
// the tileset (User, 2026-09-25): so the two players, Ann and Bob, are opened
// once per run (worker fixture `duo`) and every test plays with them. A test
// opens its room from the dock, the guest joins by the code without a reload,
// and after the test both leave the room. Only a test that needs a page load
// (an invite link, a new place for the guest) costs a session more.
//
// Each test has a relay of its own (`relay`), started before and stopped
// after, its log in the report.
import { test as base, expect, type Page } from '@playwright/test';
import { openGame, startRelay, tidyUp, type Relay } from './game';

export interface Duo {
  host: Page;
  guest: Page;
}

export const test = base.extend<{ relay: Relay; relayCheats: boolean }, { duo: Duo }>({
  duo: [async ({ browser }, use) => {
    const host = await openGame(browser, { storage: { '3dtd-coop-name': 'Ann' } });
    const guest = await openGame(browser, { storage: { '3dtd-coop-name': 'Bob' } });
    await use({ host, guest });
    await host.context().close();
    await guest.context().close();
  }, { scope: 'worker' }],

  // Override per describe with test.use({ relayCheats: false })
  relayCheats: [true, { option: true }],
  relay: async ({ relayCheats, duo }, use, testInfo) => {
    const relay = await startRelay({ cheats: relayCheats });
    try {
      await use(relay);
    } finally {
      // Out of the room on both sides before the relay goes, the pages tidied up
      for (const page of [duo.host, duo.guest]) await tidyUp(page).catch(() => undefined);
      await relay.stop();
      await testInfo.attach('relay.log', { body: relay.log(), contentType: 'text/plain' });
    }
  },
});

/** The relay log shows no divergence of the simulations */
export function expectNoDesync(relay: Relay): void {
  const lines = relay.log().split('\n').filter((line) => line.includes('DESYNC'));
  expect(lines, 'DESYNC in the relay log').toEqual([]);
}

export { expect };
