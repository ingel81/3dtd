import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent, type TdIconName } from '../icon/icon.component';
import { RovingGroupDirective } from '../roving-group.directive';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { CoopService } from '../../services/coop.service';
import { WhatsNewService } from '../../services/onboarding/whats-new.service';
import { openAttributionsDialog } from '../attributions-dialog/open-attributions-dialog';
import { openHotkeyHelpDialog } from '../hotkey-help-dialog/open-hotkey-help-dialog';
import { readDesktopBridge } from '../../core/desktop-bridge';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { GAME_SPEEDS } from '../../configs/game-speed.config';
import { ConfigService } from '../../core/services/config.service';
import { BenchmarkService } from '../../benchmark/benchmark.service';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { VFX_PRESET_CHOICES, matchingVfxPreset, type VfxPreset } from '../../three-engine/vfx-settings';
import { AUTOSAVE_SLOT, SAVE_GAME, type LoadResult } from '../../services/save-game/save-game.port';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { ReplayService } from '../../services/replay.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { loadSlotRows, saveSlotRows } from './save-slots';

/** The pages of the menu: the list, and what an entry opens in its place */
export type GameMenuPage = 'main' | 'save' | 'load' | 'settings' | 'more';

/** What the menu asks before it does it, in its own body */
export type GameMenuConfirm =
  | { kind: 'quit' }
  | { kind: 'benchmark' }
  | { kind: 'restart' }
  | { kind: 'overwrite'; slotId: string; title: string }
  | { kind: 'load'; slotId: string; title: string }
  | { kind: 'import' }
  | { kind: 'delete'; slotId: string; title: string };

/** One volume row of the settings: the channel's level and mute in UIStore */
interface VolumeRow {
  label: string;
  icon: TdIconName;
  level: () => number;
  muted: () => boolean;
  set: (level: number) => void;
  toggleMute: () => void;
  key?: string;
}

/**
 * The game menu (TODO A3, E111, E112c): the gear in the sidebar footer and
 * Esc, when Esc has nothing else to do, open it. A classic game menu:
 * Continue on top (the autosave's, while the new run has not begun, then
 * "Back to the game"), then Save and Load (alone only, between waves,
 * docs/SAVE_LOAD_PLAN.md), Settings (fullscreen, the four volumes, graphics
 * quality, game speed), More (run log and replay as files, map key, what's
 * new, keys, credits, benchmark), and below a line Restart here, Change
 * location and, in the desktop app only, Quit. A browser tab cannot close
 * itself, so the web version has no Quit.
 *
 * An entry that opens a page shows it in the menu's body, Back and Esc go
 * back to the list. What ends the run under way (Restart, Load, Quit,
 * Benchmark) asks first, in the menu itself.
 *
 * Alone, the game pauses while the menu is open, as a game's menu does; it
 * goes on when the menu closes, unless it was paused before. In coop the
 * room's clock is everyone's, so it runs on; Save, Load, Restart and Change
 * location are not offered there.
 */
@Component({
  selector: 'app-game-menu',
  standalone: true,
  imports: [MatDialogModule, MatTooltipModule, TdIconComponent, RovingGroupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-menu.component.html',
  styleUrl: './game-menu.component.scss',
  host: { '(keydown.escape)': 'onEscape($event)' },
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class GameMenuComponent {
  private readonly dialogRef = inject(MatDialogRef<GameMenuComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly whatsNew = inject(WhatsNewService);
  private readonly bridge = readDesktopBridge();
  readonly ui = inject(UIStore);
  private readonly store = inject(GameStore);
  private readonly coop = inject(CoopService);
  private readonly config = inject(ConfigService);
  private readonly debugFacade = inject(DebugFacadeService);
  readonly saves = inject(SAVE_GAME);
  private readonly runLog = inject(RunLogFacade);
  private readonly location = inject(LocationChangeCoordinatorService);
  /** The game component's; the menu opened elsewhere has none of these */
  private readonly benchmark = inject(BenchmarkService, { optional: true });
  private readonly replay = inject(ReplayService, { optional: true });
  private readonly facade = inject(TowerDefenseFacadeService, { optional: true });

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('importInput');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly injector = inject(Injector);

  readonly version = BUILD_VERSION;
  /** Quit exists where the app can end itself: the desktop build from 0.5.1 on */
  readonly canQuit = typeof this.bridge?.quit === 'function';
  readonly fullscreen = signal(false);
  readonly page = signal<GameMenuPage>('main');
  readonly confirm = signal<GameMenuConfirm | null>(null);
  /** The last save, load or export said this; a problem is `bad` */
  readonly status = signal<{ text: string; bad: boolean } | null>(null);
  /** A save, load or export is under way */
  readonly busy = signal(false);

  readonly inCoop = computed(() => this.coop.inGame());
  /** The run has begun: Restart, Load and Quit end something */
  private readonly underWay = computed(() => this.store.gameStarted() || this.store.towerCount() > 0);
  /** The benchmark reloads the page: not in coop, where the room would lose the player */
  readonly canBenchmark = computed(() => this.benchmark !== null && !this.inCoop());
  /** Restart needs the game's facade; in coop the host restarts at game over (docs/COOP_PLAN.md, R1) */
  readonly canRestart = computed(() => this.facade !== null && !this.inCoop());

  /** Loading replaces the run: between waves only, like saving */
  readonly canLoad = computed(() => !this.store.waveActive());
  readonly cannotLoadReason = computed(() => (this.canLoad() ? null : 'Loads between waves'));
  /**
   * The autosave, offered on top while the new run has not begun (as the
   * continue bar does); once the run is under way the autosave is this run's
   */
  readonly autosaveOffer = computed(() => {
    if (this.inCoop() || this.underWay() || !this.saves.hasAutosave()) return null;
    const autosave = this.saves.slots().find((slot) => slot.id === AUTOSAVE_SLOT);
    return autosave ? { location: autosave.location, wave: autosave.wave } : null;
  });
  readonly saveRows = computed(() => saveSlotRows(this.saves.slots()));
  readonly loadRows = computed(() => loadSlotRows(this.saves.slots()));

  readonly canExportReplay = computed(() => (this.replay?.recordedWave() ?? null) !== null);

  readonly presets = VFX_PRESET_CHOICES;
  readonly activePreset = computed(() => matchingVfxPreset(this.debugFacade.vfx()));
  readonly speeds = GAME_SPEEDS;
  readonly speed = this.store.gameSpeed;
  /** Coop: the speed belongs to the host (D15) */
  readonly speedLocked = computed(() => this.inCoop() && !this.coop.isHost());

  readonly volumes: readonly VolumeRow[] = [
    {
      label: 'Master', icon: 'audio', key: 'M',
      level: this.ui.masterVolume, muted: this.ui.masterMuted,
      set: (v) => { this.ui.masterVolume.set(v); this.ui.masterMuted.set(false); },
      toggleMute: () => this.ui.masterMuted.update((m) => !m),
    },
    {
      label: 'Effects', icon: 'sliders',
      level: this.ui.sfxVolume, muted: this.ui.sfxMuted,
      set: (v) => { this.ui.sfxVolume.set(v); this.ui.sfxMuted.set(false); },
      toggleMute: () => this.ui.sfxMuted.update((m) => !m),
    },
    {
      label: 'Music', icon: 'music',
      level: this.ui.musicVolume, muted: this.ui.musicMuted,
      set: (v) => { this.ui.musicVolume.set(v); this.ui.musicMuted.set(false); },
      toggleMute: () => this.ui.musicMuted.update((m) => !m),
    },
    {
      label: 'Interface', icon: 'gamepad',
      level: this.ui.uiVolume, muted: this.ui.uiMuted,
      set: (v) => { this.ui.uiVolume.set(v); this.ui.uiMuted.set(false); },
      toggleMute: () => this.ui.uiMuted.update((m) => !m),
    },
  ];

  constructor() {
    void this.readFullscreen();
    void this.saves.refresh();
    if (!this.inCoop() && !this.store.paused()) {
      this.store.paused.set(true);
      inject(DestroyRef).onDestroy(() => this.store.paused.set(false));
    }
  }

  // ---- Pages ----

  open(page: GameMenuPage): void {
    this.page.set(page);
    this.confirm.set(null);
    this.status.set(null);
    this.focusFirst();
  }

  back(): void {
    if (this.confirm()) this.cancelConfirm();
    else this.open('main');
  }

  /** What was clicked went with the page: the focus moves to the new page's first control */
  private focusFirst(): void {
    afterNextRender(() => {
      // The page's own controls first, Back in the header last
      const body = this.body()?.nativeElement;
      const controls = Array.from(body?.querySelectorAll<HTMLElement>('button:not([disabled]), input[type="range"]') ?? []);
      (controls.find((el) => !el.closest('.gm-header')) ?? controls[0])?.focus();
    }, { injector: this.injector });
  }

  private ask(confirm: GameMenuConfirm): void {
    this.confirm.set(confirm);
    this.focusFirst();
  }

  /** Esc steps back to the list; on the list it closes the menu (the dialog's own Esc) */
  onEscape(event: Event): void {
    if (this.page() === 'main' && !this.confirm()) return;
    event.preventDefault();
    event.stopPropagation();
    this.back();
  }

  /** Continue: back to the game */
  close(): void {
    this.dialogRef.close();
  }

  // ---- Save and load ----

  async saveTo(slotId: string, filled: boolean, title: string): Promise<void> {
    if (!this.saves.canSave()) return;
    if (filled && this.confirm()?.kind !== 'overwrite') {
      this.ask({ kind: 'overwrite', slotId, title });
      return;
    }
    this.cancelConfirm();
    await this.run(async () => {
      const result = await this.saves.save(slotId);
      this.status.set(result.ok ? { text: 'Saved.', bad: false } : { text: result.reason, bad: true });
    });
  }

  /** Load a slot; a run under way is asked about first */
  askLoad(slotId: string, title: string): void {
    if (!this.canLoad()) return;
    if (this.underWay()) {
      this.ask({ kind: 'load', slotId, title });
      return;
    }
    void this.loadSlot(slotId);
  }

  async loadSlot(slotId: string): Promise<void> {
    this.cancelConfirm();
    await this.run(async () => this.afterLoad(await this.saves.load(slotId)));
  }

  /** Continue the autosave (it may move to another place) */
  async continueAutosave(): Promise<void> {
    await this.run(async () => this.afterLoad(await this.saves.continueAutosave()));
  }

  /** Load from a file: ask about the run under way, then pick the file */
  askImport(): void {
    if (!this.canLoad()) return;
    if (this.underWay() && this.confirm()?.kind !== 'import') {
      this.ask({ kind: 'import' });
      return;
    }
    this.confirm.set(null);
    this.fileInput()?.nativeElement.click();
  }

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.run(async () => this.afterLoad(await this.saves.importFile(file)));
  }

  /** Loaded: back to the game, unless the save came from another version; then the menu says so first */
  private afterLoad(result: LoadResult): void {
    if (!result.ok) {
      this.status.set({ text: result.reason, bad: true });
    } else if (result.note) {
      this.status.set({ text: `Loaded. ${result.note}`, bad: false });
    } else {
      this.close();
    }
  }

  async exportSlot(slotId: string): Promise<void> {
    await this.run(async () => {
      const result = await this.saves.exportFile(slotId);
      if (!result.ok) this.status.set({ text: result.reason, bad: true });
    });
  }

  askDelete(slotId: string, title: string): void {
    this.ask({ kind: 'delete', slotId, title });
  }

  async deleteSlot(slotId: string): Promise<void> {
    this.cancelConfirm();
    await this.run(() => this.saves.deleteSlot(slotId));
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await work();
    } finally {
      this.busy.set(false);
    }
  }

  // ---- Settings ----

  private async readFullscreen(): Promise<void> {
    if (typeof this.bridge?.isFullscreen === 'function') {
      this.fullscreen.set(await this.bridge.isFullscreen());
    } else {
      this.fullscreen.set(!!document.fullscreenElement);
    }
  }

  /** The app switches its window as F11 does; a browser takes the page to fullscreen */
  async toggleFullscreen(): Promise<void> {
    if (typeof this.bridge?.toggleFullscreen === 'function') {
      this.fullscreen.set(await this.bridge.toggleFullscreen());
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused (an embedded frame, a browser setting): the state below says what is
    }
    this.fullscreen.set(!!document.fullscreenElement);
  }

  onVolume(row: VolumeRow, event: Event): void {
    row.set((event.target as HTMLInputElement).valueAsNumber / 100);
  }

  setPreset(preset: VfxPreset): void {
    this.debugFacade.onVfxPresetSelected(preset);
  }

  setSpeed(speed: number): void {
    if (this.speedLocked()) return;
    this.store.gameSpeed.set(speed);
  }

  // ---- More ----

  exportRunLog(): void {
    this.status.set(this.runLog.export()
      ? { text: 'Run log saved.', bad: false }
      : { text: 'No run to save yet.', bad: true });
  }

  async exportReplay(): Promise<void> {
    await this.run(async () => {
      const saved = (await this.replay?.saveFile()) ?? false;
      this.status.set(saved ? { text: 'Replay saved.', bad: false } : { text: 'No wave to save yet.', bad: true });
    });
  }

  /** The key screen: swap or clear the Cesium ion token or Google Maps key */
  openMapKey(): void {
    this.dialogRef.close();
    this.config.setupRequested.set(true);
  }

  /** The other dialogs open on their own, the menu makes room */
  openWhatsNew(): void {
    this.dialogRef.close();
    this.whatsNew.open();
  }

  openKeys(): void {
    this.dialogRef.close();
    void openHotkeyHelpDialog(this.dialog);
  }

  openAttributions(): void {
    this.dialogRef.close();
    void openAttributionsDialog(this.dialog);
  }

  askBenchmark(): void {
    this.ask({ kind: 'benchmark' });
  }

  /** Reload into the DevWorld and measure (BenchmarkService.start) */
  runBenchmark(): void {
    this.benchmark?.start();
  }

  // ---- Leaving the run ----

  /** Restart at the same place: asks first while a run is under way */
  restart(): void {
    if (!this.canRestart()) return;
    if (this.underWay() && this.confirm()?.kind !== 'restart') {
      this.ask({ kind: 'restart' });
      return;
    }
    this.facade?.restartGame();
    this.close();
  }

  /** Another place: the location dialog; the run ends only when a new place is confirmed there */
  changeLocation(): void {
    this.dialogRef.close();
    void this.location.openLocationDialog();
  }

  /** Straight out when nothing is at stake, otherwise ask first */
  quit(): void {
    if (!this.canQuit) return;
    const underWay = this.underWay() || this.inCoop();
    if (underWay && this.confirm()?.kind !== 'quit') {
      this.ask({ kind: 'quit' });
      return;
    }
    this.bridge?.quit?.();
  }

  cancelConfirm(): void {
    this.confirm.set(null);
    this.focusFirst();
  }

  /** A volume as the row shows it, 0 to 100 */
  percent(level: number): number {
    return Math.round(level * 100);
  }
}
