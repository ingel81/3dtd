/**
 * The settings of the proxy and the status page, from the environment
 * (.env.example names each with its default). A value that is set but no
 * number stops the start, so a typo does not quietly lift a limit.
 */

const env = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
};

const number = (name: string, fallback: number): number => {
  const value = Number(env(name, String(fallback)));
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} is no number: ${process.env[name]}`);
  return value;
};

const flag = (name: string, fallback: boolean): boolean => /^(1|true|yes|on)$/i.test(env(name, fallback ? '1' : '0'));

export interface ProxyConfig {
  port: number;
  /** The Overpass interpreter behind the proxy */
  upstream: string;
  /** Pages that may read the answers (CORS); a foreign Origin is refused */
  origins: string[];
  /** A request without an Origin (no browser: a script, curl) passes */
  allowNoOrigin: boolean;
  /** Take the client's address and country from Cloudflare's headers (behind the tunnel) */
  trustCloudflare: boolean;
  /** Connections whose Cloudflare headers count (trusted.ts): the tunnel's connector */
  trustedProxies: string;
  maxEdgeKm: number;
  maxAreaKm2: number;
  maxTimeoutS: number;
  maxsizeBytes: number;
  maxBodyBytes: number;
  rateBurst: number;
  ratePerMinute: number;
  rateConcurrent: number;
  rateMaxClients: number;
  /** Queries running on Overpass at once (its FastCGI processes) */
  slots: number;
  queueMax: number;
  queueWaitMs: number;
  /** The SQLite file of the statistics; empty: none kept */
  statsDb: string;
  statsDays: number;
  /** While this file exists Overpass is down for a new clone: the proxy answers 503 at once */
  maintenanceFile: string;
}

export function proxyConfig(): ProxyConfig {
  return {
    port: number('PROXY_PORT', 8080),
    upstream: env('UPSTREAM', 'http://overpass/api/interpreter'),
    origins: env('ALLOWED_ORIGINS', 'https://3dtd.sgeht.net,app://app,http://localhost:4200')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    allowNoOrigin: flag('ALLOW_NO_ORIGIN', true),
    trustCloudflare: flag('TRUST_CLOUDFLARE', true),
    trustedProxies: env('TRUSTED_PROXIES', 'private'),
    maxEdgeKm: number('MAX_EDGE_KM', 5),
    maxAreaKm2: number('MAX_AREA_KM2', 30),
    maxTimeoutS: number('MAX_TIMEOUT_S', 90),
    maxsizeBytes: number('MAX_MAXSIZE_MB', 256) * 1024 * 1024,
    maxBodyBytes: number('MAX_BODY_KB', 256) * 1024,
    rateBurst: number('RATE_BURST', 20),
    ratePerMinute: number('RATE_PER_MINUTE', 30),
    rateConcurrent: number('RATE_CONCURRENT', 4),
    rateMaxClients: number('RATE_MAX_CLIENTS', 100_000),
    slots: number('OVERPASS_SLOTS', 8),
    queueMax: number('QUEUE_MAX', 32),
    queueWaitMs: number('QUEUE_WAIT_S', 20) * 1000,
    statsDb: env('STATS_DB', '/stats/requests.sqlite'),
    statsDays: number('STATS_DAYS', 30),
    maintenanceFile: env('MAINTENANCE_FILE', '/shared/maintenance'),
  };
}

export interface StatusConfig {
  port: number;
  statsDb: string;
  /** Overpass's API on the internal network, for its /status and /timestamp */
  overpassApi: string;
  /** The data directory of Overpass (mounted read-only), for its size and the disk */
  dbDir: string;
  /** Where the Overpass container leaves its memory figures */
  sharedDir: string;
}

export function statusConfig(): StatusConfig {
  return {
    port: number('STATUS_PORT', 8090),
    statsDb: env('STATS_DB', '/stats/requests.sqlite'),
    overpassApi: env('OVERPASS_API', 'http://overpass/api'),
    dbDir: env('OVERPASS_DATA', '/overpass'),
    sharedDir: env('SHARED_DIR', '/shared'),
  };
}
