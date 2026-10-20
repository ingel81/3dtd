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
import { BrowserBack } from '../world/browser-back.service';
import type { LatLon } from '../globe/globe-geo';
import type { StageGlobeId } from '../globe/globe-stage';
import { focusQuietly } from '../utils/keyboard-target';
import { StageGlobes, type StageGlobeState } from './stage-globes';
import { StageCoopComponent } from './stage-coop.component';
import { GlobePictureComponent, GlobePictures } from './globe-picture.component';
import { WorldMapsComponent } from './world-maps.component';
import { WorldOsmComponent } from './world-osm.component';
import { WorldRealComponent } from './world-real.component';
import { WORLD_IDS, type WorldId, type WorldPick } from './world-rules';
import { injectT } from '../i18n/i18n.service';
import { WorldsStageService, chipLine, continueLine, type StageContinue } from './worlds-stage.service';
import { placeLabel } from '../services/location/place-label';

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
  /** The world a Continue plays in: its globe shows with it */
  world: WorldId | null;
  run: () => void;
}


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
    GlobePictureComponent,
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
  private readonly pictures = inject(GlobePictures);
  private readonly dialog = inject(MatDialog);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('globes');
  private readonly bridge = readDesktopBridge();

  protected readonly t = injectT();
  readonly worldIds = WORLD_IDS;
  readonly names = computed(() => this.t().worlds.names);
  readonly view = this.stage.view;
  readonly world = this.stage.world;

  /** The globes are not drawn (the menu globe is off, or WebGL failed): the squares show discs */
  private readonly failed = signal(false);
  readonly globesOff = computed(() => this.globeSetting() === 'off' || this.failed());

  /** The background: the world's in its menu, the globes' before one is picked */
  readonly background = computed(() => (this.view() === 'world' ? this.world() : null));

  readonly pick = computed(() => this.stage.picks()[this.world()]);
  readonly pickName = computed(() => {
    const pick = this.pick();
    return pick ? (pick.kind === 'place' ? placeLabel(pick.name) : pick.name) : null;
  });

  /**
   * The path's chips: every world's Continue, the editor's map (WorldsStageService.pathChips); in a world's
   * menu not its own, which is the menu's first row
   */
  readonly chips = computed(() => this.stage.pathChips(this.view() === 'world' ? this.world() : null, true));

  /** The other two worlds beside the big globe */
  readonly otherWorlds = computed(() => WORLD_IDS.filter((w) => w !== this.world()));

  /** Start or Continue, as the header and the detail call it */
  readonly playLabel = computed(() => this.stage.playWord(this.world(), this.pick(), this.world() === 'real' ? this.t().worlds.start : this.t().worlds.play));
  readonly editLabel = computed(() => (this.pick()?.kind === 'map' ? this.t().worlds.edit : this.t().worlds.makeMap));
  readonly playWhy = computed(() => this.stage.whyNot('play', this.world()));
  readonly editWhy = computed(() => (this.pick()?.kind === 'tileset' ? this.t().worlds.whyNot.tilesetNoMap : this.stage.whyNot('edit', this.world())));

  readonly startItems = computed<StartItem[]>(() => {
    const items: StartItem[] = [];
    const words = this.t().worlds;
    const item = (id: string, label: string, icon: TdIconName, run: () => void, extra: Partial<StartItem> = {}): StartItem =>
      ({ id, label, icon, sub: null, why: null, rule: false, world: null, run, ...extra });
    for (const go of this.stage.continues()) {
      items.push(item(`continue-${go.world}`, go.label, 'play', () => this.stage.resume(go), {
        sub: continueLine(this.t(), go),
        why: this.stage.whyNot('play', go.world),
        world: go.world,
      }));
    }
    items.push(
      item('coop', words.items.coop, 'users', () => this.stage.openOverlay('coop'), { rule: items.length > 0 }),
      item('load', words.items.load, 'filing', () => this.stage.openOverlay('load')),
      item('editor', words.items.editor, 'terrain', () => this.openEditor(), {
        sub: words.editorSub,
        why: this.stage.whyNot('edit', null),
      }),
      item('settings', words.items.settings, 'cog', () => this.stage.openOverlay('settings')),
      item('extras', words.items.extras, 'manual', () => this.stage.openOverlay('extras')),
    );
    if (typeof this.bridge?.quit === 'function') items.push(item('quit', words.items.quit, 'power', () => this.bridge?.quit?.(), { rule: true }));
    return items;
  });

  /** Each world's globe as a still picture (StageGlobes), none while the globes are not drawn: the disc then */
  pictureOf(world: WorldId): string | null {
    return this.globesOff() ? null : (this.pictures.all()[world] ?? null);
  }

  /** The globes' marks: where the pick of the world showing stands, with its name */
  readonly markName = computed(() => (this.view() === 'world' ? this.pickName() : null));

  private globes: StageGlobes | null = null;
  /** The entry focusFirst gave the focus to last: a Continue that comes in later may take it over */
  private autoFocused: HTMLElement | null = null;

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
    // The maps' globe: a tower for every Built World, the pick in brass
    effect(() => {
      const maps = this.stage.maps().filter((m) => !m.generated);
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
        (globe, url) => zone.run(() => this.pictures.set(globe, url)),
      );
      this.globes = globes;
      zone.runOutsideAngular(() => globes.start(this.globeSetting() === 'low' ? 'low' : 'high', homeLongitude()));
      globes.setMaps(this.stage.maps().filter((m) => !m.generated), null);
    }, { injector: this.injector });
    // The menu globe switched off in Settings: the discs from now on
    effect(() => {
      if (this.globesOff()) untracked(() => this.stopGlobes());
    });
    inject(DestroyRef).onDestroy(() => this.stopGlobes());
    // The browser's Back: the Esc chain, a dialog over the stage first; on the globes with nothing open it leaves
    inject(DestroyRef).onDestroy(inject(BrowserBack).register(() => this.backStep()));

    // The focus as in the start menu: the first entry of the list, the first of a world's menu; back from a
    // world's menu on its globe, where the keyboard left for it
    let before: { view: 'globes' | 'world'; world: WorldId } | null = null;
    effect(() => {
      const now = { view: this.view(), world: this.world() };
      const back = before?.view === 'world' && now.view === 'globes' ? before.world : null;
      before = now;
      untracked(() => afterNextRender(() => this.focusFirst(back), { injector: this.injector }));
    });
    // The saves are read after the first frame: their Continue comes in above the entry that took the focus,
    // which then goes up to it, unless the player moved it meanwhile
    effect(() => {
      if (this.stage.continues().length === 0) return;
      untracked(() => afterNextRender(() => {
        if (this.view() === 'globes' && this.autoFocused && document.activeElement === this.autoFocused) this.focusFirst();
      }, { injector: this.injector }));
    });
  }

  lock(world: WorldId): string | null {
    return this.stage.lock(world);
  }

  /** The line under a locked globe, which says what the lock needs */
  lockLine(world: WorldId): string | null {
    const lock = this.stage.lockCode(world);
    return lock ? this.t().worlds.lockCard[lock] : null;
  }

  /** The line under a globe */
  cardSub(world: WorldId): string {
    const sub = this.t().worlds.cardSub;
    if (world === 'real') return sub.real;
    if (world === 'osm') return sub.osm;
    const maps = this.stage.maps();
    const shipped = maps.filter((m) => m.origin === 'shipped').length;
    const own = maps.filter((m) => m.origin !== 'shipped' && !m.generated).length;
    return maps.length === 0 ? sub.mapsNone : sub.maps(shipped, own);
  }

  /** The line of a small globe beside the big one */
  miniSub(world: WorldId): string {
    const lock = this.lock(world);
    if (lock) return lock;
    const go = this.stage.continueOf(world);
    if (go) return go.line;
    return this.t().worlds.miniSub[world];
  }

  /** A Continue as chip and globe line: "Heilbronn | wave 12 | autosave", "... | ready" when held, "Back to Heilbronn" */
  chipLine(go: StageContinue): string {
    return chipLine(this.t(), go);
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

  /** The map editor's way in: the Built Worlds' menu, the one list of maps (New map, Import file, Edit there) */
  openEditor(): void {
    if (this.stage.whyNot('edit', null)) return;
    this.stage.openWorld('maps');
  }

  closeOverlay(): void {
    this.stage.closeOverlay();
  }

  /** One step up for the browser's Back (BrowserBack): a dialog over the stage, then the Esc chain */
  private backStep(): boolean {
    const dialogs = this.dialog.openDialogs;
    if (dialogs.length > 0) {
      dialogs[dialogs.length - 1].close();
      return true;
    }
    return this.stage.back();
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

  /** The first entry of the view; on the globes `card`'s globe instead, when one is named */
  private focusFirst(card: WorldId | null = null): void {
    const active = document.activeElement;
    // A field or an overlay that holds the focus keeps it
    if (active instanceof HTMLElement && active !== document.body && this.host.contains(active) && active.matches('input, textarea')) return;
    const first = this.view() === 'globes'
      ? this.host.querySelector<HTMLElement>(card ? `.ws-card[data-world="${card}"]` : '.ws-menu [role="menuitem"]')
      : this.host.querySelector<HTMLElement>('.ws-panel .wm-body button:not([tabindex="-1"]):not([disabled]), .ws-panel .wm-body input:not([disabled]), .ws-panel .wm-body [tabindex="0"]');
    if (!first) return;
    this.autoFocused = first;
    focusQuietly(first, () => first.focus({ preventScroll: true }));
  }
}
