/**
 * The place a query asked for, by name: the middle of each answered box falls
 * into a cell of CELL_DEG; once per cell the proxy asks its own Overpass for
 * the places around the first middle seen there (place=city, town, village,
 * and suburb or quarter for the part of town) and keeps "Sanderau, Würzburg"
 * with the country from countries.ts. In the background: one question at a time, only while
 * Overpass has a slot to spare, a queue of a few hundred cells at most;
 * whatever fails stays nameless and is asked again after a while. The game's
 * queries never wait on it.
 */
import { countryAt } from './countries.ts';

/** Edge of a cell, degrees: about 5 km north to south */
export const CELL_DEG = 0.05;

/** The cell of a point: its south-west corner in cell units, `"995,199"` */
export function cellOf(lat: number, lon: number): string {
  // The small addition keeps a point on a cell's edge (9.95 / 0.05 = 198.99999…) in the cell it names
  return `${Math.floor(lat / CELL_DEG + 1e-9)},${Math.floor(lon / CELL_DEG + 1e-9)}`;
}

/** The middle of a cell */
export function cellCentre(cell: string): { lat: number; lon: number } {
  const [y, x] = cell.split(',').map(Number);
  return { lat: (y + 0.5) * CELL_DEG, lon: (x + 0.5) * CELL_DEG };
}

export interface PlaceName {
  /** "Sanderau, Würzburg", "Miltenberg"; null where no place was found */
  name: string | null;
  country: string | null;
}

interface PlaceNode {
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

const TOWN_WEIGHT: Record<string, number> = { city: 8, town: 3, village: 1 };
const PART = new Set(['suburb', 'quarter', 'neighbourhood', 'borough']);

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  Math.hypot((b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)), b.lat - a.lat) * 111.32;

/**
 * The name of the place at `at` from the place nodes around: the town that is
 * near for its size (a city counts eight times, a town three times as far as
 * a village), and the part of town in front where one lies within 1.5 km
 */
export function nameFrom(at: { lat: number; lon: number }, nodes: readonly PlaceNode[]): string | null {
  let town: PlaceNode | null = null;
  let townScore = Infinity;
  let part: PlaceNode | null = null;
  let partKm = 1.5;
  for (const node of nodes) {
    const name = node.tags['name'];
    if (!name) continue;
    const d = km(at, node);
    const weight = TOWN_WEIGHT[node.tags['place']];
    if (weight && d / weight < townScore) {
      town = node;
      townScore = d / weight;
    } else if (PART.has(node.tags['place']) && d < partKm) {
      part = node;
      partKm = d;
    }
  }
  const townName = town?.tags['name'] ?? null;
  const partName = part?.tags['name'] ?? null;
  if (partName && townName && partName !== townName) return `${partName}, ${townName}`;
  return townName ?? partName;
}

export interface PlaceResolverOptions {
  /** Overpass's interpreter on the internal network */
  upstream: string;
  /** Whether Overpass has a slot to spare now */
  idle: () => boolean;
  /** Takes each name found (or the empty answer) for the cell */
  store: (cell: string, place: PlaceName) => void;
  /** The cells named already, so they are not asked again */
  known: (cell: string) => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Cells waiting at most */
  maxQueue?: number;
  /** A failed cell is asked again after this, ms */
  retryMs?: number;
  log?: (line: string) => void;
}

/** Search radius around the cell's middle, m: far enough for a village in the fields */
const RADIUS_M = 12_000;

export class PlaceResolver {
  private readonly queue: string[] = [];
  /** Where each waiting cell was asked for first */
  private readonly at = new Map<string, { lat: number; lon: number }>();
  private readonly waiting = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private busy = false;
  private readonly o: Required<Omit<PlaceResolverOptions, 'fetchImpl' | 'log'>> & Pick<PlaceResolverOptions, 'fetchImpl' | 'log'>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PlaceResolverOptions) {
    this.o = { now: Date.now, maxQueue: 500, retryMs: 600_000, ...options };
  }

  /** Name the cell of an answered box some time, from `at` (the box's middle), unless it has its name or waits already */
  want(cell: string, at: { lat: number; lon: number } = cellCentre(cell)): void {
    if (this.waiting.has(cell) || this.o.known(cell)) return;
    const failed = this.failedAt.get(cell);
    if (failed !== undefined && this.o.now() - failed < this.o.retryMs) return;
    if (this.queue.length >= this.o.maxQueue) return;
    this.queue.push(cell);
    this.waiting.add(cell);
    this.at.set(cell, at);
    this.pump();
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Ask for the next cell, if any and if Overpass has a slot to spare; else look again in a while */
  private pump(): void {
    if (this.busy || !this.queue.length || this.timer) return;
    if (!this.o.idle()) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, 2000);
      this.timer.unref?.();
      return;
    }
    const cell = this.queue.shift()!;
    this.busy = true;
    const at = this.at.get(cell) ?? cellCentre(cell);
    this.at.delete(cell);
    this.resolve(at)
      .then(
        (place) => {
          this.o.store(cell, place);
          this.failedAt.delete(cell);
        },
        (error: unknown) => {
          this.failedAt.set(cell, this.o.now());
          this.o.log?.(`places: ${cell} not named: ${error instanceof Error ? error.message : String(error)}`);
        },
      )
      .finally(() => {
        this.waiting.delete(cell);
        this.busy = false;
        this.pump();
      });
  }

  /** The name of the place at `at`, from the place nodes around */
  async resolve(at: { lat: number; lon: number }): Promise<PlaceName> {
    const query =
      `[out:json][timeout:10][maxsize:16777216];` +
      `node(around:${RADIUS_M},${at.lat.toFixed(4)},${at.lon.toFixed(4)})` +
      `["place"~"^(city|town|village|suburb|quarter|neighbourhood|borough)$"]["name"];out body qt;`;
    const response = await (this.o.fetchImpl ?? fetch)(this.o.upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { elements?: { lat?: number; lon?: number; tags?: Record<string, string> }[] };
    const nodes: PlaceNode[] = (data.elements ?? [])
      .filter((e) => typeof e.lat === 'number' && typeof e.lon === 'number' && e.tags)
      .map((e) => ({ lat: e.lat!, lon: e.lon!, tags: e.tags! }));
    return { name: nameFrom(at, nodes), country: countryAt(at.lat, at.lon) };
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this.at.clear();
  }
}
