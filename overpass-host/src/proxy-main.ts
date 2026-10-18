/**
 * node src/proxy-main.ts: the proxy in front of Overpass (proxy.ts), set up
 * from the environment (config.ts, .env.example). A stop (SIGTERM) writes
 * the statistics that wait and lets the answers under way end, at most 10 s.
 */
import { proxyConfig } from './config.ts';
import { INTERPRETER_PATH, startProxy } from './proxy.ts';
import { openStats, StatsWriter } from './stats-store.ts';

const config = proxyConfig();
const stats = config.statsDb ? new StatsWriter(openStats(config.statsDb), config.statsDays) : null;
const proxy = await startProxy(config, { record: stats ? (row) => stats.add(row) : undefined });
console.log(
  `proxy ${process.env.HOST_BUILD ?? 'dev'} on :${config.port}${INTERPRETER_PATH} -> ${config.upstream}; boxes up to ${config.maxEdgeKm} km and ${config.maxAreaKm2} km², ` +
  `timeout ${config.maxTimeoutS} s, maxsize ${config.maxsizeBytes / 1024 / 1024} MB, ${config.slots} slots; ` +
  `per client ${config.rateBurst} then ${config.ratePerMinute}/min, ${config.rateConcurrent} at once; origins ${config.origins.join(' ')}`,
);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => {
    stats?.close();
    process.exit(0);
  }, 10_000);
  proxy.server.close(() => {
    clearTimeout(force);
    stats?.close();
    process.exit(0);
  });
  proxy.server.closeIdleConnections();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('uncaughtException', (error) => console.error(`uncaught: ${error.stack ?? error.message}`));
