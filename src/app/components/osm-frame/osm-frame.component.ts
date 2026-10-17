import { ChangeDetectionStrategy, Component, ElementRef, InjectionToken, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import type { MapSummary } from '../../world/custom-map/map-store';
import { sketchMapPicture } from '../../world/custom-map/map-sketch';
import { MAP_STORE } from '../../world/world-choice.service';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import type { CatalogObject } from '../../world/custom-map/render/asset-catalog';
import { buildingCatalog } from '../../world/osm/convert/buildings';
import { assetCosts } from '../../world/osm/convert/vegetation';
import { OSM_SPAWNS, OSM_WORLD_SIDE, osmMapNames, type OsmImportReport } from '../../world/osm/import-osm';
import type { FrameSpawn, GeoPoint, OsmFrameInfo, OsmOpenRequest, OsmStep } from '../../world/osm/osm-frame-core';
import { fitArea, OSM_HQ_EDGE_M, OSM_MIN_SIDE, sameArea, type OsmArea } from '../../world/osm/osm-area';
import { OSM_CANCELLED, OsmFrameSession } from '../../world/osm/osm-frame-session';
import { overpassRetryText, type OverpassRetry } from '../../world/osm/overpass-client';
import { OsmFrameMap } from './osm-frame-map';
import type { OsmFramePlace } from './osm-frame-request';

/** Makes the frame's line to the OSM worker; a spec hands in one on the calling thread */
export const OSM_FRAME_SESSION = new InjectionToken<() => OsmFrameSession>('OSM_FRAME_SESSION', {
  providedIn: 'root',
  factory: () => () => new OsmFrameSession(),
});

/** Most spawns a frame lays out */
export const OSM_FRAME_MAX_SPAWNS = 8;

/** What a step reads as in the progress line, in the order they come */
const STEPS: readonly { step: OsmStep | 'save'; text: string }[] = [
  { step: 'parse', text: 'Reading the OpenStreetMap data' },
  { step: 'terrain', text: 'Ground from the heights' },
  { step: 'roads', text: 'Streets and bridges' },
  { step: 'water', text: 'Rivers, lakes and the coast' },
  { step: 'level', text: 'Levelling the ground under the streets' },
  { step: 'ground', text: 'Painting the land' },
  { step: 'shores', text: 'Painting the shores' },
  { step: 'paint', text: 'Painting the road surfaces' },
  { step: 'layout', text: 'HQ and spawns' },
  { step: 'buildings', text: 'Buildings' },
  { step: 'furniture', text: 'Fences, walls, tracks and lamps' },
  { step: 'plants', text: 'Forests and trees' },
  { step: 'pack', text: 'Packing the map' },
  { step: 'save', text: 'Saving' },
];

type Phase = 'loading' | 'ready' | 'failed' | 'making' | 'made';

/** Seconds of the first answer after which the frame says it is still waiting, and offers to ask again */
const SLOW_S = 8;
const RETRY_NOW_S = 15;

/**
 * The frame of an OSM world (docs/OSM_WORLD_PLAN.md, O2): a flat map of the
 * place with the map's square (2.4 km round the place at first, moved by its
 * edge and sized by its corners, E209), the HQ on the place and the spawns,
 * drawn as on a real place and dragged to other streets, then the making
 * in the OSM worker with its steps and a Cancel, and the map stored as an
 * own map. The menu plays it or opens it in the editor; the editor opens it.
 * The place's data loads once per frame (OsmFrameSession, frame store).
 */
@Component({
  selector: 'app-osm-frame',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './osm-frame.component.html',
  styleUrl: './osm-frame.component.scss',
  host: { class: 'td-stack is-loose' },
})
export class OsmFrameComponent implements OnInit, OnDestroy {
  private readonly store = inject(MAP_STORE);

  readonly place = input.required<OsmFramePlace>();
  /** Spawns to start from (a running real place's); drawn as on a real place when empty */
  readonly spawnsAt = input<readonly GeoPoint[]>([]);
  /** Where the frame stands: the menu offers Play and Edit, the editor opens the map */
  readonly context = input<'menu' | 'editor'>('menu');

  readonly back = output<void>();
  /** The map made and stored, and what the player wants with it */
  readonly done = output<{ summary: MapSummary; then: 'play' | 'edit' }>();

  /** The map's square as it stands (laid out by the worker); null before the place is open */
  readonly area = signal<OsmArea | null>(null);
  readonly sideKm = computed(() => ((this.area()?.sideM ?? OSM_WORLD_SIDE) / 1000).toFixed(1));
  readonly sideLimits = `${OSM_MIN_SIDE / 1000} to ${OSM_WORLD_SIDE / 1000} km`;
  readonly hqEdge = OSM_HQ_EDGE_M;
  readonly maxSpawns = OSM_FRAME_MAX_SPAWNS;
  readonly phase = signal<Phase>('loading');
  /** The step under way while loading or making */
  readonly step = signal<OsmStep | 'save' | null>(null);
  readonly error = signal<string | null>(null);
  /** The OSM servers are asked again while loading: which round of how many (overpass-client.ts) */
  readonly retry = signal<OverpassRetry | null>(null);
  readonly frame = signal<OsmFrameInfo | null>(null);
  readonly spawns = signal<FrameSpawn[]>([]);
  /** The spawn the list and the map point at */
  readonly selected = signal<number | null>(null);
  /** Why the last drop or draw did not take, under the map */
  readonly dropNote = signal<string | null>(null);
  /** A call to the worker under way that is not a making (a drop, a draw) */
  readonly busy = signal(false);
  /** The flat map did not come (no WebGL, the style's server); the frame works without it */
  readonly mapProblem = signal<string | null>(null);
  readonly made = signal<{ summary: MapSummary; report: OsmImportReport } | null>(null);

  /** The clock while loading (twice a second): the wait before the next round, the time spent waiting */
  readonly now = signal(Date.now());
  /** When the load began, when the servers are asked again (a retry's wait over) */
  private loadStart = 0;
  private retryAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** The load under way; an older one that ends late (Try again now) changes nothing */
  private loadGen = 0;

  /** Seconds the load has waited so far */
  readonly waited = computed(() => Math.max(0, Math.floor((this.now() - this.loadStart) / 1000)));

  readonly loadingText = computed(() => {
    const retry = this.retry();
    if (retry) return overpassRetryText(retry, (this.retryAt - this.now()) / 1000);
    if (this.step() === 'stored') return 'Opening the streets kept from last time';
    // The first answer can take long (a busy server keeps the request open): the player sees it is still waiting
    if (this.waited() >= SLOW_S) return `Still waiting for the map server (${this.waited()} s)`;
    return 'Downloading the streets and heights of this place';
  });
  /** Ask again at once: offered while the servers are asked again, or when the first answer is slow */
  readonly canRetryNow = computed(() => !!this.retry() || (this.step() !== 'stored' && this.waited() >= RETRY_NOW_S));
  readonly makingStep = computed(() => {
    const k = Math.max(0, STEPS.findIndex((s) => s.step === this.step()));
    return { text: STEPS[k].text, index: k + 1, of: STEPS.length };
  });
  readonly fetchedOn = computed(() => {
    const at = this.frame()?.fetchedAt;
    return at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  });
  /** The credit line under the map: the data the map is made of */
  readonly credits = computed(() => {
    const dem = this.frame()?.dem;
    const heights = dem === 'aws' ? 'heights: Terrain Tiles (Mapzen, AWS)' : dem ? 'heights: Mapterhorn' : null;
    return ['Map data © OpenStreetMap contributors', heights].filter(Boolean).join(', ');
  });

  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');
  private readonly session = inject(OSM_FRAME_SESSION)();
  private map: OsmFrameMap | null = null;
  private making: AbortController | null = null;
  private loading: AbortController | null = null;
  private destroyed = false;

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopTicker();
    this.loading?.abort();
    this.making?.abort();
    this.session.dispose();
    this.map?.dispose();
  }

  /**
   * Loads the place's data (frame store or download) and lays out its spawns; with `area` again for the
   * square moved or sized on the map (E209): the spawns standing are kept where they fit, the rest drawn
   * anew. A new square that cannot load (the servers, Cancel) leaves the one before as it was.
   */
  async load(area?: OsmArea): Promise<void> {
    const gen = ++this.loadGen;
    const before = area ? this.frame() : null;
    this.phase.set('loading');
    this.error.set(null);
    this.dropNote.set(null);
    this.step.set(null);
    this.retry.set(null);
    this.loading = new AbortController();
    this.loadStart = Date.now();
    this.now.set(this.loadStart);
    this.stopTicker();
    this.ticker = setInterval(() => this.now.set(Date.now()), 500);
    const place = this.place();
    const standing = before ? this.spawns().map(({ lat, lon }) => ({ lat, lon })) : [];
    const request: OsmOpenRequest = before
      ? { place: { lat: place.lat, lon: place.lon, address: place.address }, count: Math.max(1, standing.length), spawnsAt: standing, topUp: true, area }
      : { place: { lat: place.lat, lon: place.lon, address: place.address }, count: OSM_SPAWNS, spawnsAt: [...this.spawnsAt()] };
    try {
      const frame = await this.session.open(request, (step) => this.step.set(step), this.loading.signal, (retry) => {
        if (gen !== this.loadGen) return;
        this.retryAt = Date.now() + retry.waitMs;
        this.retry.set(retry);
      });
      if (this.destroyed || gen !== this.loadGen) return;
      this.frame.set(frame);
      this.area.set(frame.area);
      this.spawns.set(frame.spawns);
      this.selected.set(null);
      this.phase.set('ready');
      if (!frame.hq) this.error.set('This place has no streets in OpenStreetMap: enemies would have nowhere to walk.');
      else if (!frame.spawns.length) this.error.set('No street 500 to 1000 m from the HQ has a route to it. Try a place nearby.');
      else if (before && standing.some((p) => !frame.spawns.some((s) => Math.abs(s.lat - p.lat) < 2e-5 && Math.abs(s.lon - p.lon) < 3e-5))) {
        this.dropNote.set('Spawns that no longer fit in the square were drawn anew.');
      }
      // The map's box exists once the phase is ready; a map that stands shows the new square
      if (this.map) this.redraw();
      else setTimeout(() => void this.showMap());
    } catch (e) {
      if (this.destroyed || gen !== this.loadGen) return;
      const message = (e as Error).message;
      if (before) {
        // The square goes back: the worker keeps what was laid out before (OsmFrameSession.open)
        this.phase.set('ready');
        this.error.set(message === OSM_CANCELLED ? null : `The new square did not load: ${message}`);
        this.redraw();
      } else {
        this.phase.set('failed');
        this.error.set(message === OSM_CANCELLED ? 'Cancelled.' : message);
      }
    } finally {
      if (gen === this.loadGen) {
        this.loading = null;
        this.retry.set(null);
        this.stopTicker();
      }
    }
  }

  cancelLoad(): void {
    this.loading?.abort();
  }

  /** Drops the load under way and asks the servers anew, without the wait */
  retryNow(): void {
    this.loading?.abort();
    void this.load();
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** The flat map, MapLibre loaded on first use */
  private async showMap(): Promise<void> {
    const host = this.mapHost()?.nativeElement;
    const area = this.area();
    if (!host || !area || this.map || this.destroyed) return;
    try {
      const map = await OsmFrameMap.open(host, this.place(), area, {
        drop: (index, at) => void this.dropSpawn(index, at),
        select: (index) => this.select(index),
        problem: (text) => this.mapProblem.set(text),
        fit: (area) => fitArea(area, this.place()),
        canReframe: () => this.phase() === 'ready' && !this.busy(),
        reframe: (area) => this.reframe(area),
      });
      if (this.destroyed) {
        map.dispose();
        return;
      }
      this.map = map;
      this.redraw();
    } catch (e) {
      this.mapProblem.set(`The map did not load (${(e as Error).message}). The spawns still work from the list.`);
    }
  }

  private redraw(): void {
    this.map?.show({ hq: this.frame()?.hq ?? null, spawns: this.spawns(), selected: this.selected(), area: this.area() });
  }

  /** The square moved or sized on the map and let go: laid out anew there, its data loaded if it reaches past what is in hand */
  reframe(area: OsmArea): void {
    const now = this.area();
    if (now && sameArea(now, area)) {
      this.redraw();
      return;
    }
    void this.load(area);
  }

  select(index: number | null): void {
    this.selected.set(index);
    this.redraw();
  }

  /** A spawn dragged on the map: onto the foot of its street, or back where it stood with the reason */
  async dropSpawn(index: number, at: GeoPoint): Promise<void> {
    this.busy.set(true);
    try {
      const dropped = await this.session.drop(at);
      if ('reason' in dropped) {
        this.dropNote.set(`${dropped.reason}: the spawn stays where it was.`);
      } else {
        this.dropNote.set(null);
        this.spawns.update((list) => list.map((s, k) => (k === index ? dropped : s)));
        this.selected.set(index);
      }
    } catch (e) {
      this.dropNote.set((e as Error).message);
    } finally {
      this.busy.set(false);
      this.redraw();
    }
  }

  /** Every spawn drawn anew */
  async rollAll(): Promise<void> {
    await this.drawing(() => this.session.draw(Math.max(1, this.spawns().length), []));
  }

  /** One spawn drawn anew, apart from the others */
  async rollOne(index: number): Promise<void> {
    await this.drawing(async () => {
      const [next] = await this.session.draw(1, this.spawns().filter((_, k) => k !== index));
      if (!next) this.dropNote.set('No other street 500 to 1000 m out has room for a spawn.');
      return next ? this.spawns().map((s, k) => (k === index ? next : s)) : this.spawns();
    });
  }

  async addSpawn(): Promise<void> {
    await this.drawing(async () => {
      const [next] = await this.session.draw(1, this.spawns());
      if (!next) this.dropNote.set('No other street 500 to 1000 m out has room for a spawn.');
      return next ? [...this.spawns(), next] : this.spawns();
    });
  }

  removeSpawn(index: number): void {
    this.spawns.update((list) => list.filter((_, k) => k !== index));
    this.selected.set(null);
    this.redraw();
  }

  private async drawing(work: () => Promise<FrameSpawn[]>): Promise<void> {
    this.busy.set(true);
    this.dropNote.set(null);
    try {
      this.spawns.set(await work());
      this.selected.set(null);
    } catch (e) {
      this.dropNote.set((e as Error).message);
    } finally {
      this.busy.set(false);
      this.redraw();
    }
  }

  /** Makes the map with the spawns as they stand and stores it */
  async make(): Promise<void> {
    if (!this.spawns().length) return;
    this.phase.set('making');
    this.error.set(null);
    this.step.set('parse');
    this.making = new AbortController();
    const signal = this.making.signal;
    try {
      const names = osmMapNames(this.place());
      const id = await this.store.freeId(names.id);
      const catalog = await catalogObjects();
      const made = await this.session.make(
        this.spawns(),
        { id, name: names.name, costs: catalog && assetCosts(catalog, this.area()?.sideM ?? OSM_WORLD_SIDE), catalog: catalog && buildingCatalog(catalog) },
        (step) => this.step.set(step),
        signal,
      );
      if (signal.aborted) throw new Error(OSM_CANCELLED);
      this.step.set('save');
      // A picture for the lists until the editor renders its own (docs/WORLDS_STATE_PLAN.md, 6)
      const preview = await sketchMapPicture(made.doc).catch(() => null);
      const summary = await this.store.save(made.doc, preview, made.file);
      console.warn(`[OSM world] ${summary.id}: made in ${made.convertMs} ms`, { download: this.frame()?.download, report: made.report });
      if (this.destroyed) return;
      this.made.set({ summary, report: made.report });
      this.phase.set('made');
    } catch (e) {
      if (this.destroyed) return;
      this.phase.set('ready');
      const message = (e as Error).message;
      this.error.set(message === OSM_CANCELLED ? null : `The map was not made: ${message}`);
    } finally {
      this.making = null;
    }
  }

  cancelMaking(): void {
    this.making?.abort();
  }

  finish(then: 'play' | 'edit'): void {
    const made = this.made();
    if (made) this.done.emit({ summary: made.summary, then });
  }

  /** "820 m out, route 1.1 km" */
  spawnLine(s: FrameSpawn): string {
    const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
    return `${km(s.distanceM)} out, route ${km(s.routeM)}`;
  }

  /** What the made map holds, in a line */
  reportLine(report: OsmImportReport): string {
    const r = report.roads;
    const spawns = report.layout.spawns.length;
    const built = report.buildings.placed;
    return `${Math.round(r.km.road + r.km.bridge)} km of road, ${Math.round(r.km.path)} km of paths, ` +
      `${r.bridges} ${r.bridges === 1 ? 'bridge' : 'bridges'}, ${built} ${built === 1 ? 'building' : 'buildings'}, ${spawns} ${spawns === 1 ? 'spawn' : 'spawns'}`;
  }
}

/**
 * The renderer's catalogue objects for the plants' scene costs and the
 * buildings' models; none where it cannot be read (the import then counts
 * plants dear and places every building model without a budget)
 */
async function catalogObjects(): Promise<readonly CatalogObject[] | undefined> {
  try {
    const objects = (await MapAssetLibrary.shared().catalog()).objects;
    return objects.length ? objects : undefined;
  } catch {
    return undefined;
  }
}
