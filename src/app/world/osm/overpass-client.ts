/**
 * The Overpass API as the game asks it: two EU servers in order, the next
 * asked alongside a server that is slow to start its answer, time limits for
 * the headers and the body, every failure sorted into one that may pass
 * (busy, out of reach, cut off) and one that will not, and the round of
 * servers asked again after a wait that grows while the failures may pass,
 * within a number of rounds and a time budget. A log line per attempt. The
 * street loads of the real places (OsmStreetService) and the OSM worlds
 * (world/osm) share it. Angular-free and DOM-free, so it runs in a Web Worker
 * and in Node.
 */

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

/**
 * The Overpass servers, asked in this order. Both sit in the EU: the
 * player's IP and the queried area reach whichever one answers, and the
 * mirror that used to be third was run by Mail.ru in Russia.
 * overpass-api.de comes first because it answers fastest; the one asked
 * first costs every load the hedge time when it hangs.
 * overpass.kumi.systems is a DNS alias of overpass.private.coffee, the same
 * server, so it is not listed apart.
 */
export const OVERPASS_SERVERS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

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
 * servers take.
 */
export const STREET_LIMITS: OverpassLimits = { headerTimeoutMs: 15000, bodyTimeoutMs: 30000, hedgeMs: 4000 };

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
 * The retries of the street loads: five rounds within 90 s, waits of about
 * 2, 4, 9 and 18 s between them. The public servers that sent a busy answer
 * on 2026-10-16 answered again minutes later; the budget is what a player
 * waits on a loading plate that says so.
 */
export const STREET_RETRY: OverpassRetryPolicy = { rounds: 5, budgetMs: 90_000, baseDelayMs: 3000, maxDelayMs: 24_000 };

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
  servers?: readonly string[];
  /** STREET_RETRY when absent */
  retry?: OverpassRetryPolicy;
  /** Hears each round that is about to be asked again */
  onRetry?: (retry: OverpassRetry) => void;
  /** Hears the bytes of an answer as they come (the body is then read as a stream) */
  onBytes?: (bytes: number) => void;
  /** Aborting ends every attempt and the wait; the promise rejects with an OverpassError of kind `cancelled` */
  signal?: AbortSignal;
  /** The jitter's draw, [0, 1); Math.random when absent */
  random?: () => number;
}

/** `[OSM] <what> from <host>: ...` for an answer: where its time went and what came */
function logOverpassAnswer(what: string, server: string, answer: OverpassAnswer): void {
  let ways = 0;
  let nodes = 0;
  for (const element of answer.data.elements) {
    if (element.type === 'way') ways++;
    else if (element.type === 'node') nodes++;
  }
  const remark = answer.data.remark ? ` remark="${answer.data.remark}"` : '';
  console.warn(
    `[OSM] ${what} from ${new URL(server).host}: headers=${answer.headersMs.toFixed(0)} body=${answer.bodyMs.toFixed(0)}ms ` +
    `size=${(answer.chars / 1e6).toFixed(1)}MB ways=${ways} nodes=${nodes}${remark}`,
  );
}

const cancelled = (): OverpassError => new OverpassError('The OSM download was cancelled', 'cancelled');

/** A round in which no server answered, with the failure of each server asked */
class RoundFailed extends Error {
  constructor(readonly failures: { server: string; error: OverpassError }[]) {
    super('No Overpass server answered');
  }
}

/** Any throw of an attempt as an OverpassError; a plain throw of `accept` is `rejected` */
function asOverpassError(error: unknown, fromAccept: boolean): OverpassError {
  if (error instanceof OverpassError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new OverpassError(message, fromAccept ? 'rejected' : 'network', { cause: error });
}

/** The failure of a whole load: what each server said in the last round, how many rounds */
function loadFailed(failures: { server: string; error: OverpassError }[], rounds: number): Error {
  const transient = failures.find((f) => f.error.transient);
  // Every server took the query and the caller refused each answer (no streets): say that, as it said it
  const rejected = failures.find((f) => f.error.kind === 'rejected');
  if (!transient && rejected) return rejected.error.cause instanceof Error ? rejected.error.cause : rejected.error;
  const said = failures.map((f) => `${new URL(f.server).host}: ${f.error.message}`).join('; ');
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
 * Post the request's query to the Overpass servers and return what `accept`
 * makes of the first answer it takes, asking again in rounds while the
 * failures may pass (OverpassRetryPolicy, STREET_RETRY by default). Round k
 * begins with the k-th server, so a server that failed first does not lead
 * the next round. Every failure is logged with its server, its time, its
 * kind and its try; every wait before a round with its length. Rejects with
 * an OverpassError naming what each server said in the last round, or with
 * `accept`'s own error where every server answered and `accept` refused each;
 * with kind `cancelled` when the signal aborts, in a round or in a wait.
 */
export async function fetchOverpass<T>(request: OverpassRequest<T>): Promise<T> {
  const { what, signal } = request;
  const servers = request.servers ?? OVERPASS_SERVERS;
  const policy = request.retry ?? STREET_RETRY;
  const random = request.random ?? Math.random;
  const start = Date.now();
  for (let round = 1; ; round++) {
    const k = (round - 1) % servers.length;
    const order = [...servers.slice(k), ...servers.slice(0, k)];
    try {
      return await askRound(request, order, round, policy.rounds);
    } catch (error) {
      if (!(error instanceof RoundFailed)) throw error;
      const transient = error.failures.filter((f) => f.error.transient);
      if (!transient.length || round >= policy.rounds) throw loadFailed(error.failures, round);
      const after = Math.max(retryDelayMs(round, policy, random()), ...transient.map((f) => f.error.retryAfterMs ?? 0));
      if (Date.now() - start + after > policy.budgetMs) {
        console.warn(`[OSM] ${what}: no time left to ask again (${((Date.now() - start) / 1000).toFixed(0)}s of ${policy.budgetMs / 1000}s, next wait ${(after / 1000).toFixed(1)}s)`);
        throw loadFailed(error.failures, round);
      }
      const retry: OverpassRetry = { attempt: round + 1, of: policy.rounds, waitMs: after, kind: transient[0].error.kind };
      console.warn(`[OSM] ${what}: no server answered (${retry.kind}), trying again in ${(after / 1000).toFixed(1)}s (try ${retry.attempt} of ${retry.of})`);
      request.onRetry?.(retry);
      await wait(after, signal);
    }
  }
}

/**
 * One round: the servers asked in order. One that fails, does not start its
 * answer within the header limit, does not finish it within the body limit
 * after that or whose answer `accept` throws on hands over to the next at
 * once. One that has not started its answer after the hedge time gets the
 * next asked alongside it, so a server that waits out its limit no longer
 * holds the others back that long; the first answer taken aborts the rest.
 * Rejects with RoundFailed when none answered.
 */
function askRound<T>(request: OverpassRequest<T>, servers: readonly string[], round: number, rounds: number): Promise<T> {
  const { what, query, accept, signal } = request;
  const limits = request.limits ?? STREET_LIMITS;
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    const failures: { server: string; error: OverpassError }[] = [];
    let asked = 0;
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
      if (done || asked >= servers.length) return;
      const server = servers[asked++];
      const controller = new AbortController();
      controllers.push(controller);
      const start = performance.now();
      const hedge = setTimeout(askNext, limits.hedgeMs);
      let answered = false;
      const attempt = async (): Promise<T> => {
        const answer = await askOverpass(server, query, controller, limits, () => clearTimeout(hedge), request.onBytes);
        logOverpassAnswer(what, server, answer);
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
          // A server aborted because another answered first
          if (done) return;
          const error = asOverpassError(thrown, answered);
          const tries = rounds > 1 ? ` (try ${round} of ${rounds})` : '';
          console.warn(
            `[OSM] ${what} from ${new URL(server).host} failed after ${(performance.now() - start).toFixed(0)}ms${tries}: ${error.kind}, ${error.message}`,
          );
          failures.push({ server, error });
          if (asked < servers.length) {
            askNext();
          } else if (failures.length === asked) {
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
