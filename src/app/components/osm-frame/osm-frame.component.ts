import { ChangeDetectionStrategy, Component, ElementRef, InjectionToken, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TdIconComponent } from '../icon/icon.component';
import type { MapSummary } from '../../world/custom-map/map-store';
import { MAP_STORE } from '../../world/world-choice.service';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import { plantCosts } from '../../world/osm/convert/vegetation';
import { OSM_SPAWNS, OSM_WORLD_SIDE, osmMapNames, type OsmImportReport } from '../../world/osm/import-osm';
import type { FrameSpawn, GeoPoint, OsmFrameInfo, OsmStep } from '../../world/osm/osm-frame-core';
import { OSM_CANCELLED, OsmFrameSession } from '../../world/osm/osm-frame-session';
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
  { step: 'plants', text: 'Forests and trees' },
  { step: 'pack', text: 'Packing the map' },
  { step: 'save', text: 'Saving' },
];

type Phase = 'loading' | 'ready' | 'failed' | 'making' | 'made';

/**
 * The frame of an OSM world (docs/OSM_WORLD_PLAN.md, O2): a flat map of the
 * place with the map's 2.4 km square, the HQ on the place and the spawns,
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

  readonly sideKm = OSM_WORLD_SIDE / 1000;
  readonly maxSpawns = OSM_FRAME_MAX_SPAWNS;
  readonly phase = signal<Phase>('loading');
  /** The step under way while loading or making */
  readonly step = signal<OsmStep | 'save' | null>(null);
  readonly error = signal<string | null>(null);
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

  readonly loadingText = computed(() => (this.step() === 'stored' ? 'Opening the streets kept from last time' : 'Downloading the streets and heights of this place'));
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
    this.loading?.abort();
    this.making?.abort();
    this.session.dispose();
    this.map?.dispose();
  }

  /** Loads the place's data (frame store or download) and lays out its spawns */
  async load(): Promise<void> {
    this.phase.set('loading');
    this.error.set(null);
    this.step.set(null);
    this.loading = new AbortController();
    const place = this.place();
    try {
      const frame = await this.session.open(
        { lat: place.lat, lon: place.lon, address: place.address },
        OSM_SPAWNS,
        [...this.spawnsAt()],
        (step) => this.step.set(step),
        this.loading.signal,
      );
      if (this.destroyed) return;
      this.frame.set(frame);
      this.spawns.set(frame.spawns);
      this.phase.set('ready');
      if (!frame.hq) this.error.set('This place has no streets in OpenStreetMap: enemies would have nowhere to walk.');
      else if (!frame.spawns.length) this.error.set('No street 500 to 1000 m from the HQ has a route to it. Try a place nearby.');
      // The map's box exists once the phase is ready
      setTimeout(() => void this.showMap());
    } catch (e) {
      if (this.destroyed) return;
      this.phase.set('failed');
      this.error.set((e as Error).message === OSM_CANCELLED ? 'Cancelled.' : (e as Error).message);
    } finally {
      this.loading = null;
    }
  }

  cancelLoad(): void {
    this.loading?.abort();
  }

  /** The flat map, MapLibre loaded on first use */
  private async showMap(): Promise<void> {
    const host = this.mapHost()?.nativeElement;
    if (!host || this.map || this.destroyed) return;
    try {
      const map = await OsmFrameMap.open(host, this.place(), OSM_WORLD_SIDE, {
        drop: (index, at) => void this.dropSpawn(index, at),
        select: (index) => this.select(index),
        problem: (text) => this.mapProblem.set(text),
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
    this.map?.show({ hq: this.frame()?.hq ?? null, spawns: this.spawns(), selected: this.selected() });
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
      const id = await this.store.freeId(osmMapNames(this.place()).id);
      const made = await this.session.make(this.spawns(), { id, plantCosts: await catalogPlantCosts() }, (step) => this.step.set(step), signal);
      if (signal.aborted) throw new Error(OSM_CANCELLED);
      this.step.set('save');
      const summary = await this.store.save(made.doc, null, made.file);
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
    return `${Math.round(r.km.road + r.km.bridge)} km of road, ${Math.round(r.km.path)} km of paths, ` +
      `${r.bridges} ${r.bridges === 1 ? 'bridge' : 'bridges'}, ${spawns} ${spawns === 1 ? 'spawn' : 'spawns'}`;
  }
}

/** The plants' scene costs from the renderer's catalogue; none where it cannot be read (the import then counts them dear) */
async function catalogPlantCosts(): Promise<Record<string, number> | undefined> {
  try {
    return plantCosts((await MapAssetLibrary.shared().catalog()).objects, OSM_WORLD_SIDE);
  } catch {
    return undefined;
  }
}
