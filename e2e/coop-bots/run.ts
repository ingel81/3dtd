// Coop runs of bots (TODO E53, docs/E2E.md): N headless tabs of a static
// dev build in DevWorld (`?devworld&spawns=N&bot=coop`), one room on a local
// relay, one bot per seat. The host's tab opens the room from the dock, the
// others join by its code and ready up, the host starts and sets the speed;
// from then on each bot plays its own lane through the normal command path
// (lockstep). A probe in the host's tab writes what every wave did, a line
// per wave into <out>/runs.jsonl, a line per run with the end.
//
//   node e2e/coop-bots/run.ts --url http://localhost:4213 --relay ws://localhost:3013 \
//     --relay-log <dir of the relay's coop_*.log> --out <dir> --runs 20 --parallel 3
//
// The game, the relay and nothing else: no bot server, no dev server, no map
// tiles. Start the relay (npm run coop-server -- --port 3013 --log-dir <dir>)
// and serve the build (npx ng build --configuration development, then
// python -m http.server 4213 in dist/3DTD/browser) before.
import { chromium, firefox, type Browser, type Page } from '@playwright/test';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4213');
const RELAY = argument('relay', 'ws://localhost:3013');
const RELAY_LOG = argument('relay-log', '');
const OUT = argument('out', 'coop-bot-runs');
const RUNS = Number(argument('runs', '1'));
/** More of the page's query for every tab, e.g. a switch of a measurement build: `--query leakmode=split` */
const EXTRA_QUERY = argument('query', '');
const PARALLEL = Number(argument('parallel', '1'));
/**
 * One bot alone in the shipped DevWorld (one spawn), the baseline for the
 * coop runs: the same build and probe, no room. Needs no bot server either;
 * one that runs on :3001 would take the tab over, so the runner refuses.
 */
const SOLO = process.argv.includes('--solo');
const PLAYERS = SOLO ? 1 : Number(argument('players', '2'));
/** The lockstep room takes 0.5 to 4 (coop-server room.ts SPEEDS); alone any */
const SPEED = SOLO ? Number(argument('speed', '4')) : Math.min(4, Number(argument('speed', '4')));
/** A run ends here at the latest, wall clock */
const RUN_MINUTES = Number(argument('minutes', '60'));
/** And at this wave, 0 for none */
const MAX_WAVES = Number(argument('max-waves', '0'));
/** The 3D view on (slower, only to look at a run) */
const RENDER = process.argv.includes('--render');
const HEADED = process.argv.includes('--headed');
/**
 * WebGL on SwiftShader instead of the machine's GPU. The lines of sight are
 * cube renders on the GPU (the host's in coop); on SwiftShader they took a
 * whole CPU per browser and held a room at half speed.
 */
const SWIFTSHADER = process.argv.includes('--swiftshader');
/**
 * The browser of each seat, host first, repeated for more seats:
 * `--browsers chromium,firefox` puts a Firefox guest against a Chromium host
 * (TODO E28, D29). Chromium by default.
 */
type Engine = 'chromium' | 'firefox';
const ENGINES = argument('browsers', 'chromium').split(',').map((name) => {
  if (name !== 'chromium' && name !== 'firefox') throw new Error(`--browsers: no browser '${name}'`);
  return name as Engine;
});
const engineOf = (seat: number): Engine => ENGINES[seat % ENGINES.length];
/**
 * Seats whose native transcendentals return other last bits (`--skew-seats 1`),
 * as another engine's might: a Chromium room with one skewed seat finds
 * simulation code that still calls them (TODO E28). A skewed seat also counts
 * where each native function is called from (`math-callers-<run>.json`).
 */
/**
 * Seats whose Chromium runs the CPU slower by `--throttle N` (`--throttle-seats 1`):
 * fewer frames and more sub-steps per frame than the other seats, as a slower
 * browser has them. Finds simulation state that follows the frame rate.
 */
const THROTTLE_SEATS = new Set(argument('throttle-seats', '').split(',').filter(Boolean).map(Number));
const THROTTLE = Number(argument('throttle', '4'));
/** Hash reports every N ticks (`?hashEvery=`); the relay needs the same `--hash-every` */
const HASH_EVERY = argument('hash-every', '');
const SKEW_SEATS = new Set(argument('skew-seats', '').split(',').filter(Boolean).map(Number));
const GPU_ARGS = SWIFTSHADER
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];

mkdirSync(OUT, { recursive: true });
const RUNS_FILE = join(OUT, 'runs.jsonl');
const log = (text: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);
const write = (record: unknown) => appendFileSync(RUNS_FILE, `${JSON.stringify(record)}\n`);

// === One seat ===

async function openSeat(browser: Browser, name: string, skew = false): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  if (skew) await page.addInitScript(skewNativeMath);
  await page.addInitScript((seat) => {
    localStorage.setItem('td_seen_version', '9999.0.0');
    localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
    localStorage.setItem('3dtd-coop-name', seat);
  }, name);
  page.on('pageerror', (err) => log(`[${name}] page error: ${err.message}`));
  const query = SOLO ? 'devworld'
    : `devworld&spawns=${PLAYERS}&bot=coop&relay=${encodeURIComponent(RELAY)}${HASH_EVERY ? `&hashEvery=${HASH_EVERY}` : ''}`;
  await page.goto(`${URL_BASE}/?${query}${EXTRA_QUERY ? `&${EXTRA_QUERY}` : ''}`);
  await gameReady(page);
  if (!RENDER) {
    await page.evaluate(() => {
      const w = window as unknown as { ng: { getComponent(el: Element | null): { store: { renderingEnabled: { set(v: boolean): void } } } } };
      w.ng.getComponent(document.querySelector('app-tower-defense')).store.renderingEnabled.set(false);
    });
  }
  return page;
}

/**
 * In the page, before the game: every native transcendental returns its
 * value times (1 + 2^-40), and each call site is counted by the stack frame
 * that called it (two frames, the function and its caller).
 */
function skewNativeMath(): void {
  const names = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10',
    'pow', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'];
  const callers: Record<string, number> = {};
  (window as unknown as { __mathCallers: Record<string, number> }).__mathCallers = callers;
  const M = Math as unknown as Record<string, (...args: number[]) => number>;
  for (const name of names) {
    const native = M[name];
    M[name] = function (...args: number[]) {
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 4;
      const stack = (new Error().stack ?? '').split('\n').slice(2, 4).map((l) => l.trim()).join(' < ');
      Error.stackTraceLimit = limit;
      const key = `${name} ${stack}`;
      callers[key] = (callers[key] ?? 0) + 1;
      const r = native(...args);
      return r === 0 || !Number.isFinite(r) ? r : r * (1 + 2 ** -40);
    };
  }
}

/** The loading screen gone for good, the intro skipped */
async function gameReady(page: Page): Promise<void> {
  // Under load the app takes a while to come up at all
  await page.waitForSelector('app-tower-defense', { timeout: 180_000 });
  await page.waitForSelector('td-loading-screen', { timeout: 60_000 }).catch(() => undefined);
  const end = Date.now() + 300_000;
  let gone = 0;
  while (gone < 4 && Date.now() < end) {
    gone = (await page.locator('td-loading-screen').count()) ? 0 : gone + 1;
    await page.waitForTimeout(500);
  }
  if (gone < 4) throw new Error('the loading screen stayed');
  for (let i = 0; i < 20; i++) {
    const skip = page.getByRole('button', { name: /skip intro/i });
    if (!(await skip.count())) break;
    await skip.first().click().catch(() => undefined);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1000);
}

// === The room, through the dock as a player does it (e2e/support/game.ts) ===

async function openDock(page: Page): Promise<void> {
  if (await page.locator('app-coop-dock').count()) return;
  await page.getByRole('button', { name: /^Coop/ }).first().click();
  await page.locator('app-coop-dock').waitFor();
}

async function startRoom(seats: Page[]): Promise<string> {
  const [host, ...guests] = seats;
  await openDock(host);
  await host.getByRole('button', { name: 'Host a room' }).click();
  const code = (await host.locator('app-coop-dock .code b').innerText({ timeout: 60_000 })).trim();
  for (const guest of guests) {
    await openDock(guest);
    await guest.locator('app-coop-dock input.codein').fill(code);
    await guest.locator('app-coop-dock .code-row').getByRole('button', { name: 'Join', exact: true }).click();
  }
  await host.locator('app-coop-dock .who').nth(seats.length - 1).waitFor({ timeout: 120_000 });
  for (const guest of guests) await guest.getByRole('button', { name: 'Ready up' }).click({ timeout: 120_000 });
  await host.getByRole('button', { name: 'Start match' }).click({ timeout: 60_000 });
  for (const page of seats) await page.locator('app-coop-squad .squad').waitFor({ timeout: 60_000 });
  // The speed is the host's (D15): the speed button steps 1, 2, 4
  for (let i = 0; i < 4; i++) {
    const button = host.getByRole('button', { name: /^Game speed / });
    const label = (await button.getAttribute('aria-label')) ?? '';
    if (label.includes(`${SPEED}x`)) break;
    await button.click();
    await host.waitForTimeout(400);
  }
  for (const page of seats) {
    const close = page.getByRole('button', { name: 'Close the coop dock' });
    if (await close.count()) await close.click().catch(() => undefined);
  }
  return code;
}

// === The probe: what each wave did, read in the host's tab ===

/**
 * Hooks the game's event bus of the page. The simulation is the same on every
 * client, so one tab sees every player's gold and towers; the desyncs each
 * tab heard come from its own CoopService.
 */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Pos = { lat: number; lon: number };
    type AnyFn = (...args: never[]) => unknown;
    const w = window as unknown as Record<string, unknown> & { ng: { getComponent(el: Element | null): Record<string, never> } };
    const comp = w.ng.getComponent(document.querySelector('app-tower-defense')) as unknown as {
      gameState: Record<string, AnyFn> & { players: string[]; laneSpawns: string[]; gameTimeMs: number; towerManager: { getAll(): { ownerId: string; typeConfig: { id: string } }[] } };
      coop: { desync(): { tick: number } | null };
    };
    const gs = comp.gameState;
    const bus = (gs.getEventBus as () => { onLive(type: string, fn: (e: Record<string, never>) => void): void })();
    const paths = () => (gs.getCachedPaths as () => Map<string, Pos[]>)();
    const laneOf = (enemy: { movement: { path: Pos[] } }): string => {
      const first = enemy.movement.path[0];
      if (!first) return '?';
      for (const [id, path] of paths()) {
        if (path[0] && Math.abs(path[0].lat - first.lat) < 1e-5 && Math.abs(path[0].lon - first.lon) < 1e-5) return id;
      }
      return '?';
    };
    const add = (map: Record<string, number>, key: string, n: number) => { map[key] = (map[key] ?? 0) + n; };
    const perPlayer = <T>(fn: (id: string) => T) => Object.fromEntries(gs.players.map((id) => [id, fn(id)]));
    const lanes = () => perPlayer((id) => (gs.laneSpawnOf as (p: string) => string | null)(id));
    const towers = () => {
      const counts: Record<string, number> = {};
      for (const tower of gs.towerManager.getAll()) {
        if (tower.typeConfig.id === 'research-center' || tower.typeConfig.id === 'missile-silo') continue;
        add(counts, tower.ownerId, 1);
      }
      return counts;
    };
    const credits = () => perPlayer((id) => (gs.creditsOf as (p: string) => number)(id));
    /** Per owner, how many of their fighting towers stand nearest to which lane's route */
    const towerLanes = () => {
      const out: Record<string, Record<string, number>> = {};
      const routes = [...paths()];
      for (const tower of gs.towerManager.getAll() as unknown as { ownerId: string; typeConfig: { id: string }; position: Pos }[]) {
        if (tower.typeConfig.id === 'research-center' || tower.typeConfig.id === 'missile-silo') continue;
        let best = '?';
        let bestD = Infinity;
        for (const [id, path] of routes) {
          for (const point of path) {
            const d = (point.lat - tower.position.lat) ** 2 + (point.lon - tower.position.lon) ** 2;
            if (d < bestD) { bestD = d; best = id; }
          }
        }
        add(out[tower.ownerId] ??= {}, best, 1);
      }
      return out;
    };
    const health = () => (gs.baseHealth as () => number)();
    interface Wave {
      wave: number; enemyCount: number; lanes: number; t0: number;
      spawnedByLane: Record<string, number>; killsByLane: Record<string, number>;
      killGoldByLane: Record<string, number>; leaksByLane: Record<string, number>;
      killGoldByPlayer: Record<string, number>; waveGoldByPlayer: Record<string, number>;
      spentByPlayer: Record<string, number>; hpStart: number; hpLost: number;
      creditsStart: Record<string, number>; towersStart: Record<string, number>;
    }
    const probe = {
      waves: [] as Record<string, unknown>[],
      current: null as Wave | null,
      end: null as Record<string, unknown> | null,
      desync: null as { tick: number; towers: Record<string, string>; enemies: Record<string, string> } | null,
    };
    w['__coopProbe'] = probe;
    const close = (outcome: string, extra: Record<string, unknown> = {}) => {
      const wave = probe.current;
      if (!wave) return;
      probe.current = null;
      probe.waves.push({
        ...wave,
        outcome,
        seconds: Math.round((gs.gameTimeMs - wave.t0) / 100) / 10,
        hpEnd: health(),
        creditsByPlayer: credits(),
        towersByPlayer: towers(),
        towerLanes: towerLanes(),
        players: gs.players.slice(),
        lanes: lanes(),
        ...extra,
      });
    };
    bus.onLive('wave:started', (e) => {
      // The run is over; a tab alone starts the next one by itself
      if (probe.end) return;
      probe.current = {
        wave: e['wave'] as number, enemyCount: e['enemyCount'] as number, lanes: gs.laneSpawns.length,
        t0: gs.gameTimeMs, spawnedByLane: {}, killsByLane: {}, killGoldByLane: {}, leaksByLane: {},
        killGoldByPlayer: {}, waveGoldByPlayer: {}, spentByPlayer: {}, hpStart: health(), hpLost: 0,
        creditsStart: credits(), towersStart: towers(),
      };
    });
    bus.onLive('enemy:spawned', (e) => {
      if (probe.current && e['viaPortal']) add(probe.current.spawnedByLane, laneOf(e['enemy']), 1);
    });
    bus.onLive('enemy:died', (e) => {
      if (!probe.current) return;
      const lane = laneOf(e['enemy']);
      add(probe.current.killsByLane, lane, 1);
      add(probe.current.killGoldByLane, lane, e['credits'] as number);
    });
    bus.onLive('enemy:reached-base', (e) => {
      if (probe.current) add(probe.current.leaksByLane, laneOf(e['enemy']), 1);
    });
    bus.onLive('health:changed', (e) => {
      if (probe.current && (e['delta'] as number) < 0 && e['cause'] !== 'cheat') probe.current.hpLost -= e['delta'] as number;
    });
    bus.onLive('credits:changed', (e) => {
      const wave = probe.current;
      const source = e['source'] as string;
      const delta = e['delta'] as number;
      const player = e['playerId'] as string;
      if (source === 'wave-bonus') {
        // Booked as the wave ends, before or after the probe closed it
        const last = probe.waves[probe.waves.length - 1] as { waveGoldByPlayer?: Record<string, number> } | undefined;
        if (wave) add(wave.waveGoldByPlayer, player, delta);
        else if (last?.waveGoldByPlayer) add(last.waveGoldByPlayer, player, delta);
        return;
      }
      if (!wave) return;
      if (source === 'kill') add(wave.killGoldByPlayer, player, delta);
      else if (delta < 0) add(wave.spentByPlayer, player, -delta);
    });
    bus.onLive('wave:completed', (e) => close('completed', { waveGold: e['credits'] }));
    bus.onLive('game:over', (e) => {
      close('base-destroyed');
      probe.end = { reason: e['reason'], waves: probe.waves.length, creditsByPlayer: credits(), towersByPlayer: towers(), gameSeconds: Math.round(gs.gameTimeMs / 1000) };
    });
    // Trace of the last damage and hits (TODO E64): per entry the sub-step, what and the numbers
    // bit for bit. Frozen at the first desync, so both tabs show what led to it.
    const TRACE_MAX = 200000;
    const trace: unknown[][] = [];
    const step = () => (gs as unknown as { subStep: number }).subStep;
    let frozen = false;
    setInterval(() => { if (comp.coop.desync()) frozen = true; }, 50);
    const push = (row: unknown[]) => {
      if (frozen) return;
      trace.push(row);
      if (trace.length > TRACE_MAX) trace.splice(0, trace.length - TRACE_MAX);
    };
    const findDamageService = (): Record<string, AnyFn> | null => {
      const seen = new Set<unknown>();
      const walk = (obj: unknown, depth: number): Record<string, AnyFn> | null => {
        if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 3) return null;
        seen.add(obj);
        const o = obj as Record<string, unknown>;
        if (typeof o['applyDamage'] === 'function' && typeof o['applyBeamDamage'] === 'function') return o as Record<string, AnyFn>;
        for (const key of Object.keys(o)) {
          const found = walk(o[key], depth + 1);
          if (found) return found;
        }
        return null;
      };
      return walk(gs, 0);
    };
    const oddSplash: Record<string, unknown>[] = [];
    const damage = findDamageService();
    if (damage) {
      const proto = Object.getPrototypeOf(damage) as Record<string, AnyFn>;
      for (const name of ['applyDamage', 'applyBeamDamage'] as const) {
        const original = proto[name];
        proto[name] = function (this: unknown, ...args: never[]) {
          const enemy = args[1] as unknown as { id: string; health: { hp: number }; position: Pos };
          const before = enemy.health.hp;
          // A splash hit with falloff deals a whole number; one that does not: where did it come from?
          if (name === 'applyDamage' && (args[5] as unknown) === true && !Number.isInteger(args[2] as unknown as number) && oddSplash.length < 20) {
            oddSplash.push({ step: step(), source: args[4], damage: args[2], enemy: enemy.id, stack: new Error().stack });
          }
          const result = original.apply(this, args);
          push([step(), name === 'applyDamage' ? 'dmg' : 'beam', args[4], enemy.id, args[2], args[3], args[5], before, enemy.health.hp, enemy.position.lat, enemy.position.lon]);
          return result;
        } as AnyFn;
      }
    }
    bus.onLive('projectile:hit', (e) => {
      const p = e['projectile'] as unknown as { id: string; position: Pos; flightHeight: number; targetLost: boolean; typeConfig: { id: string } };
      const target = e['target'] as unknown as { id: string; position: Pos } | null;
      push([step(), 'hit', p.id, p.typeConfig.id, target?.id ?? null, p.position.lat, p.position.lon, p.flightHeight, p.targetLost, target?.position.lat ?? null, target?.position.lon ?? null]);
    });
    for (const type of ['ability:used', 'ability:impact', 'enemy:split', 'enemy:spawned'] as const) {
      bus.onLive(type, (e) => {
        const enemy = e['enemy'] as unknown as { id: string; health?: { hp: number }; position: Pos } | undefined;
        push([step(), type, enemy?.id ?? null, enemy?.health?.hp ?? null, enemy?.position.lat ?? null, enemy?.position.lon ?? null, (e as Record<string, unknown>)['abilityId'] ?? null]);
      });
    }
    w['__simTrace'] = () => ({ damageHooked: !!damage, oddSplash, rows: trace });

    setInterval(() => {
      const found = comp.coop.desync();
      if (!found || probe.desync) return;
      // The relay's detail line names towers and enemies by id; their types, as this tab has them
      const types = (list: { id: string; typeConfig: { id: string } }[]) => Object.fromEntries(list.map((e) => [e.id, e.typeConfig.id]));
      probe.desync = {
        tick: found.tick,
        towers: types(gs.towerManager.getAll() as unknown as { id: string; typeConfig: { id: string } }[]),
        enemies: types((gs.enemyManager as unknown as { getAlive(): { id: string; typeConfig: { id: string } }[] }).getAlive()),
      };
    }, 500);
  });
}

async function probeOf(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { __coopProbe: {
      waves: Record<string, unknown>[];
      current: { wave: number } | null; end: Record<string, unknown> | null; desync: { tick: number } | null;
    } }).__coopProbe;
    return { waves: p.waves.slice(), current: p.current?.wave ?? null, end: p.end, desync: p.desync };
  });
}

async function desyncOf(page: Page): Promise<{ tick: number; towers: Record<string, string>; enemies: Record<string, string> } | null> {
  return page.evaluate(() => (window as unknown as { __coopProbe?: { desync: { tick: number; towers: Record<string, string>; enemies: Record<string, string> } | null } }).__coopProbe?.desync ?? null)
    .catch(() => null);
}

/** The relay's DESYNC lines of room `code`, as it logged them */
function relayDesyncs(code: string): string[] {
  if (!RELAY_LOG || !existsSync(RELAY_LOG)) return [];
  const lines: string[] = [];
  for (const file of readdirSync(RELAY_LOG).filter((f) => f.startsWith('coop_') && f.endsWith('.log'))) {
    for (const line of readFileSync(join(RELAY_LOG, file), 'utf8').split('\n')) {
      if (line.includes(code) && line.includes('DESYNC')) lines.push(line.trim());
    }
  }
  return lines;
}

// === One run ===

/** False when the run never got going (a tab did not load, the room did not start): it is tried again */
async function playRun(index: number): Promise<boolean> {
  const started = Date.now();
  // A browser per run: one GPU process for all tabs made the runs wait on each other
  const browsers = new Map<Engine, Browser>();
  for (let seat = 0; seat < PLAYERS; seat++) {
    const engine = engineOf(seat);
    if (!browsers.has(engine)) browsers.set(engine, await launch(engine));
  }
  const seats: Page[] = [];
  let code = '';
  let written = 0;
  let playing = false;
  try {
    for (let i = 0; i < PLAYERS; i++) seats.push(await openSeat(browsers.get(engineOf(i))!, `Bot${i + 1}`, SKEW_SEATS.has(i)));
    for (const seat of THROTTLE_SEATS) {
      const cdp = await seats[seat].context().newCDPSession(seats[seat]);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    }
    await installProbe(seats[0]);
    for (const page of seats.slice(1)) await installProbe(page);
    if (SOLO) {
      code = `solo-${index}`;
      await seats[0].evaluate((speed) => {
        const w = window as unknown as { ng: { getComponent(el: Element | null): { gameState: { setGameSpeed(v: number): void } } } };
        w.ng.getComponent(document.querySelector('app-tower-defense')).gameState.setGameSpeed(speed);
      }, SPEED);
    } else {
      code = await startRoom(seats);
    }
    playing = true;
    log(`run ${index}: room ${code}, ${PLAYERS} bots, speed ${SPEED}`);
    const deadline = started + RUN_MINUTES * 60_000;
    let end: Record<string, unknown> | null = null;
    let lastWave = 0;
    while (Date.now() < deadline) {
      await seats[0].waitForTimeout(5000);
      const probe = await probeOf(seats[0]);
      for (const wave of probe.waves.slice(written)) write({ kind: 'wave', run: index, room: code, solo: SOLO, ...wave });
      written = probe.waves.length;
      if (written > lastWave) {
        lastWave = written;
        const w = probe.waves[written - 1] as { wave: number; hpEnd: number; creditsByPlayer: Record<string, number>; towersByPlayer: Record<string, number> };
        log(`run ${index}: wave ${w.wave} HQ ${w.hpEnd} credits ${JSON.stringify(Object.values(w.creditsByPlayer))} towers ${JSON.stringify(Object.values(w.towersByPlayer))}`);
      }
      if (probe.end) { end = probe.end; break; }
      if (MAX_WAVES > 0 && written >= MAX_WAVES) { end = { reason: 'max-waves', waves: written }; break; }
    }
    const desyncs = await Promise.all(seats.map(desyncOf));
    {
      for (const [seat, page] of seats.entries()) {
        const simTrace = await page.evaluate(() => (window as unknown as { __simTrace?: () => unknown }).__simTrace?.() ?? null).catch(() => null);
        writeFileSync(join(OUT, `trace-${index}-seat${seat}-${engineOf(seat)}.json`), JSON.stringify(simTrace));
      }
    }
    for (const [seat, page] of seats.entries()) {
      if (!SKEW_SEATS.has(seat)) continue;
      const callers = await page.evaluate(() => (window as unknown as { __mathCallers?: Record<string, number> }).__mathCallers ?? {});
      writeFileSync(join(OUT, `math-callers-${index}-seat${seat}.json`), JSON.stringify(callers, null, 1));
    }
    write({
      kind: 'run', run: index, room: code, solo: SOLO, players: PLAYERS, speed: SPEED,
      browsers: Array.from({ length: PLAYERS }, (_, seat) => engineOf(seat)),
      end: end ?? { reason: 'timeout', waves: written },
      wallMinutes: Math.round((Date.now() - started) / 6000) / 10,
      desyncTicks: desyncs.map((d) => d?.tick ?? null),
      // Tower and enemy types at the first desync the host's tab saw, for the relay's detail lines
      desyncTypes: desyncs[0] ? { towers: desyncs[0].towers, enemies: desyncs[0].enemies } : null,
      relayDesyncs: relayDesyncs(code),
    });
    log(`run ${index}: ended (${end?.['reason'] ?? 'timeout'}) after ${written} waves, ${Math.round((Date.now() - started) / 60000)} min`);
    return true;
  } catch (err) {
    write({ kind: 'run', run: index, room: code, players: PLAYERS, speed: SPEED, error: String(err), started: playing, wavesWritten: written });
    // What the tabs showed, to see where a room got stuck
    for (const [seat, page] of seats.entries()) {
      await page.screenshot({ path: join(OUT, `failed-${index}-seat${seat}.png`) }).catch(() => undefined);
    }
    log(`run ${index}: failed${playing ? '' : ' before the start, again'}: ${String(err).split('\n')[0]}`);
    return playing;
  } finally {
    for (const page of seats) await page.context().close().catch(() => undefined);
    for (const browser of browsers.values()) await browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  if (SOLO && await fetch('http://localhost:3001/').then(() => true, () => false)) {
    throw new Error('A bot server runs on :3001; a solo DevWorld tab would follow its commands. Stop it first.');
  }
  // Run indices stay unique; a run that never got going does not count
  let next = 0;
  let claimed = 0;
  let attempts = 0;
  const worker = async () => {
    while (claimed < RUNS && attempts < RUNS * 2) {
      claimed++;
      attempts++;
      if (!(await playRun(next++))) claimed--;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, PARALLEL) }, worker));
}

function launch(engine: Engine): Promise<Browser> {
  if (engine === 'firefox') {
    return firefox.launch({ headless: !HEADED, firefoxUserPrefs: { 'webgl.force-enabled': true } });
  }
  return chromium.launch({
    headless: !HEADED,
    args: [...GPU_ARGS, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
}

await main();
