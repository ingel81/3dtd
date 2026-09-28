// The budget wave source on a real map (docs/WAVE_RUN_PLAN.md): one player, one map session. The source plans
// against the defense with the towers' real lines of sight over the tiles: after a tower stands, the next wave's
// plan must see damage under fire, and the HP it sets must come out of the budget, not a fallback.
import { test, expect } from '@playwright/test';
import { openGame } from '../support/game';

type Probe = {
  source: string | null;
  plan: { wave: number; name: string | null; diagnostics: Record<string, unknown> } | null;
  damageMetres: number;
  towers: number;
};

const probe = (page: import('@playwright/test').Page) => page.evaluate((): Probe => {
  const w = window as unknown as { ng: { getComponent(el: Element | null): Record<string, never> } };
  const comp = w.ng.getComponent(document.querySelector('app-tower-defense')) as unknown as {
    facade: { waveDirector: { source: { id: string }; committed: { wave: number; config: { templateName?: string }; log: { diagnostics?: Record<string, unknown> } } | null; stateSnapshots: { lastSnapshot(): { defense: { damageMetres?: { ground: Record<string, number> } } } | null } } };
    gameState: { towerManager: { getAll(): unknown[] } };
  };
  const director = comp.facade.waveDirector;
  const plan = director.committed;
  const snapshot = director.stateSnapshots.lastSnapshot();
  return {
    source: director.source?.id ?? null,
    plan: plan ? { wave: plan.wave, name: plan.config.templateName ?? null, diagnostics: plan.log.diagnostics ?? {} } : null,
    damageMetres: Object.values(snapshot?.defense.damageMetres?.ground ?? {}).reduce((a, b) => a + b, 0),
    towers: comp.gameState.towerManager.getAll().length,
  };
});

test('the budget source plans against the real lines of sight', async ({ browser }) => {
  const page = await openGame(browser, { query: '&waves=budget' });
  // The address keeps the switch while the game writes the place into it
  expect(page.url()).toContain('waves=budget');

  await test.step('build towers along the route through the command path', async () => {
    await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): Record<string, never> } };
      const gs = (w.ng.getComponent(document.querySelector('app-tower-defense')) as unknown as {
        gameState: { getEventBus(): { emit(e: Record<string, unknown>): void }; getCachedPaths(): Map<string, { lat: number; lon: number; height?: number }[]> };
      }).gameState;
      const bus = gs.getEventBus();
      bus.emit({ type: 'debug:add-credits', amount: 5000 });
      const path = [...gs.getCachedPaths().values()][0];
      // Beside the route at a few points along it: some will fit, the rest the game refuses
      for (const f of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const p = path[Math.floor(path.length * f)];
        for (const [dLat, dLon] of [[0.00012, 0], [-0.00012, 0], [0, 0.00016], [0, -0.00016]]) {
          bus.emit({ type: 'command:place-tower', typeId: 'archer', position: { lat: p.lat + dLat, lon: p.lon + dLon, height: p.height ?? 0 } });
        }
      }
    });
    await expect.poll(async () => (await probe(page)).towers, { timeout: 30_000 }).toBeGreaterThan(2);
  });

  await test.step('wave 1 runs, the plan for wave 2 sees damage under fire', async () => {
    await page.keyboard.press('Space');
    await expect.poll(async () => (await probe(page)).plan?.wave ?? 0, { timeout: 5 * 60_000 }).toBeGreaterThanOrEqual(2);
    const after = await probe(page);
    expect(after.source).toBe('budget');
    expect(after.damageMetres, 'damage under fire, measured on the route with the towers\' lines of sight').toBeGreaterThan(0);
    expect(after.plan?.diagnostics['budget']).toBeGreaterThan(0);
    expect(after.plan?.diagnostics['unhurt'] ?? null).toBeNull();
    console.log(`wave ${after.plan?.wave} ${after.plan?.name}: ${JSON.stringify(after.plan?.diagnostics)}, damage metres ${Math.round(after.damageMetres)}`);
  });
  await page.close();
});
