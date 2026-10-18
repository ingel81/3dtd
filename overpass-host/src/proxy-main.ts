/**
 * node src/proxy-main.ts: the proxy in front of Overpass (proxy.ts), set up
 * from the environment (config.ts, .env.example), with its statistics: the
 * rows (stats-store.ts), the players per day (players.ts, written every
 * 10 s and at the day's end) and the names of the places asked for
 * (places.ts, asked of Overpass while it has a slot to spare). A stop
 * (SIGTERM) writes what waits and lets the answers under way end, at most 10 s.
 */
import { proxyConfig } from './config.ts';
import { PlaceResolver } from './places.ts';
import { DailyPlayers } from './players.ts';
import { INTERPRETER_PATH, startProxy, type RunningProxy } from './proxy.ts';
import { openStats, StatsWriter } from './stats-store.ts';

const config = proxyConfig();
const stats = config.statsDb ? new StatsWriter(openStats(config.statsDb), config.statsDays) : null;
const players = stats
  ? new DailyPlayers({ baseOf: (day) => stats.playersOf(day), onDayEnd: (day, count) => stats.setPlayers(day, count) })
  : null;
const writePlayers = (): void => {
  if (!players || !stats) return;
  const { day, players: count } = players.current();
  stats.setPlayers(day, count);
};
const playersTimer = setInterval(writePlayers, 10_000);
playersTimer.unref();
let proxy: RunningProxy | null = null;
const places = stats
  ? new PlaceResolver({
    upstream: config.upstream,
    // Leaves a slot to the game's queries
    idle: () => !proxy || proxy.gate.load.running < config.slots - 1,
    store: (cell, place) => stats.setPlace(cell, place),
    known: (cell) => stats.hasPlace(cell),
    log: (line) => console.log(line),
  })
  : null;
proxy = await startProxy(config, {
  record: stats ? (row) => stats.add(row) : undefined,
  seeClient: players ? (key) => players.see(key) : undefined,
  answeredCell: places ? (cell, at) => places.want(cell, at) : undefined,
});
const running = proxy;
console.log(
  `proxy ${process.env['HOST_BUILD'] ?? 'dev'} on :${config.port}${INTERPRETER_PATH} -> ${config.upstream}; boxes up to ${config.maxEdgeKm} km and ${config.maxAreaKm2} km², ` +
  `timeout ${config.maxTimeoutS} s, maxsize ${config.maxsizeBytes / 1024 / 1024} MB, ${config.slots} slots; ` +
  `Cloudflare's headers from ${config.trustCloudflare ? config.trustedProxies : 'nobody'}; per client ${config.rateBurst} then ${config.ratePerMinute}/min, ${config.rateConcurrent} at once; origins ${config.origins.join(' ')}`,
);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  places?.stop();
  clearInterval(playersTimer);
  writePlayers();
  const force = setTimeout(() => {
    stats?.close();
    process.exit(0);
  }, 10_000);
  running.server.close(() => {
    clearTimeout(force);
    stats?.close();
    process.exit(0);
  });
  running.server.closeIdleConnections();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('uncaughtException', (error) => console.error(`uncaught: ${error.stack ?? error.message}`));
