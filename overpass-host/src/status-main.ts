/**
 * node src/status-main.ts: the status page (status-page.ts) for the LAN.
 * It reads the proxy's statistics read-only, asks Overpass for its status on
 * the internal network and looks at the data directory, mounted read-only.
 * `/` the page, `/api/summary?range=1h|24h|7d|30d` what it shows, `/healthz`.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { statusConfig } from './config.ts';
import { statusPage } from './status-page.ts';
import { openStats, RANGES, summarize, type RangeName, type Summary } from './stats-store.ts';
import { hostState } from './system.ts';

const config = statusConfig();
let db: DatabaseSync | null = null;

/** The statistics, opened once the proxy has made the file */
function stats(): DatabaseSync | null {
  if (!db && existsSync(config.statsDb)) {
    try {
      db = openStats(config.statsDb, true);
    } catch (error) {
      console.error(`status: cannot open ${config.statsDb}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return db;
}

const empty = (range: RangeName): Summary => {
  const { bucketMs, ms } = RANGES[range];
  return {
    range, from: Date.now() - ms, to: Date.now(), bucketMs, buckets: [],
    totals: { requests: 0, ok: 0, bytes: 0, p50: null, p95: null },
    outcomes: [], countries: [], heat: [], problems: [], reasons: [],
  };
};

const page = statusPage();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://status');
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n');
    return;
  }
  if (url.pathname === '/api/summary') {
    const asked = url.searchParams.get('range') ?? '24h';
    const range: RangeName = asked in RANGES ? (asked as RangeName) : '24h';
    const source = stats();
    let summary: Summary;
    try {
      summary = source ? summarize(source, range) : empty(range);
    } catch (error) {
      console.error(`status: ${error instanceof Error ? error.message : String(error)}`);
      summary = empty(range);
    }
    hostState(config.overpassApi, config.dbDir, config.sharedDir).then(
      (host) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ summary, host }));
      },
      (error: unknown) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error));
      },
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not here\n');
});

server.listen(config.port, () => console.log(`status page on :${config.port}`));
const stop = (): void => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
