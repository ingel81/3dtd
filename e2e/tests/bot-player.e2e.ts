// The human-like bot in DevWorld (docs/BOT_PLAYER_PLAN.md), no map session: the
// expert bot plays a few waves among dense buildings. B1: its perception of the
// waves fills and adds up. B2: before it builds it looks at the line of sight of
// a few spots and takes one that sees the route; each choice is logged next to
// the spot the score alone would have picked. B3: the arbiter decides; every
// decision is logged, and the bot builds a mix, upgrades and holds.
import { test, expect, type Page } from '@playwright/test';
import { gameReady, shot } from '../support/game';

/** Waves the bot plays before the checks */
const WAVES = 12;

interface SightChoice { typeId: string; old: number; chosen: number; ms: number; probed: number }
interface Seen {
  waveNumber: number;
  waves: { wave: number; kills: number; leaks: number; deaths: number; routes: number }[];
  towers: { id: string; type: string; record: { firstWave: number; waves: { kills: number; damage: number }[] } | null }[];
  leaking: { routeId: string; leaks: number; thinFrom: number }[];
  ahead: { wave: number; air: boolean; boss: boolean; armors: string[] }[];
}

interface Decision { wave: number; type: string; reason: string; credits: number }

type Comp = {
  store: { waveNumber(): number; phase(): string; baseHealth(): number; credits(): number };
  botClient: {
    botAutoMode: { set(v: boolean): void };
    enableBot(level: string): void;
    session: { currentBot: { update(state: { player: { credits: number } }, dt: number): { type: string; reason?: string } | null } | null; world: {
      perception: {
        waves: { wave: number; kills: number; leaks: number; routes: Map<string, { deaths: number[]; leaks: number }> }[];
        tower(id: string): Seen['towers'][number]['record'];
        leakingRoutes(): Seen['leaking'];
      };
      peekWaves(from: number, count: number): Seen['ahead'];
      towerManager: { getAll(): { id: string; typeConfig: { id: string } }[] };
    } } | null;
    deps: { strategicPlacement: Record<string, unknown> } | null;
  };
};

async function openDevWorld(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
  });
  await page.goto('/?devworld&buildings=dense&bot=manual');
  await gameReady(page);
}

test('the bot reads the waves and builds where it sees the route', async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  await openDevWorld(page);

  await test.step('log every choice of spot, then let the expert bot play', async () => {
    await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): unknown }; __sight: SightChoice[]; __load: { speed(v: number): void } };
      const comp = w.ng.getComponent(document.querySelector('app-tower-defense')) as Comp;
      const placement = comp.botClient.deps!.strategicPlacement as {
        bySight(standing: { candidate: { position: { lat: number; lon: number }; reason: string } }[], typeId: string):
          { position: { lat: number; lon: number }; reason: string }[] | null;
      };
      const share = (reason: string) => Number(/sees (\d+)%/.exec(reason)?.[1] ?? NaN);
      const bySight = placement.bySight.bind(placement);
      w.__sight = [];
      placement.bySight = (standing, typeId) => {
        const t0 = performance.now();
        const out = bySight(standing, typeId);
        const ms = performance.now() - t0;
        if (out) {
          const first = standing[0].candidate.position;
          const old = out.find((c) => c.position.lat === first.lat && c.position.lon === first.lon)!;
          w.__sight.push({ typeId, old: share(old.reason), chosen: share(out[0].reason), ms, probed: standing.length });
        }
        return out;
      };
      comp.botClient.botAutoMode.set(true);
      comp.botClient.enableBot('expert');
      w.__load.speed(4);
    });
    // The session loads as a chunk of its own: log its bot's decisions once it is there
    await expect.poll(() => page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): unknown }; __decisions?: Decision[] };
      const comp = w.ng.getComponent(document.querySelector('app-tower-defense')) as Comp;
      const bot = comp.botClient.session?.currentBot;
      if (!bot) return false;
      if (w.__decisions) return true;
      w.__decisions = [];
      const update = bot.update.bind(bot);
      bot.update = (state, dt) => {
        const action = update(state, dt);
        if (action) {
          w.__decisions!.push({ wave: comp.store.waveNumber(), type: action.type, reason: action.reason ?? '', credits: state.player.credits });
        }
        return action;
      };
      return true;
    }), { timeout: 30_000 }).toBe(true);
  });

  await test.step(`the bot plays to wave ${WAVES + 1}`, async () => {
    await expect.poll(
      () => page.evaluate(() => {
        const comp = (window as unknown as { ng: { getComponent(el: Element | null): unknown } }).ng
          .getComponent(document.querySelector('app-tower-defense')) as Comp;
        return comp.store.waveNumber();
      }),
      { timeout: 15 * 60_000, intervals: [5000] },
    ).toBeGreaterThan(WAVES);
    await shot(testInfo, page, 'bot-defense');
  });

  const sight = await page.evaluate(() => (window as unknown as { __sight: SightChoice[] }).__sight);
  const decisions = await page.evaluate(() => (window as unknown as { __decisions: Decision[] }).__decisions);
  const hq = await page.evaluate(() => {
    const comp = (window as unknown as { ng: { getComponent(el: Element | null): unknown } }).ng
      .getComponent(document.querySelector('app-tower-defense')) as Comp;
    return { health: comp.store.baseHealth(), credits: comp.store.credits() };
  });
  const seen = await page.evaluate((): Seen => {
    const comp = (window as unknown as { ng: { getComponent(el: Element | null): unknown } }).ng
      .getComponent(document.querySelector('app-tower-defense')) as Comp;
    const world = comp.botClient.session!.world;
    const p = world.perception;
    return {
      waveNumber: comp.store.waveNumber(),
      waves: p.waves.map((w) => ({
        wave: w.wave, kills: w.kills, leaks: w.leaks, routes: w.routes.size,
        deaths: [...w.routes.values()].reduce((sum, r) => sum + r.deaths.reduce((a, b) => a + b, 0), 0),
      })),
      towers: world.towerManager.getAll().map((t) => ({ id: t.id, type: t.typeConfig.id, record: p.tower(t.id) })),
      leaking: p.leakingRoutes(),
      ahead: world.peekWaves(comp.store.waveNumber() + 1, 2)
        .map((w) => ({ wave: w.wave, air: w.air, boss: w.boss, armors: [...w.armors] })),
    };
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const report = {
    choices: sight.length,
    meanOld: mean(sight.map((s) => s.old)),
    meanChosen: mean(sight.map((s) => s.chosen)),
    moved: sight.filter((s) => s.chosen !== s.old).length,
    maxMs: Math.max(0, ...sight.map((s) => s.ms)),
    meanMs: mean(sight.map((s) => s.ms)),
    hq,
    actions: decisions.filter((d) => d.type !== 'wait').reduce<Record<string, number>>((counts, d) => {
      counts[d.type] = (counts[d.type] ?? 0) + 1;
      return counts;
    }, {}),
    waits: decisions.filter((d) => d.type === 'wait').reduce<Record<string, number>>((counts, d) => {
      const why = d.reason.replace(/ \(.*$/, '');
      counts[why] = (counts[why] ?? 0) + 1;
      return counts;
    }, {}),
    builtTypes: [...new Set(seen.towers.map((t) => t.type))],
    seen,
  };
  for (const d of decisions.filter((d) => d.type !== 'wait')) console.log(`  W${d.wave} ${d.type} ${Math.floor(d.credits)}: ${d.reason}`);
  console.log(`bot-player: ${JSON.stringify({ ...report, seen: {
    waveNumber: seen.waveNumber, waves: seen.waves, leaking: seen.leaking, ahead: seen.ahead,
    towers: seen.towers.length, recorded: seen.towers.filter((t) => t.record !== null).length,
  } })}`);
  await testInfo.attach('bot-player.json', { body: JSON.stringify({ report, sight, decisions }, null, 1), contentType: 'application/json' });

  await test.step('B1: the perception holds the last waves, and the kills add up', async () => {
    expect(seen.waves.length).toBe(3);
    expect(seen.waves.at(-1)!.wave).toBeGreaterThanOrEqual(WAVES);
    for (const wave of seen.waves) {
      expect(wave.kills, `wave ${wave.wave} killed`).toBeGreaterThan(0);
      expect(wave.deaths, `the kills of wave ${wave.wave} lie on its routes`).toBe(wave.kills);
      expect(wave.routes).toBeGreaterThan(0);
    }
    const fighting = seen.towers.filter((t) => t.type !== 'research-center' && t.type !== 'missile-silo');
    expect(fighting.length).toBeGreaterThan(3);
    // Towers that stood at the last wave's end have a record of it; one built since has none yet
    const recorded = seen.towers.filter((t) => t.record !== null);
    expect(recorded.length).toBeGreaterThan(3);
    expect(recorded.every((t) => t.record!.waves.length > 0)).toBe(true);
    expect(seen.ahead).toHaveLength(2);
    expect(seen.ahead[0].wave).toBe(seen.waveNumber + 1);
  });

  await test.step('B2: the bot looked at spots, and what it chose sees at least as much as the best by score', async () => {
    expect(sight.length, 'choices with a line of sight').toBeGreaterThan(3);
    expect(sight.every((s) => s.probed >= 1 && s.probed <= 4)).toBe(true);
    expect(report.meanChosen).toBeGreaterThanOrEqual(report.meanOld);
  });

  await test.step('B3: the arbiter builds a mix, upgrades, researches and holds', async () => {
    expect(report.actions['place'] ?? 0).toBeGreaterThan(3);
    expect(report.actions['upgrade'] ?? 0).toBeGreaterThan(0);
    expect(report.actions['research-start'] ?? 0).toBeGreaterThan(0);
    expect(report.actions['start-wave'] ?? 0).toBeGreaterThanOrEqual(WAVES);
    const combatTypes = report.builtTypes.filter((t) => t !== 'research-center' && t !== 'missile-silo');
    expect(combatTypes.length, `tower types: ${combatTypes.join(', ')}`).toBeGreaterThanOrEqual(3);
    expect(hq.health).toBeGreaterThan(0);
  });

  await test.step('B4: the bot sets the aim of its towers for the boss and the air waves on the way', async () => {
    expect(report.actions['set-targeting'] ?? 0).toBeGreaterThan(0);
  });
});
