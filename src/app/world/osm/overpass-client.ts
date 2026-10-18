/**
 * The Overpass API as the game asks it: the servers that hold the query's box
 * (overpass-servers.ts), regional ones first, in the order of their recent
 * health (overpass-health.ts); the next asked alongside a server that is slow
 * to start its answer, at most two at once; time limits for the headers and
 * the body, every failure sorted into one that may pass (busy, out of reach,
 * cut off) and one that will not, a server that asks for a pause left alone
 * for it, and the round of servers asked again, from another server, after a
 * wait that grows while the failures may pass, within a number of rounds and
 * a time budget. A log line per attempt. The street loads of the real places
 * (OsmStreetService) and the OSM worlds (world/osm) share it. Angular-free
 * and DOM-free, so it runs in a Web Worker and in Node.
 */
import type { GeoBox } from '../../services/location/street-box';
import { overpassHealth, type OverpassHealth } from './overpass-health';
import { OVERPASS_SERVERS, serversFor, type OverpassServer } from './overpass-servers';

/** An element of an Overpass answer, as far as the parsers read it */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation' | string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  /** `out geom`: a way's points, one per node (null for a node cut off by the query's box) */
  geometry?: ({ lat: number; lon: number } | null)[];
  /** `out geom`: a relation's members, ways with their points */
  members?: OverpassMember[];
}

export interface OverpassMember {
  type: 'node' | 'way' | 'relation' | string;
  ref: number;
  role: string;
  lat?: number;
  lon?: number;
  geometry?: ({ lat: number; lon: number } | null)[];
}

/** An Overpass answer */
export interface OverpassResponse {
  elements: OverpassElement[];
  /** Set when the server ran into a limit (memory, time); the elements may be cut short then */
  remark?: string;
}

/** One answer of one Overpass server and how long it took */
interface OverpassAnswer {
  data: OverpassResponse;
  /** Length of the JSON text, about its bytes unpacked */
  chars: number;
  /** From the request to the headers, and from there to the end of the body */
  headersMs: number;
  bodyMs: number;
}

export interface OverpassLimits {
  /** Time a server gets to start its answer (the headers) before the attempt is aborted */
  headerTimeoutMs: number;
  /**
   * Time a server gets from its headers to the end of its body before the
   * attempt is aborted, so a server that starts its answer and then hangs
   * hands over to the next instead of holding the load up for good
   */
  bodyTimeoutMs: number;
  /** Time a server gets to start its answer before the next one is asked alongside it */
  hedgeMs: number;
}

/**
 * The limits of the street loads. The body limit is generous against a slow
 * but valid answer: the query itself runs at most 25 s on the server
 * (`[timeout:25]`) before any of it is sent. The hedge is an assumption, not
 * a measurement: a server that has not begun to answer after 4 s is taken
 * to be queueing the query. `headers=` in the `[OSM]` log shows what the
 * servers take. The header limit lets a server run the query to its own
 * limit and still answer: on 2026-10-18 maps.mail.ru began its answers
 * after 11 to 19 s and overpass.atownsend.org.uk one for London after more
 * than 15 s, which the former 15 s cut off every time.
 */
export const STREET_LIMITS: OverpassLimits = { headerTimeoutMs: 30_000, bodyTimeoutMs: 30_000, hedgeMs: 4000 };

/**
 * Why an attempt failed:
 * - `busy`: the server is at capacity (HTTP 429, 502, 503, 504, 406, 408, 425, or a 200 whose remark says it is too busy)
 * - `server`: it failed in itself (HTTP 500 and the other 5xx)
 * - `network`: no answer the page can read; a busy server's error page without a CORS header ends here too (status 0, TypeError)
 * - `timeout`: no headers, or no end of the body, within the limits
 * - `malformed`: the body is no Overpass answer (cut off, HTML, no `elements`)
 * - `refused`: the server refuses the query itself (HTTP 400 and the other 4xx)
 * - `rejected`: the caller's `accept` threw on the answer (no streets in it)
 * - `cancelled`: the caller's signal ended the load
 */
export type OverpassFailureKind = 'busy' | 'server' | 'network' | 'timeout' | 'malformed' | 'refused' | 'rejected' | 'cancelled';

/** The kinds that may pass when asked again a little later */
const TRANSIENT: ReadonlySet<OverpassFailureKind> = new Set(['busy', 'server', 'network', 'timeout', 'malformed']);

/** What a failed attempt, or a failed load, rejects with */
export class OverpassError extends Error {
  /** The kind may pass when asked again a little later */
  readonly transient: boolean;
  /** The HTTP status, where one came */
  readonly status?: number;
  /** The server's Retry-After, ms, where it sent one the page can read */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    readonly kind: OverpassFailureKind,
    options: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OverpassError';
    this.transient = TRANSIENT.has(kind);
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** The load was cancelled by the caller's signal */
export function isOverpassCancelled(error: unknown): boolean {
  return error instanceof OverpassError && error.kind === 'cancelled';
}

/** The kind of an HTTP status that is not ok */
export function httpFailureKind(status: number): OverpassFailureKind {
  if (status === 429 || status === 502 || status === 503 || status === 504) return 'busy';
  // overpass-api.de answers 406 when its queue is full; 408 and 425 ask to come back
  if (status === 406 || status === 408 || status === 425) return 'busy';
  if (status >= 500) return 'server';
  return 'refused';
}

/** A remark of a 200 that says the server was too busy to run the query, not that the query ran into its limits */
export function busyRemark(remark: string | undefined): boolean {
  return !!remark && /too busy|Dispatcher_Client|rate_limited/i.test(remark);
}

/** Retry-After as ms: seconds or an HTTP date; null when absent or unreadable */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * How often and how long a load asks again. A round asks every server
 * (hedged as above); a round where at least one failure may pass is
 * followed by a wait and the next round, up to `rounds`. The wait doubles
 * from `baseDelayMs` up to `maxDelayMs`, each drawn between half and all of
 * it (jitter, so the players a busy server sent away do not come back in
 * step), and is at least the server's Retry-After. No round starts past
 * `budgetMs` from the first; a round under way may end later.
 */
export interface OverpassRetryPolicy {
  rounds: number;
  budgetMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * The retries of the street loads: eight rounds within 3 min, waits of about
 * 1.5, 3, 6, 12 and then 15 s between them, so each of the three global
 * servers is asked up to eight times. On 2026-10-18 about one load in
 * fifteen got an answer from overpass-api.de and overpass.private.coffee
 * alone; the public servers that sent a busy answer answered again minutes
 * later. The budget is what a player waits on a loading plate that says so.
 */
export const STREET_RETRY: OverpassRetryPolicy = { rounds: 8, budgetMs: 180_000, baseDelayMs: 2000, maxDelayMs: 20_000 };

/** Requests of one load under way at once, at most: the servers give an IP few slots */
export const MAX_PARALLEL = 2;

/**
 * How long a server that answered 429 or 406 is left alone, at least: the
 * rule of overpass-api.de for a client it turned away. The other servers are
 * asked in the meantime.
 */
export const PAUSE_AFTER_REFUSAL_MS = 30_000;

/** One round, no retries */
export const NO_RETRY: OverpassRetryPolicy = { rounds: 1, budgetMs: 0, baseDelayMs: 0, maxDelayMs: 0 };

/** The wait after the failed round `round` (1-based); `random` in [0, 1) */
export function retryDelayMs(round: number, policy: OverpassRetryPolicy, random: number): number {
  const full = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (round - 1));
  return Math.round(full / 2 + (random * full) / 2);
}

/** A load asks again: the round it starts after `waitMs`, of how many, and why the last failed */
export interface OverpassRetry {
  attempt: number;
  of: number;
  waitMs: number;
  kind: OverpassFailureKind;
}

/** Why a round failed, as the player reads it */
const RETRY_REASON: Partial<Record<OverpassFailureKind, string>> = {
  busy: 'The map server is busy',
  network: 'The map server cannot be reached',
  timeout: 'The map server did not answer in time',
  server: 'The map server answered with an error',
  malformed: 'The map server sent a broken answer',
};

/**
 * What the player reads while a load asks again: why, and with `secondsLeft` the wait before the next round
 * (0 or less: the round is under way)
 */
export function overpassRetryText(retry: OverpassRetry, secondsLeft?: number): string {
  const why = RETRY_REASON[retry.kind] ?? RETRY_REASON.busy!;
  const round = `(${retry.attempt} of ${retry.of})`;
  if (secondsLeft === undefined) return `${why}, trying again ${round}`;
  return secondsLeft > 0 ? `${why}, trying again in ${Math.ceil(secondsLeft)} s ${round}` : `${why}, asking again ${round}`;
}

export interface OverpassRequest<T> {
  /** What is loaded, for the log */
  what: string;
  query: string;
  /** Makes the result of an answer; a throw hands over to the next server and counts as `rejected` */
  accept: (data: OverpassResponse, chars: number) => T;
  limits?: OverpassLimits;
  /** The box the query reads; a regional server is asked only when it lies inside its region, none when absent */
  box?: GeoBox;
  /** OVERPASS_SERVERS when absent */
  servers?: readonly OverpassServer[];
  /** overpassHealth, the realm's, when absent */
  health?: OverpassHealth;
  /** STREET_RETRY when absent */
  retry?: OverpassRetryPolicy;
  /** Hears each round that is about to be asked again */
  onRetry?: (retry: OverpassRetry) => void;
  /** Hears the bytes of an answer as they come (the body is then read as a stream) */
  onBytes?: (bytes: number) => void;
  /** Hears each server as it is asked, by its host (a sign of life while a round waits on slow servers) */
  onAsk?: (host: string) => void;
  /** Aborting ends every attempt and the wait; the promise rejects with an OverpassError of kind `cancelled` */
  signal?: AbortSignal;
  /** The jitter's draw, [0, 1); Math.random when absent */
  random?: () => number;
}

const host = (server: OverpassServer): string => new URL(server.url).host;

/** `[OSM] <what> from <host>: ...` for an answer: where its time went and what came */
function logOverpassAnswer(what: string, server: OverpassServer, answer: OverpassAnswer): void {
  let ways = 0;
  let nodes = 0;
  for (const element of answer.data.elements) {
    if (element.type === 'way') ways++;
    else if (element.type === 'node') nodes++;
  }
  const remark = answer.data.remark ? ` remark="${answer.data.remark}"` : '';
  console.warn(
    `[OSM] ${what} from ${host(server)}: headers=${answer.headersMs.toFixed(0)} body=${answer.bodyMs.toFixed(0)}ms ` +
    `size=${(answer.chars / 1e6).toFixed(1)}MB ways=${ways} nodes=${nodes}${remark}`,
  );
}

const cancelled = (): OverpassError => new OverpassError('The OSM download was cancelled', 'cancelled');

interface Failure {
  server: OverpassServer;
  error: OverpassError;
}

/** A round in which no server answered, with the failure of each server asked */
class RoundFailed extends Error {
  constructor(readonly failures: Failure[]) {
    super('No Overpass server answered');
  }
}

/** Any throw of an attempt as an OverpassError; a plain throw of `accept` is `rejected` */
function asOverpassError(error: unknown, fromAccept: boolean): OverpassError {
  if (error instanceof OverpassError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new OverpassError(message, fromAccept ? 'rejected' : 'network', { cause: error });
}

/**
 * The failure of a whole load: what each server said in the last round, how
 * many rounds. A regional server without data for the box (`empty`) is named
 * only where no other server said anything.
 */
function loadFailed(all: Failure[], rounds: number, empty: ReadonlySet<string>): Error {
  const named = all.filter((f) => !empty.has(f.server.url));
  const failures = named.length ? named : all;
  const transient = failures.find((f) => f.error.transient);
  // Every server took the query and the caller refused each answer (no streets): say that, as it said it
  const rejected = failures.find((f) => f.error.kind === 'rejected');
  if (!transient && rejected) return rejected.error.cause instanceof Error ? rejected.error.cause : rejected.error;
  const said = failures.map((f) => `${host(f.server)}: ${f.error.message}`).join('; ');
  const lead = (transient ?? failures[0]).error;
  return new OverpassError(`${said}${rounds > 1 ? `; ${rounds} tries` : ''}`, lead.kind, { status: lead.status, cause: lead });
}

/** Resolves after `ms`; rejects at once when `signal` aborts */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Post the request's query to the Overpass servers that hold its box and
 * return what `accept` makes of the first answer it takes, asking again in
 * rounds while the failures may pass (OverpassRetryPolicy, STREET_RETRY by
 * default). Each round orders the servers by their health (OverpassHealth:
 * a paused one left out, one that failed lately behind the others, regional
 * before global) and begins with the k-th of them in round k, so a server
 * that failed first does not lead the next round. A regional server that
 * answers with no element has no data for the box and is not asked again in
 * this load. Every failure is logged with its server, its time, its kind and
 * its try; every wait before a round with its length. Rejects with an
 * OverpassError naming what each server said in the last round, or with
 * `accept`'s own error where every server answered and `accept` refused each;
 * with kind `cancelled` when the signal aborts, in a round or in a wait.
 */
export async function fetchOverpass<T>(request: OverpassRequest<T>): Promise<T> {
  const { what, signal } = request;
  const policy = request.retry ?? STREET_RETRY;
  const random = request.random ?? Math.random;
  const health = request.health ?? overpassHealth;
  const candidates = serversFor(request.servers ?? OVERPASS_SERVERS, request.box);
  if (!candidates.length) throw new OverpassError('no Overpass server holds this area', 'refused');
  /** Regional servers without data for the box, not asked again */
  const empty = new Set<string>();
  const left = (): OverpassServer[] => candidates.filter((s) => !empty.has(s.url));
  const start = Date.now();
  for (let round = 1; ; round++) {
    const ordered = health.order(left());
    let ready = ordered.filter((s) => !health.pausedUntil(s.url));
    if (!ready.length) {
      const ms = Math.max(0, Math.min(...ordered.map((s) => health.pausedUntil(s.url))) - Date.now());
      console.warn(`[OSM] ${what}: every server asked for a pause, waiting ${(ms / 1000).toFixed(1)}s`);
      await wait(ms, signal);
      ready = ordered;
    }
    const k = (round - 1) % ready.length;
    const order = [...ready.slice(k), ...ready.slice(0, k)];
    try {
      return await askRound(request, { servers: order, round, rounds: policy.rounds, health, empty });
    } catch (error) {
      if (!(error instanceof RoundFailed)) throw error;
      const transient = error.failures.filter((f) => f.error.transient);
      if (!transient.length || round >= policy.rounds || !left().length) throw loadFailed(error.failures, round, empty);
      // The jitter's wait; longer only where every server left asked for a longer pause
      const pausedFor = Math.min(...left().map((s) => health.pausedUntil(s.url))) - Date.now();
      const after = Math.max(retryDelayMs(round, policy, random()), pausedFor);
      if (Date.now() - start + after > policy.budgetMs) {
        console.warn(`[OSM] ${what}: no time left to ask again (${((Date.now() - start) / 1000).toFixed(0)}s of ${policy.budgetMs / 1000}s, next wait ${(after / 1000).toFixed(1)}s)`);
        throw loadFailed(error.failures, round, empty);
      }
      const retry: OverpassRetry = { attempt: round + 1, of: policy.rounds, waitMs: after, kind: transient[0].error.kind };
      console.warn(`[OSM] ${what}: no server answered (${retry.kind}), trying again in ${(after / 1000).toFixed(1)}s (try ${retry.attempt} of ${retry.of})`);
      request.onRetry?.(retry);
      await wait(after, signal);
    }
  }
}

/** What a round needs besides the request */
interface Round {
  /** In the order they are asked */
  servers: readonly OverpassServer[];
  round: number;
  rounds: number;
  health: OverpassHealth;
  /** Takes the regional servers that had no data for the box */
  empty: Set<string>;
}

/**
 * One round: the servers asked in order, at most MAX_PARALLEL at once. One
 * that fails, does not start its answer within the header limit, does not
 * finish it within the body limit after that or whose answer `accept` throws
 * on hands over to the next at once. One that has not started its answer
 * after the hedge time gets the next asked alongside it, so a server that
 * waits out its limit no longer holds the others back that long; the first
 * answer taken aborts the rest. Each attempt goes into the health: an answer,
 * a failure that may pass, and for a 429 or 406 a pause of
 * PAUSE_AFTER_REFUSAL_MS or the server's Retry-After, whichever is longer
 * (Retry-After alone for the other statuses). Rejects with RoundFailed when
 * none answered.
 */
function askRound<T>(request: OverpassRequest<T>, { servers, round, rounds, health, empty }: Round): Promise<T> {
  const { what, query, accept, signal } = request;
  const limits = request.limits ?? STREET_LIMITS;
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    const failures: Failure[] = [];
    let asked = 0;
    let inFlight = 0;
    let done = false;

    const onAbort = (): void => {
      if (done) return;
      done = true;
      for (const controller of controllers) controller.abort();
      reject(cancelled());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (): void => {
      done = true;
      signal?.removeEventListener('abort', onAbort);
    };

    const askNext = (): void => {
      if (done || asked >= servers.length || inFlight >= MAX_PARALLEL) return;
      const server = servers[asked++];
      inFlight++;
      const controller = new AbortController();
      controllers.push(controller);
      const start = performance.now();
      const hedge = setTimeout(askNext, limits.hedgeMs);
      request.onAsk?.(host(server));
      let answered = false;
      const attempt = async (): Promise<T> => {
        const answer = await askOverpass(server.url, query, controller, limits, () => clearTimeout(hedge), request.onBytes);
        logOverpassAnswer(what, server, answer);
        if (server.coverage && answer.data.elements.length === 0) {
          empty.add(server.url);
          throw new OverpassError('no data for this area', 'rejected');
        }
        health.record(server.url, true, performance.now() - start);
        answered = true;
        return accept(answer.data, answer.chars);
      };
      attempt().then(
        (result) => {
          if (done) return;
          finish();
          for (const other of controllers) if (other !== controller) other.abort();
          resolve(result);
        },
        (thrown: unknown) => {
          clearTimeout(hedge);
          inFlight--;
          // A server aborted because another answered first
          if (done) return;
          const error = asOverpassError(thrown, answered);
          const ms = performance.now() - start;
          if (error.transient) health.record(server.url, false, ms);
          if (error.status === 429 || error.status === 406) health.pause(server.url, Math.max(PAUSE_AFTER_REFUSAL_MS, error.retryAfterMs ?? 0));
          else if (error.retryAfterMs) health.pause(server.url, error.retryAfterMs);
          const tries = rounds > 1 ? ` (try ${round} of ${rounds})` : '';
          console.warn(`[OSM] ${what} from ${host(server)} failed after ${ms.toFixed(0)}ms${tries}: ${error.kind}, ${error.message}`);
          failures.push({ server, error });
          if (asked < servers.length) {
            askNext();
          } else if (inFlight === 0) {
            finish();
            reject(new RoundFailed(failures));
          }
        },
      );
    };
    askNext();
  });
}

/**
 * Post `query` to one Overpass server and read its answer. Aborted through
 * `controller`, and by itself when the headers or the body after them take
 * longer than their limits; `onHeaders` is called when the headers are there.
 * Every failure rejects with an OverpassError of its kind.
 */
async function askOverpass(
  server: string,
  query: string,
  controller: AbortController,
  limits: OverpassLimits,
  onHeaders: () => void,
  onBytes?: (bytes: number) => void,
): Promise<OverpassAnswer> {
  const start = performance.now();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.headerTimeoutMs);

  let response: Response;
  try {
    response = await fetch(server, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new OverpassError(`no answer within ${limits.headerTimeoutMs}ms`, 'timeout');
    // A busy server's error page without a CORS header reaches the page as this, not as its status
    throw new OverpassError(error instanceof Error ? error.message : String(error), 'network', { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }

  onHeaders();
  const headersAt = performance.now();
  if (!response.ok) {
    const after = retryAfterMs(response.headers?.get('Retry-After'));
    throw new OverpassError(`HTTP ${response.status}`, response.status === 0 ? 'network' : httpFailureKind(response.status), {
      status: response.status,
      ...(after !== null ? { retryAfterMs: after } : {}),
    });
  }
  const bodyTimeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.bodyTimeoutMs);
  let text: string;
  try {
    text = onBytes && response.body ? await readStream(response.body, onBytes) : await response.text();
  } catch (error) {
    if (timedOut) throw new OverpassError(`answer not complete within ${limits.bodyTimeoutMs}ms`, 'timeout');
    throw new OverpassError(`answer cut off (${error instanceof Error ? error.message : String(error)})`, 'network', { cause: error });
  } finally {
    clearTimeout(bodyTimeoutId);
  }
  let data: OverpassResponse;
  try {
    data = JSON.parse(text) as OverpassResponse;
  } catch {
    throw new OverpassError(`no JSON in the answer (${text.length} characters)`, 'malformed');
  }
  if (!data || !Array.isArray(data.elements)) throw new OverpassError('no elements in the answer', 'malformed');
  if (busyRemark(data.remark)) throw new OverpassError(`too busy: "${data.remark}"`, 'busy');
  return {
    data,
    chars: text.length,
    headersMs: headersAt - start,
    bodyMs: performance.now() - headersAt,
  };
}

/** A body read as it comes, `onBytes` told the bytes so far after each piece */
async function readStream(body: ReadableStream<Uint8Array>, onBytes: (bytes: number) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    parts.push(decoder.decode(value, { stream: true }));
    onBytes(bytes);
  }
  parts.push(decoder.decode());
  return parts.join('');
}
