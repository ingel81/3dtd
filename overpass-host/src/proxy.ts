/**
 * The proxy in front of Overpass: what comes through the tunnel ends here.
 * Only /api/interpreter, GET or POST, from the game's pages (CORS) or from no
 * page at all; each client held to its rate and its running queries; each
 * query read (ql.ts) and refused unless every statement is held to a small
 * area, its timeout and maxsize capped; at most `slots` queries on Overpass,
 * the rest waiting a little or turned away busy. Every refusal is an HTTP
 * status the game's client sorts right (overpass-client.ts): 429 and 503 with
 * Retry-After make it pause this server and ask the others, 400 hands the
 * query over at once. The answer is streamed through as Overpass sends it
 * (compressed where the client accepts gzip). One row per request goes to
 * the statistics, without the address and without the query.
 */
import { existsSync } from 'node:fs';
import { Agent, createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ProxyConfig } from './config.ts';
import { analyzeQuery, anchorArea, anchorHull, capSettings, QlError, type Refusal } from './ql.ts';
import { clientKey, Gate, RateLimiter } from './rate-limit.ts';
import { inRanges, parseRanges } from './trusted.ts';
import type { Outcome, RequestRow } from './stats-store.ts';

export const INTERPRETER_PATH = '/api/interpreter';

/** Seconds a client is asked to wait while Overpass is down for a new clone, and while it cannot be reached */
const RETRY_AFTER_MAINTENANCE_S = 1800;
const RETRY_AFTER_DOWN_S = 300;
const RETRY_AFTER_BUSY_S = 15;
/** Seconds Overpass gets past the query's own timeout before the proxy gives up on it */
const UPSTREAM_GRACE_S = 30;

export interface ProxyDeps {
  /** Takes one row per request; none: no statistics */
  record?: (row: RequestRow) => void;
  now?: () => number;
  log?: (line: string) => void;
}

export interface RunningProxy {
  server: Server;
  limiter: RateLimiter;
  gate: Gate;
  close(): Promise<void>;
}

/** The headers that let the page `origin` read the answer, or null for a page that may not */
export function corsHeaders(origin: string | undefined, allowed: readonly string[]): Record<string, string> | null {
  if (!origin) return {};
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
  };
}

/** Whether the maintenance file exists, looked at no more than once a second */
function maintenanceCheck(path: string, now: () => number): () => boolean {
  let at = -Infinity;
  let on = false;
  return () => {
    if (!path) return false;
    if (now() - at > 1000) {
      at = now();
      on = existsSync(path);
    }
    return on;
  };
}

const COUNTRY = /^([A-Z]{2}|T1)$/;

export function startProxy(config: ProxyConfig, deps: ProxyDeps = {}): Promise<RunningProxy> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const limiter = new RateLimiter(
    { burst: config.rateBurst, perMinute: config.ratePerMinute, concurrent: config.rateConcurrent, maxClients: config.rateMaxClients },
    now,
  );
  const gate = new Gate(config.slots, config.queueMax, config.queueWaitMs);
  const agent = new Agent({ keepAlive: true, maxSockets: config.slots + 2 });
  const inMaintenance = maintenanceCheck(config.maintenanceFile, now);
  const upstream = new URL(config.upstream);
  const trusted = parseRanges(config.trustedProxies);
  const sweep = setInterval(() => limiter.sweep(), 60_000);
  sweep.unref();

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(`proxy: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('proxy error\n');
      } else {
        res.destroy();
      }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const start = now();
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok\n');
      return;
    }
    // Cloudflare's headers only from the tunnel's connector; anyone else could name any address
    const fromTunnel = config.trustCloudflare && inRanges(req.socket.remoteAddress, trusted);
    const country = fromTunnel ? String(req.headers['cf-ipcountry'] ?? '').toUpperCase() : '';
    const row: RequestRow = {
      t: start, status: 0, outcome: 'bad', ms: 0, msHead: null, bytes: 0,
      country: COUNTRY.test(country) ? country : null, box: null, areaKm2: null, reason: null,
    };
    const finish = (status: number, outcome: Outcome): void => {
      row.status = status;
      row.outcome = outcome;
      row.ms = now() - start;
      deps.record?.(row);
    };
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const cors = corsHeaders(origin, config.origins);
    /** A short answer of the proxy itself */
    const answer = (status: number, outcome: Outcome, text: string, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(cors ?? {}), ...extra });
      res.end(`${text}\n`);
      row.bytes = Buffer.byteLength(text) + 1;
      finish(status, outcome);
    };

    if (!cors || (!origin && !config.allowNoOrigin)) {
      answer(403, 'origin', 'this page may not use this server');
      req.resume();
      return;
    }
    if (path !== INTERPRETER_PATH) {
      answer(404, 'bad', 'only /api/interpreter here');
      req.resume();
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      answer(405, 'bad', 'GET or POST only', { Allow: 'GET, POST, OPTIONS' });
      req.resume();
      return;
    }
    if (inMaintenance()) {
      answer(503, 'down', 'the database is being renewed, ask another server', { 'Retry-After': String(RETRY_AFTER_MAINTENANCE_S) });
      req.resume();
      return;
    }

    const address = (fromTunnel && typeof req.headers['cf-connecting-ip'] === 'string' && req.headers['cf-connecting-ip']) ||
      req.socket.remoteAddress || 'unknown';
    const admission = limiter.admit(clientKey(address));
    if (!admission.ok) {
      const text = admission.reason === 'rate' ? 'too many queries, slow down' : 'too many queries at once';
      answer(429, admission.reason, text, { 'Retry-After': String(admission.retryAfterS) });
      req.resume();
      return;
    }
    let releaseSlot: (() => void) | null = null;
    try {
      const query = await readQuery(req, config.maxBodyBytes);
      if (typeof query !== 'string') {
        row.reason = 'body';
        answer(query.status, 'bad', query.message);
        return;
      }
      let analysis;
      try {
        analysis = analyzeQuery(query, { maxEdgeKm: config.maxEdgeKm, maxAreaKm2: config.maxAreaKm2 });
      } catch (error) {
        if (!(error instanceof QlError)) throw error;
        refuse({ code: 'syntax', message: `the query cannot be read: ${error.message}` });
        return;
      }
      row.box = anchorHull(analysis.anchors);
      row.areaKm2 = row.box ? Math.round(anchorArea(analysis.anchors) * 100) / 100 : null;
      if (analysis.refusal) {
        refuse(analysis.refusal);
        return;
      }
      const capped = capSettings(query, analysis.settings, { timeoutS: config.maxTimeoutS, maxsizeBytes: config.maxsizeBytes });

      const gone = new AbortController();
      const onClose = (): void => gone.abort();
      res.on('close', onClose);
      releaseSlot = await gate.acquire(gone.signal);
      if (gone.signal.aborted) {
        finish(499, 'aborted');
        return;
      }
      if (!releaseSlot) {
        answer(503, 'busy', 'the server is busy, ask another', { 'Retry-After': String(RETRY_AFTER_BUSY_S) });
        return;
      }
      await forward(req, res, capped.query, (capped.timeoutS + UPSTREAM_GRACE_S) * 1000, gone.signal, row, finish, answer);
    } finally {
      releaseSlot?.();
      admission.release();
    }

    function refuse(refusal: Refusal): void {
      row.reason = refusal.code;
      answer(400, 'refused', refusal.message);
    }
  }

  /** Send `query` to Overpass and stream its answer to `res` */
  function forward(
    req: IncomingMessage,
    res: ServerResponse,
    query: string,
    timeoutMs: number,
    gone: AbortSignal,
    row: RequestRow,
    finish: (status: number, outcome: Outcome) => void,
    answer: (status: number, outcome: Outcome, text: string, extra?: Record<string, string>) => void,
  ): Promise<void> {
    const body = `data=${encodeURIComponent(query)}`;
    const sent = now();
    const cors = corsHeaders(typeof req.headers.origin === 'string' ? req.headers.origin : undefined, config.origins) ?? {};
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        gone.removeEventListener('abort', onGone);
        resolve();
      };
      const up = httpRequest(
        {
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port,
          path: upstream.pathname,
          method: 'POST',
          agent,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
            ...(gzip ? { 'Accept-Encoding': 'gzip' } : { 'Accept-Encoding': 'identity' }),
          },
        },
        (upRes) => {
          row.msHead = now() - sent;
          const status = upRes.statusCode ?? 502;
          const headers: Record<string, string> = { ...cors, 'Cache-Control': 'no-store' };
          for (const name of ['content-type', 'content-encoding', 'content-length', 'retry-after']) {
            const value = upRes.headers[name];
            if (typeof value === 'string') headers[name] = value;
          }
          // Overpass's own refusals: the game pauses this server for Retry-After (at least 30 s after a 429)
          if ((status === 429 || status === 503) && !headers['retry-after']) headers['Retry-After'] = String(RETRY_AFTER_BUSY_S);
          res.writeHead(status, headers);
          upRes.on('data', (chunk: Buffer) => {
            row.bytes += chunk.length;
          });
          upRes.pipe(res);
          upRes.on('end', () => {
            finish(status, status >= 200 && status < 300 ? 'ok' : 'upstream');
            done();
          });
          upRes.on('error', () => {
            res.destroy();
            finish(status, gone.aborted ? 'aborted' : 'upstream');
            done();
          });
        },
      );
      const fail = (status: number, outcome: Outcome, text: string, extra: Record<string, string> = {}): void => {
        up.destroy();
        if (settled) return;
        if (!res.headersSent) answer(status, outcome, text, extra);
        else {
          res.destroy();
          finish(row.status || status, outcome);
        }
        done();
      };
      const onGone = (): void => {
        up.destroy();
        if (settled) return;
        finish(499, 'aborted');
        done();
      };
      gone.addEventListener('abort', onGone, { once: true });
      const timer = setTimeout(() => fail(504, 'timeout', 'the query took too long'), timeoutMs);
      up.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        log(`proxy: upstream ${error.code ?? ''} ${error.message}`);
        fail(503, 'down', 'the database cannot be reached, ask another server', { 'Retry-After': String(RETRY_AFTER_DOWN_S) });
      });
      up.end(body);
    });
  }

  return new Promise((resolve) => {
    server.listen(config.port, () => {
      resolve({
        server,
        limiter,
        gate,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(sweep);
            agent.destroy();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** The query of a request: `data` of the URL (GET) or of the form (POST), or a POST's body as it is */
async function readQuery(req: IncomingMessage, maxBytes: number): Promise<string | { status: number; message: string }> {
  if (req.method === 'GET') {
    const data = new URL(req.url ?? '/', 'http://proxy').searchParams.get('data');
    return data?.trim() ? data : { status: 400, message: 'no query: send it as data=' };
  }
  const body = await new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    let length = 0;
    // Past the limit the rest is read and dropped, so that the answer still reaches the client
    req.on('data', (chunk: Buffer) => {
      if (length > maxBytes) return;
      length += chunk.length;
      if (length > maxBytes) resolve(null);
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
  if (!body) return { status: 413, message: `the query is longer than ${Math.round(maxBytes / 1024)} kB` };
  const text = body.toString('utf8');
  const form = /application\/x-www-form-urlencoded/i.test(String(req.headers['content-type'] ?? '')) || /^data=/.test(text);
  const data = form ? new URLSearchParams(text).get('data') : text;
  return data?.trim() ? data : { status: 400, message: 'no query: send it as data=' };
}
