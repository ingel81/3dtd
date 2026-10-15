/**
 * The Overpass API as the game asks it: two EU servers in order, the next
 * asked alongside a server that is slow to start its answer, time limits for
 * the headers and the body, a log line per attempt. The street loads of the
 * real places (OsmStreetService) and the OSM worlds (world/osm) share it.
 * Angular-free and DOM-free, so it runs in a Web Worker and in Node.
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

export interface OverpassRequest<T> {
  /** What is loaded, for the log */
  what: string;
  query: string;
  /** Makes the result of an answer; a throw hands over to the next server */
  accept: (data: OverpassResponse, chars: number) => T;
  limits?: OverpassLimits;
  servers?: readonly string[];
  /** Aborting ends every attempt; the promise rejects with the abort's reason */
  signal?: AbortSignal;
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

/**
 * Post the request's query to the Overpass servers and return what `accept`
 * makes of the first answer it takes. The servers are asked in order. One
 * that fails (a 429 too: its slots for this IP are taken), does not start
 * its answer within the header limit, does not finish it within the body
 * limit after that or whose answer `accept` throws on hands over to the next
 * at once. One that has not started its answer after the hedge time gets the
 * next asked alongside it, so a server that waits out its limit no longer
 * holds the others back that long; the first answer taken aborts the rest.
 * Every attempt is logged: an answer with the time to its headers and on to
 * the end of its body, its size and what came (logOverpassAnswer), a failure
 * with its time and reason. So a slow load shows whether a server was slow
 * to start or its answer was long. Rejects with the last error when none
 * answered.
 */
export function fetchOverpass<T>(request: OverpassRequest<T>): Promise<T> {
  const { what, query, accept, signal } = request;
  const servers = request.servers ?? OVERPASS_SERVERS;
  const limits = request.limits ?? STREET_LIMITS;
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    let asked = 0;
    let failed = 0;
    let done = false;

    const onAbort = (): void => {
      if (done) return;
      done = true;
      for (const controller of controllers) controller.abort();
      reject(new Error('The OSM download was cancelled'));
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
      const attempt = async (): Promise<T> => {
        const answer = await askOverpass(server, query, controller, limits, () => clearTimeout(hedge));
        logOverpassAnswer(what, server, answer);
        return accept(answer.data, answer.chars);
      };
      attempt().then(
        (result) => {
          if (done) return;
          finish();
          for (const other of controllers) if (other !== controller) other.abort();
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(hedge);
          // A server aborted because another answered first
          if (done) return;
          const reason = error instanceof Error ? error : new Error(String(error));
          console.warn(
            `[OSM] ${what} from ${new URL(server).host} failed after ${(performance.now() - start).toFixed(0)}ms: ${reason.message}`,
          );
          failed++;
          if (asked < servers.length) {
            askNext();
          } else if (failed === asked) {
            finish();
            reject(reason);
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
 */
async function askOverpass(
  server: string,
  query: string,
  controller: AbortController,
  limits: OverpassLimits,
  onHeaders: () => void,
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
    throw timedOut ? new Error(`no answer within ${limits.headerTimeoutMs}ms`) : error;
  } finally {
    clearTimeout(timeoutId);
  }

  onHeaders();
  const headersAt = performance.now();
  if (!response.ok) {
    throw new Error(`OSM API error: ${response.status}`);
  }
  const bodyTimeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.bodyTimeoutMs);
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw timedOut ? new Error(`answer not complete within ${limits.bodyTimeoutMs}ms`) : error;
  } finally {
    clearTimeout(bodyTimeoutId);
  }
  return {
    data: JSON.parse(text) as OverpassResponse,
    chars: text.length,
    headersMs: headersAt - start,
    bodyMs: performance.now() - headersAt,
  };
}
