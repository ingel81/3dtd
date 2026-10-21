import { ChangeDetectionStrategy, Component, ElementRef, InjectionToken, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import { BrickWallComponent } from '../brick-wall/brick-wall.component';
import type { MapSummary } from '../../world/custom-map/map-store';
import { pictureColours, type MapPictureColours } from '../../map-ops/map-picture';
import { MAP_STORE } from '../../world/world-choice.service';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import type { CatalogObject } from '../../world/custom-map/render/asset-catalog';
import { buildingCatalog } from '../../world/osm/convert/buildings';
import { assetCosts } from '../../world/osm/convert/vegetation';
import { lineAssets } from '../../world/custom-map/render/asset-catalog';
import { OSM_SPAWNS, OSM_WORLD_SIDE, osmMapNames, type OsmImportReport } from '../../world/osm/import-osm';
import type { FrameLandmark, FrameSpawn, GeoPoint, OsmFrameInfo, OsmOpenRequest } from '../../world/osm/osm-frame-core';
import { loadingRows, loadingView, makingView, reduceProgress, type OsmDetail, type OsmLoadRow, type OsmProgress, type OsmProgressState, type OsmStepStatus } from '../../world/osm/osm-progress';
import { fitArea, OSM_MIN_SIDE, OSM_SIDE_STEP, sameArea, type OsmArea } from '../../world/osm/osm-area';
import { OSM_CANCELLED, OsmFrameSession } from '../../world/osm/osm-frame-session';
import { overpassRetryText, type OverpassRetry } from '../../world/osm/overpass-client';
import { OsmFrameMap, type FrameMapView } from './osm-frame-map';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { OsmFramePlace } from './osm-frame-request';
import { injectT } from '../../i18n/i18n.service';
import { say } from '../../i18n/said';
import { osmErrorMessage } from '../../world/osm/osm-error';
import type { ImportNote } from '../../world/import-notes';

/** Makes the frame's line to the OSM worker; a spec hands in one on the calling thread */
export const OSM_FRAME_SESSION = new InjectionToken<() => OsmFrameSession>('OSM_FRAME_SESSION', {
  providedIn: 'root',
  factory: () => () => new OsmFrameSession(),
});

/** Most spawns a frame lays out */
export const OSM_FRAME_MAX_SPAWNS = 8;

type Phase = 'loading' | 'ready' | 'failed' | 'making' | 'made';

/** Seconds of the first answer after which the frame says it is still waiting, and offers to ask again */
const SLOW_S = 8;
const RETRY_NOW_S = 15;

/**
 * The frame of an OSM world (docs/OSM_WORLD_PLAN.md, O2): a flat map of the
 * place under the map's square, which stands still in its middle (E282): the
 * map is dragged under it (or moved by the arrows), the slider under it sets
 * the side (2.4 km round the place at first). The HQ stands in the square's
 * middle: on the address at first, on a landmark near it the player picks
 * (a church, the town hall, a gate; docs/OSM_WORLD_ROUND2_PLAN.md, P5), or
 * where the map was dragged to. The spawns are drawn as on a real place and
 * dragged to other streets, then the making in the OSM worker with its steps
 * and a Cancel, and the map stored as an own map. The menu plays it or opens
 * it in the editor; the editor opens it. The place's data loads once per
 * frame (OsmFrameSession, frame store); a load shows as a veil in the square,
 * so nothing above or round the map moves.
 */
@Component({
  selector: 'app-osm-frame',
  standalone: true,
  imports: [TdIconComponent, BrickWallComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './osm-frame.component.html',
  styleUrl: './osm-frame.component.scss',
  host: { class: 'td-stack is-loose' },
})
export class OsmFrameComponent implements OnInit, OnDestroy {
  protected readonly t = injectT();
  private readonly store = inject(MAP_STORE);

  readonly place = input.required<OsmFramePlace>();
  /** Spawns to start from (a running real place's); drawn as on a real place when empty */
  readonly spawnsAt = input<readonly GeoPoint[]>([]);
  /** Where the frame stands: the menu offers Play and Edit, the editor opens the map */
  readonly context = input<'menu' | 'editor'>('menu');

  /** Its own Back above the frame; off where the panel around it has one (the globes' world menu, Esc) */
  readonly backLink = input(true);
  readonly back = output<void>();
  /** The map made and stored, and what the player wants with it */
  readonly done = output<{ summary: MapSummary; then: 'play' | 'edit' }>();

  /** The map's square as it stands (laid out by the worker); null before the place is open */
  readonly area = signal<OsmArea | null>(null);
  /** The square the load under way asks for; null for the place's first opening and while none runs */
  readonly loadingArea = signal<OsmArea | null>(null);
  /** The side the slider or the keys set and the square does not have yet; null: the square's own */
  readonly side = signal<number | null>(null);
  /** Where the square stands on the map: the one that loads, else the one laid out (the default round the place before), at the side set */
  readonly target = computed<OsmArea>(() => {
    const place = this.place();
    const base = this.loadingArea() ?? this.area() ?? { lat: place.lat, lon: place.lon, sideM: OSM_WORLD_SIDE };
    const side = this.side();
    return side === null ? base : { ...base, sideM: side };
  });
  readonly sideMin = OSM_MIN_SIDE;
  readonly sideMax = OSM_WORLD_SIDE;
  readonly sideStep = OSM_SIDE_STEP;
  /** "1.2 km" beside the slider */
  readonly sideText = computed(() => this.t().osm.side(this.target().sideM / 1000));
  /** The map is off the square laid out (dragged, keys held, a new square loading): the HQ is drawn in the square's middle */
  readonly moving = signal(false);
  readonly maxSpawns = OSM_FRAME_MAX_SPAWNS;
  readonly phase = signal<Phase>('loading');
  /** The steps of the load or the making under way, as the worker reported them (osm-progress.ts, E218) */
  readonly progress = signal<OsmProgressState>({});
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
  /** The map's buildings take damage and fall (decided 2026-10-18: on by default) */
  readonly destructible = signal(true);
  /** The flat map did not come (no WebGL, the style's server); the frame works without it */
  readonly mapProblem = signal<string | null>(null);
  readonly made = signal<{ summary: MapSummary; report: OsmImportReport } | null>(null);
  /** Landmarks near the address the HQ may move to, the best first */
  readonly landmarks = computed(() => this.frame()?.landmarks ?? []);
  /** The HQ stands in the square's middle */
  readonly hqPlace = computed<GeoPoint>(() => this.area() ?? this.place());
  /** The landmark the HQ stands on; null: elsewhere */
  readonly hqAt = computed<FrameLandmark | null>(() => this.landmarks().find((l) => near(l, this.hqPlace())) ?? null);
  /** The HQ stands on the address searched for */
  readonly hqOnAddress = computed(() => near(this.hqPlace(), this.place()));
  /** Metres from the address to the HQ (the square dragged off it) */
  readonly hqFromAddress = computed(() => Math.round(metresBetween(this.hqPlace(), this.place())));

  /** The clock while loading or making (twice a second): the wait before the next round, the time spent */
  readonly now = signal(Date.now());
  /** When the load or the making began, when the servers are asked again (a retry's wait over) */
  private loadStart = 0;
  private retryAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** The load under way; an older one that ends late (Try again now) changes nothing */
  private loadGen = 0;

  /** Seconds the load has waited so far */
  readonly waited = computed(() => Math.max(0, Math.floor((this.now() - this.loadStart) / 1000)));

  /** The rows of the load: the data kept here, or the OpenStreetMap answer and the heights side by side, then the streets */
  readonly loadRows = computed(() => loadingRows(this.progress()));
  /** The load as the veil in the square shows it: the wall's share, the row under way */
  readonly loadNow = computed(() => loadingView(this.progress(), this.now()));
  readonly loadPercent = computed(() => Math.round(this.loadNow().share * 100));
  /** A square loads while the one before stands on the map: the list and its controls stay where they are */
  readonly reloading = computed(() => this.phase() === 'loading' && !!this.frame());
  /** The OpenStreetMap answer has not begun to come yet: the servers are asked, or asked again */
  private readonly askingOverpass = computed(() => {
    const overpass = this.progress().overpass;
    return overpass?.status === 'active' && !overpass.detail;
  });
  /** What the player reads under the rows while the OpenStreetMap servers keep them waiting; null while all goes on */
  readonly waitText = computed(() => {
    const retry = this.retry();
    if (retry) return overpassRetryText(this.t(), retry, (this.retryAt - this.now()) / 1000);
    // The first answer can take long (a busy server keeps the request open): the player sees it is still waiting
    if (this.askingOverpass() && this.waited() >= SLOW_S) return this.t().osm.stillWaiting(this.waited());
    return null;
  });
  /** Ask again at once: offered while the servers are asked again, or when the first answer is slow */
  readonly canRetryNow = computed(() => !!this.retry() || (this.askingOverpass() && this.waited() >= RETRY_NOW_S));
  /** The making: its stages, the weighted share, the step under way */
  readonly makingNow = computed(() => makingView(this.progress(), this.now()));
  readonly percent = computed(() => Math.round(this.makingNow().share * 100));
  readonly fetchedOn = computed(() => {
    const at = this.frame()?.fetchedAt;
    return at ? this.t().osm.fetchedOn(new Date(at)) : '';
  });
  /** The credit line under the map: the data the map is made of */
  readonly credits = computed(() => {
    const dem = this.frame()?.dem;
    const heights = dem === 'aws' ? 'heights: Terrain Tiles (Mapzen, AWS)' : dem ? 'heights: Mapterhorn' : null;
    return ['Map data © OpenStreetMap contributors', heights].filter(Boolean).join(', ');
  });

  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');
  private readonly crop = viewChild<ElementRef<HTMLElement>>('crop');
  private readonly session = inject(OSM_FRAME_SESSION)();
  private map: OsmFrameMap | null = null;
  private making: AbortController | null = null;
  private loading: AbortController | null = null;
  private destroyed = false;

  ngOnInit(): void {
    void this.load();
    // The map stands from the start round the place: the first load shows in its square as every later one
    setTimeout(() => void this.showMap());
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
   * Loads the place's data (frame store or download) and lays out its spawns, the HQ in the square's middle;
   * with `area` again for the square moved or sized on the map (E209, E282): the spawns standing are kept
   * where they fit, the rest drawn anew. A new square that cannot load (the servers, Cancel) leaves the one
   * before as it was.
   */
  async load(area?: OsmArea): Promise<void> {
    const gen = ++this.loadGen;
    this.loadingArea.set(area ?? null);
    const before = area ? this.frame() : null;
    this.phase.set('loading');
    this.error.set(null);
    this.dropNote.set(null);
    this.progress.set({});
    this.retry.set(null);
    this.loading = new AbortController();
    this.startClock();
    this.redraw();
    const place = this.place();
    const hq: GeoPoint = area ?? place;
    const standing = before ? this.spawns().map(({ lat, lon }) => ({ lat, lon })) : [];
    const at = { place: { lat: hq.lat, lon: hq.lon, address: place.address }, searched: { lat: place.lat, lon: place.lon } };
    const request: OsmOpenRequest = before
      ? { ...at, count: Math.max(1, standing.length), spawnsAt: standing, topUp: true, area }
      : { ...at, count: OSM_SPAWNS, spawnsAt: [...this.spawnsAt()] };
    try {
      const frame = await this.session.open(request, (p) => gen === this.loadGen && this.hear(p), this.loading.signal, (retry) => {
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
      if (!frame.hq) this.error.set(this.t().osm.noStreets);
      else if (!frame.spawns.length) this.error.set(this.t().osm.noRoute);
      else if (before && standing.some((p) => !frame.spawns.some((s) => Math.abs(s.lat - p.lat) < 2e-5 && Math.abs(s.lon - p.lon) < 3e-5))) {
        this.dropNote.set(this.t().osm.spawnsRedrawn);
      }
    } catch (e) {
      if (this.destroyed || gen !== this.loadGen) return;
      const message = (e as Error).message;
      if (before) {
        // The square goes back: the worker keeps what was laid out before (OsmFrameSession.open)
        this.phase.set('ready');
        this.error.set(message === OSM_CANCELLED ? null : this.t().osm.squareFailed(osmErrorMessage(this.t(), e)));
      } else {
        this.phase.set('failed');
        this.error.set(message === OSM_CANCELLED ? this.t().osm.cancelled : osmErrorMessage(this.t(), e));
      }
    } finally {
      if (gen === this.loadGen) {
        this.loading = null;
        this.loadingArea.set(null);
        this.side.set(null);
        this.retry.set(null);
        this.stopTicker();
        this.redraw();
      }
    }
  }

  cancelLoad(): void {
    this.loading?.abort();
  }

  /** Drops the load under way and asks the servers anew, without the wait */
  retryNow(): void {
    this.loading?.abort();
    // The same square again: a moved or sized one is not swapped for the default round the place
    void this.load(this.loadingArea() ?? undefined);
  }

  /** A step reported: into the state the rows and the bar show; a step that comes ends the wait for the servers */
  private hear(progress: OsmProgress): void {
    this.progress.update((state) => reduceProgress(state, progress));
    if (progress.step === 'overpass' && progress.detail) this.retry.set(null);
  }

  private startClock(): void {
    this.loadStart = Date.now();
    this.now.set(this.loadStart);
    this.stopTicker();
    this.ticker = setInterval(() => this.now.set(Date.now()), 500);
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** The mark before a row or stage, as the loading plate draws its steps */
  mark(status: OsmStepStatus): string {
    return status === 'done' ? '+' : status === 'active' ? '>' : status === 'failed' ? '!' : '-';
  }

  /** What a row of the load says beside its words; the OpenStreetMap row counts the wait while no byte came */
  rowDetail(row: OsmLoadRow): string {
    if (row.step === 'overpass' && row.status === 'active' && !row.detail) return this.retry() ? this.t().osm.busyAsking : this.t().osm.asking(this.waited());
    return row.detail ? this.detail(row.detail) : row.status === 'done' ? this.t().osm.rowDone : '';
  }

  /** What the making says it could not take over, in the player's language */
  noteText(note: ImportNote): string {
    return say(this.t().importNotes, note);
  }

  /** What a step says beside its words, in the player's language */
  detail(detail: OsmDetail): string {
    return say(this.t().osm.detail, detail);
  }

  /** The flat map, MapLibre loaded on first use */
  private async showMap(): Promise<void> {
    const host = this.mapHost()?.nativeElement;
    const crop = this.crop()?.nativeElement;
    if (!host || !crop || this.map || this.destroyed) return;
    try {
      const map = await OsmFrameMap.open(host, crop, this.mapView(), this.t().osm.mapLabel, {
        drop: (index, at) => void this.dropSpawn(index, at),
        select: (index) => this.select(index),
        tilesFailed: (message) => this.mapProblem.set(this.t().osm.tilesFailed(message)),
        fit: (area) => fitArea(area, this.place()),
        settle: (centre) => this.reframe({ ...centre, sideM: this.target().sideM }),
        resize: (step) => this.sizeTo(this.target().sideM + step * OSM_SIDE_STEP),
        moving: (on) => this.moving.set(on),
      });
      if (this.destroyed) {
        map.dispose();
        return;
      }
      this.map = map;
      this.redraw();
    } catch (e) {
      this.mapProblem.set(this.t().osm.mapFailed(osmErrorMessage(this.t(), e)));
    }
  }

  private mapView(): FrameMapView {
    return { hq: this.frame()?.hq ?? null, spawns: this.spawns(), selected: this.selected(), area: this.area(), target: this.target(), editable: this.canEdit() };
  }

  private redraw(): void {
    this.map?.show(this.mapView());
  }

  /** Spawns and square may change: the place is laid out and no call to the worker runs */
  canEdit(): boolean {
    return this.phase() === 'ready' && !this.busy();
  }

  /**
   * The square let go where the map stands (dragged, keys, the slider): held to its limits and laid out anew
   * there, the HQ in its middle, its data loaded if it reaches past what is in hand; the same square stays
   */
  reframe(area: OsmArea): void {
    const now = this.area();
    if (!this.canEdit() || !now) return;
    const fitted = fitArea(area, this.place());
    if (sameArea(now, fitted)) {
      this.side.set(null);
      this.redraw();
      return;
    }
    void this.load(fitted);
  }

  /** The side the slider or + and - set, before it is let go: the map zooms, the square on the screen stays */
  sizeTo(sideM: number): void {
    if (!this.canEdit()) return;
    this.side.set(Math.min(this.sideMax, Math.max(this.sideMin, Math.round(sideM / OSM_SIDE_STEP) * OSM_SIDE_STEP)));
    this.redraw();
  }

  /** The slider let go: the square laid out at its side, where the map stands */
  sizeDone(): void {
    const target = this.target();
    this.reframe({ ...(this.map?.centre() ?? target), sideM: target.sideM });
  }

  /** The HQ moved to a landmark (null: back to the address): the square centred there, the spawns kept where they still fit */
  moveHq(landmark: FrameLandmark | null): void {
    const area = this.area();
    if (!area) return;
    const to = landmark ?? this.place();
    this.reframe({ lat: to.lat, lon: to.lon, sideM: area.sideM });
  }

  /** "On Johanneskirche (church, 320 m)", "On the address", "800 m from the address" */
  hqWhere(): string {
    const osm = this.t().osm;
    const at = this.hqAt();
    if (at) return osm.hqOn(this.landmarkLabel(at));
    return this.hqOnAddress() ? osm.hqOnAddress : osm.hqFromAddress(osm.distance(this.hqFromAddress()));
  }

  /** The landmark the HQ stands on */
  isHqAt(landmark: FrameLandmark): boolean {
    const at = this.hqAt();
    return !!at && at.lat === landmark.lat && at.lon === landmark.lon;
  }

  /** "Johanneskirche (church, 320 m)", "the town hall (450 m)" */
  landmarkLabel(l: FrameLandmark): string {
    const osm = this.t().osm;
    return osm.landmark(l.name, osm.landmarks[l.kind], osm.distance(l.distanceM));
  }

  select(index: number | null): void {
    this.selected.set(index);
    this.redraw();
  }

  /** A spawn dragged on the map: onto the foot of its street, or back where it stood with the reason */
  async dropSpawn(index: number, at: GeoPoint): Promise<void> {
    // While a square loads or another call runs the spawns are not the ones laid out next: the spawn stays
    if (!this.canEdit()) {
      this.redraw();
      return;
    }
    this.busy.set(true);
    this.redraw();
    try {
      const dropped = await this.session.drop(at);
      if ('reason' in dropped) {
        this.dropNote.set(this.t().osm.dropped(this.t().osm.dropReasons[dropped.reason]));
      } else {
        this.dropNote.set(null);
        this.spawns.update((list) => list.map((s, k) => (k === index ? dropped : s)));
        this.selected.set(index);
      }
    } catch (e) {
      this.dropNote.set(osmErrorMessage(this.t(), e));
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
      if (!next) this.dropNote.set(this.t().osm.noOtherStreet);
      return next ? this.spawns().map((s, k) => (k === index ? next : s)) : this.spawns();
    });
  }

  async addSpawn(): Promise<void> {
    await this.drawing(async () => {
      const [next] = await this.session.draw(1, this.spawns());
      if (!next) this.dropNote.set(this.t().osm.noOtherStreet);
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
    this.redraw();
    try {
      this.spawns.set(await work());
      this.selected.set(null);
    } catch (e) {
      this.dropNote.set(osmErrorMessage(this.t(), e));
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
    this.progress.set({});
    this.hear({ step: 'parse' });
    this.startClock();
    this.making = new AbortController();
    this.redraw();
    const signal = this.making.signal;
    try {
      const names = osmMapNames(this.place());
      const id = await this.store.freeId(names.id);
      const { objects: catalog, materials, colours } = await catalogEntries();
      const made = await this.session.make(
        this.spawns(),
        {
          id, name: names.name, costs: catalog && assetCosts(catalog, this.area()?.sideM ?? OSM_WORLD_SIDE), catalog: catalog && buildingCatalog(catalog),
          lineAssets: catalog && lineAssets(catalog),
          destructible: this.destructible(),
          materials,
        },
        colours,
        (p) => this.hear(p),
        signal,
      );
      if (signal.aborted) throw new Error(OSM_CANCELLED);
      this.hear({ step: 'save' });
      // The worker drew the list picture (map-ops/map-picture.ts) and worked out the content hash: the page only stores
      const summary = await this.store.save(made.doc, made.preview, made.file, { contentHash: made.hash });
      this.hear({ step: 'save', state: 'done' });
      console.warn(`[OSM world] ${summary.id}: made in ${made.convertMs} ms`, { download: this.frame()?.download, report: made.report });
      if (this.destroyed) return;
      this.made.set({ summary, report: made.report });
      this.phase.set('made');
    } catch (e) {
      if (this.destroyed) return;
      this.phase.set('ready');
      const message = (e as Error).message;
      this.error.set(message === OSM_CANCELLED ? null : this.t().osm.notMade(osmErrorMessage(this.t(), e)));
    } finally {
      this.making = null;
      this.stopTicker();
      this.redraw();
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
    const osm = this.t().osm;
    return osm.spawnLine(osm.distance(s.distanceM), osm.distance(s.routeM));
  }

  /** What the made map holds, in a line */
  reportLine(report: OsmImportReport): string {
    const r = report.roads;
    const spawns = report.layout.spawns.length;
    return this.t().osm.report({
      roadKm: Math.round(r.km.road + r.km.bridge), pathKm: Math.round(r.km.path), bridges: r.bridges, buildings: report.buildings.placed, spawns,
    });
  }
}

/** Two points within a metre: the HQ on the address or on a landmark */
function near(a: GeoPoint, b: GeoPoint): boolean {
  return metresBetween(a, b) < 1;
}

function metresBetween(a: GeoPoint, b: GeoPoint): number {
  return Math.hypot((a.lat - b.lat) * METERS_PER_DEGREE_LAT, (a.lon - b.lon) * METERS_PER_DEGREE_LAT * Math.cos((a.lat * Math.PI) / 180));
}

/**
 * The renderer's catalogue objects for the plants' scene costs and the
 * buildings' models, and the ground materials' colours for the list
 * picture; none where it cannot be read (the import then counts plants dear
 * and places every building model without a budget, the picture is grey)
 */
async function catalogEntries(): Promise<{ objects?: readonly CatalogObject[]; materials?: string[]; colours: MapPictureColours }> {
  try {
    const catalog = await MapAssetLibrary.shared().catalog();
    return {
      objects: catalog.objects.length ? catalog.objects : undefined,
      materials: catalog.materials.length ? catalog.materials.map((m) => m.id) : undefined,
      colours: pictureColours(catalog.materials),
    };
  } catch {
    return { colours: {} };
  }
}
