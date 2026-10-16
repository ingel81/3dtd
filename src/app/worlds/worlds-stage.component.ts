import { WorldPathComponent, type PathAction } from '../components/world-path/world-path.component';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MatDialog } from '@angular/material/dialog';
import { TdIconComponent, type TdIconName } from '../components/icon/icon.component';
import { RovingGroupDirective } from '../components/roving-group.directive';
import { SettingsSectionsComponent } from '../components/main-menu/pages/settings/settings-sections.component';
import { ExtrasListComponent } from '../components/main-menu/pages/extras/extras-list.component';
import { SaveSlotsComponent } from '../components/main-menu/pages/save-load/save-slots.component';
import { TokenSetupComponent } from '../components/token-setup/token-setup.component';
import { ConfigService } from '../core/services/config.service';
import { readDesktopBridge } from '../core/desktop-bridge';
import { GlobeDirectorService, homeLongitude } from '../services/world/globe-director.service';
import { SAVE_GAME } from '../services/save-game/save-game.port';
import { WorldChoiceService } from '../world/world-choice.service';
import type { LatLon } from '../globe/globe-geo';
import type { StageGlobeId } from '../globe/globe-stage';
import { focusQuietly } from '../utils/keyboard-target';
import { StageGlobes, type StageGlobeState } from './stage-globes';
import { StageCoopComponent } from './stage-coop.component';
import { WorldMapsComponent } from './world-maps.component';
import { WorldOsmComponent } from './world-osm.component';
import { WorldRealComponent } from './world-real.component';
import { WORLD_IDS, WORLD_NAMES, type AutosaveRun, type WorldId, type WorldPick } from './world-rules';
import { WorldsStageService, type StageOverlay } from './worlds-stage.service';

/** An entry of the menu on the globes */
interface StartItem {
  id: string;
  label: string;
  icon: TdIconName;
  /** The line under it: what Continue plays */
  sub: string | null;
  /** Why it is locked; it stays and says so */
  why: string | null;
  /** A rule above it */
  rule: boolean;
  run: () => void;
}

const OVERLAY_TITLES: Record<Exclude<StageOverlay, 'key'>, string> = {
  settings: 'Settings',
  extras: 'Extras',
  load: 'Load game',
  coop: 'Coop',
};

/**
 * The start of the game (docs/WORLDS_NAVIGATION_PLAN.md, phases 6 and 7):
 * the three worlds as globes, the menu on the left, and per world its menu
 * with the globe large and the other two small to switch to. Nothing of a
 * game loads here; Start and Continue open the world (WorldSession), the
 * game host then makes the game.
 *
 * One canvas draws the globes behind the page (StageGlobes, GlobeStage):
 * the page holds a square for each (`[data-globe]`), the canvas draws into
 * them. With the menu globe off (Settings, Graphics) or without WebGL 2 the
 * squares show a lit disc instead. The background is the world's (CSS).
 *
 * Esc goes one step up (WorldsStageService.back): a question, an overlay,
 * the OpenStreetMap frame, a world menu; on the globes nothing.
 */
@Component({
  selector: 'app-worlds-stage',
  standalone: true,
  imports: [
    WorldPathComponent,
    CdkTrapFocus,
    TdIconComponent,
    RovingGroupDirective,
    SettingsSectionsComponent,
    ExtrasListComponent,
    SaveSlotsComponent,
    TokenSetupComponent,
    StageCoopComponent,
    WorldRealComponent,
    WorldOsmComponent,
    WorldMapsComponent,
  ],
  providers: [
    // The Load page lists the slots; a slot opens its world, which loads it
    { provide: SAVE_GAME, useFactory: () => inject(WorldsStageService).saves },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './worlds-stage.component.html',
  styleUrl: './worlds-stage.component.scss',
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class WorldsStageComponent {
  readonly stage = inject(WorldsStageService);
  private readonly config = inject(ConfigService);
  private readonly worlds = inject(WorldChoiceService);
  private readonly globeSetting = inject(GlobeDirectorService).setting;
  private readonly dialog = inject(MatDialog);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('globes');
  private readonly bridge = readDesktopBridge();

  readonly worldIds = WORLD_IDS;
  readonly names = WORLD_NAMES;
  readonly view = this.stage.view;
  readonly world = this.stage.world;
  readonly overlayTitles = OVERLAY_TITLES;

  /** The globes are not drawn (the menu globe is off, or WebGL failed): the squares show discs */
  private readonly failed = signal(false);
  readonly globesOff = computed(() => this.globeSetting() === 'off' || this.failed());

  /** The background: the world's in its menu, the globes' before one is picked */
  readonly background = computed(() => (this.view() === 'world' ? this.world() : null));

  readonly pick = computed(() => this.stage.picks()[this.world()]);
  readonly pickName = computed(() => this.pick()?.name.split(',')[0] ?? null);

  /** The other two worlds beside the big globe */
  readonly otherWorlds = computed(() => WORLD_IDS.filter((w) => w !== this.world()));

  /** Start or Continue, as the header and the detail call it */
  readonly playLabel = computed(() => {
    if (this.stage.runHere(this.world(), this.pick())) return 'Continue';
    return this.world() === 'real' ? 'Start' : 'Play';
  });
  readonly editLabel = computed(() => (this.pick()?.kind === 'map' ? 'Edit' : 'Make map'));
  readonly playWhy = computed(() => this.stage.whyNot('play', this.world()));
  readonly editWhy = computed(() => (this.pick()?.kind === 'tileset' ? 'An own tileset has no map to make' : this.stage.whyNot('edit', this.world())));

  readonly startItems = computed<StartItem[]>(() => {
    const items: StartItem[] = [];
    const item = (id: string, label: string, icon: TdIconName, run: () => void, extra: Partial<StartItem> = {}): StartItem =>
      ({ id, label, icon, sub: null, why: null, rule: false, run, ...extra });
    for (const run of this.stage.autosaves()) {
      items.push(item(`continue-${run.slotId}`, 'Continue', 'play', () => this.stage.continueRun(run), {
        sub: `${run.name} | wave ${run.wave}`,
        why: this.stage.whyNot('play', run.world),
      }));
    }
    items.push(
      item('coop', 'Coop', 'users', () => this.stage.openOverlay('coop'), { rule: items.length > 0 }),
      item('load', 'Load game', 'filing', () => this.stage.openOverlay('load')),
      item('editor', 'Map editor', 'terrain', () => this.openEditor(), {
        sub: 'All your maps, any world',
        why: this.stage.whyNot('edit', null),
      }),
      item('settings', 'Settings', 'cog', () => this.stage.openOverlay('settings')),
      item('extras', 'Extras', 'manual', () => this.stage.openOverlay('extras')),
    );
    if (typeof this.bridge?.quit === 'function') items.push(item('quit', 'Quit 3DTD', 'power', () => this.bridge?.quit?.(), { rule: true }));
    return items;
  });

  /** The globes' marks: where the pick of the world showing stands, with its name */
  readonly markName = computed(() => (this.view() === 'world' ? this.pickName() : null));

  private globes: StageGlobes | null = null;

  constructor() {
    const zone = inject(NgZone);
    // The key screen is an overlay here: Settings' "Change key" asks for it through the config too
    effect(() => {
      const requested = this.config.setupRequested();
      untracked(() => {
        if (requested && this.stage.overlay() !== 'key') this.stage.overlay.set('key');
        if (!requested && this.stage.overlay() === 'key') this.stage.overlay.set(null);
      });
    });
    // The maps' globe: a tower for every map that is not of OpenStreetMap, the pick in brass
    effect(() => {
      const maps = this.stage.maps().filter((m) => !m.osm);
      const pick = this.stage.picks().maps;
      untracked(() => this.globes?.setMaps(maps, pick?.kind === 'map' ? pick.id : null));
    });
    void this.stage.refreshMaps();

    afterNextRender(() => {
      if (this.globesOff()) return;
      const globes = new StageGlobes(
        this.host,
        this.canvas().nativeElement,
        (globe) => this.globeState(globe),
        () => this.markAt(),
        () => zone.run(() => this.failed.set(true)),
      );
      this.globes = globes;
      zone.runOutsideAngular(() => globes.start(this.globeSetting() === 'low' ? 'low' : 'high', homeLongitude()));
      globes.setMaps(this.stage.maps().filter((m) => !m.osm), null);
    }, { injector: this.injector });
    // The menu globe switched off in Settings: the discs from now on
    effect(() => {
      if (this.globesOff()) untracked(() => this.stopGlobes());
    });
    inject(DestroyRef).onDestroy(() => this.stopGlobes());

    // The focus as in the start menu: the first entry of the list, the first of a world's menu
    effect(() => {
      this.view();
      this.world();
      untracked(() => afterNextRender(() => this.focusFirst(), { injector: this.injector }));
    });
  }

  lock(world: WorldId): string | null {
    return this.stage.lock(world);
  }

  /** The line under a globe */
  cardSub(world: WorldId): string {
    if (world === 'real') return 'Photorealistic 3D tiles of the real world';
    if (world === 'osm') return 'Maps made from OpenStreetMap, no key needed';
    const maps = this.stage.maps();
    const shipped = maps.filter((m) => m.origin === 'shipped').length;
    const own = maps.filter((m) => m.origin !== 'shipped' && !m.osm).length;
    return maps.length === 0 ? 'Shipped maps and your own' : `${shipped} shipped maps, ${own} of yours`;
  }

  /** The line of a small globe beside the big one */
  miniSub(world: WorldId): string {
    const lock = this.lock(world);
    if (lock) return lock;
    const run = this.stage.autosaveOf(world);
    if (run) return `${run.name} | wave ${run.wave}`;
    return world === 'real' ? '3D tiles' : world === 'osm' ? 'No key needed' : 'Shipped and yours';
  }

  runLine(run: AutosaveRun): string {
    return `${run.name} | wave ${run.wave} | autosave`;
  }

  activate(item: StartItem): void {
    if (item.why) return;
    item.run();
  }

  /** A step of the path: the globes, this world's menu, Start or Edit of the pick */
  onPath(action: PathAction): void {
    if (action === 'worlds') this.stage.toGlobes();
    else if (action === 'world') this.stage.openWorld(this.world());
    else if (action === 'play') this.stage.start();
    else if (action === 'edit') this.stage.edit();
  }

  /** The map editor in this window */
  openEditor(): void {
    if (this.stage.whyNot('edit', null)) return;
    this.worlds.editMap(null);
  }

  closeOverlay(): void {
    this.stage.closeOverlay();
  }

  onEscape(event: Event): void {
    // A dialog over the stage (Extras' runs, keys) keeps its own Esc
    if (event.defaultPrevented || this.dialog.openDialogs.length > 0) return;
    if (this.stage.back()) event.preventDefault();
  }

  // ---- Globes ----

  private globeState(globe: StageGlobeId): StageGlobeState {
    return { target: this.targetOf(globe), saturation: this.lock(globe) ? 0 : 1 };
  }

  /** The point a globe turns to: its world's pick (or the frame's place under OpenStreetMap) */
  private targetOf(globe: StageGlobeId): LatLon | null {
    if (globe === 'osm') {
      const frame = this.stage.frame();
      if (frame) return { lat: frame.place.lat, lon: frame.place.lon };
    }
    const pick = this.stage.picks()[globe];
    return pick ? this.pointOf(globe, pick) : null;
  }

  private pointOf(globe: StageGlobeId, pick: WorldPick): LatLon | null {
    if (pick.kind === 'place') return pick.hq;
    if (pick.kind === 'tileset') return this.worlds.tilesets().find((t) => t.id === pick.id)?.coverage.center ?? null;
    if (globe === 'osm') return this.stage.maps().find((m) => m.id === pick.id)?.osm ?? null;
    return this.globes?.spotOf(pick.id) ?? null;
  }

  private markAt(): { globe: StageGlobeId; at: LatLon } | null {
    if (this.view() !== 'world') return null;
    const globe = this.world();
    const at = this.targetOf(globe);
    return at ? { globe, at } : null;
  }

  private stopGlobes(): void {
    this.globes?.dispose();
    this.globes = null;
  }

  private focusFirst(): void {
    const active = document.activeElement;
    // A field or an overlay that holds the focus keeps it
    if (active instanceof HTMLElement && active !== document.body && this.host.contains(active) && active.matches('input, textarea')) return;
    const first = this.view() === 'globes'
      ? this.host.querySelector<HTMLElement>('.ws-menu [role="menuitem"]')
      : this.host.querySelector<HTMLElement>('.ws-panel .ws-body button, .ws-panel .ws-body input, .ws-panel .ws-body [tabindex="0"]');
    if (first) focusQuietly(first, () => first.focus({ preventScroll: true }));
  }
}
