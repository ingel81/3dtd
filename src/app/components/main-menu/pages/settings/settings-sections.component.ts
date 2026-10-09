import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent, type TdIconName } from '../../../icon/icon.component';
import { RovingGroupDirective } from '../../../roving-group.directive';
import { UIStore } from '../../../../store/ui.store';
import { GameStore } from '../../../../store/game.store';
import { COOP } from '../../../../services/coop.token';
import { ConfigService } from '../../../../core/services/config.service';
import { DebugFacadeService, FPS_LIMITS } from '../../../../services/debug/debug-facade.service';
import { VFX_PRESET_CHOICES, matchingVfxPreset, type VfxPreset, type VfxSettings } from '../../../../three-engine/vfx-settings';
import { COLOR_GRADING_PRESETS, type ColorGradingPreset } from '../../../../three-engine/post-processing/color-grading';
import { GAME_SPEEDS } from '../../../../configs/game-speed.config';
import { readDesktopBridge } from '../../../../core/desktop-bridge';
import { readRunUploadConsent, writeRunUploadConsent } from '../../../../run-log/run-upload';

/** One volume row: the channel's level and mute in UIStore */
interface VolumeRow {
  label: string;
  icon: TdIconName;
  level: () => number;
  muted: () => boolean;
  set: (level: number) => void;
  toggleMute: () => void;
}

type VfxSwitch = Exclude<keyof VfxSettings, 'colorGrading'>;

/** A display switch: what it shows, whether it is on, how it changes */
interface SwitchRow {
  label: string;
  hint: string;
  on: () => boolean;
  toggle: () => void;
}

/**
 * The menu's Settings page (plan E121: Audio, Graphics, Gameplay, Map,
 * Coop, Privacy on one page). Every setting is stored where it was before:
 * the volumes and the auto-start in the UI state (td-ui-state), the display
 * switches in td_display_options through the DebugFacadeService, the tile
 * key in ConfigService, the coop name and lobbies in the CoopService, the
 * run upload answer in 3dtd-run-upload. The debug window's display switches
 * stay where they are and read the same signals.
 */
@Component({
  selector: 'app-settings-sections',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, RovingGroupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-sections.component.html',
  styleUrl: './settings-sections.component.scss',
  host: { class: 'td-stack is-loose' },
})
export class SettingsSectionsComponent {
  readonly ui = inject(UIStore);
  private readonly store = inject(GameStore);
  private readonly config = inject(ConfigService);
  private readonly display = inject(DebugFacadeService);
  /** The game's coop service; the Coop section needs it */
  readonly coop = inject(COOP, { optional: true });
  private readonly bridge = readDesktopBridge();

  /** "Change key" was pressed: the menu makes way for the key step */
  readonly leave = output<void>();

  // ---- Audio ----

  readonly volumes: readonly VolumeRow[] = [
    {
      label: 'Master', icon: 'audio',
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

  onVolume(row: VolumeRow, event: Event): void {
    row.set((event.target as HTMLInputElement).valueAsNumber / 100);
  }

  /** A volume as the row shows it, 0 to 100 */
  percent(level: number): number {
    return Math.round(level * 100);
  }

  // ---- Graphics ----

  readonly presets = VFX_PRESET_CHOICES;
  readonly activePreset = computed(() => matchingVfxPreset(this.display.vfx()));
  readonly colorGradings = COLOR_GRADING_PRESETS;
  readonly colorGrading = computed(() => this.display.vfx().colorGrading);
  readonly fpsLimits = FPS_LIMITS;
  readonly fpsLimit = this.display.fpsLimit;

  /** The switches the presets set, then the ones they leave alone */
  readonly switches: readonly SwitchRow[] = [
    this.vfxSwitch('muzzleFlash', 'Muzzle flash', 'Flash and light at the barrel of guns, launcher and bow'),
    this.vfxSwitch('projectileTrails', 'Projectile trails', 'Streaks and particle trails behind projectiles'),
    this.vfxSwitch('impactEffects', 'Impact effects', 'Explosions, smoke, spark bursts and blood spray at hits'),
    this.vfxSwitch('groundMarks', 'Ground marks', 'Blood, frost, scorch marks and ooze puddles on the ground'),
    this.vfxSwitch('bloom', 'Bloom', 'Glow around bright surfaces, an extra full-screen pass'),
    this.vfxSwitch('freezeTint', 'Freeze tint', 'Blue tint and ice sparks on slowed enemies'),
    this.vfxSwitch('bloodMoon', 'Blood Moon', 'Every 7th wave from wave 14: red night, glowing enemies, searchlights on the towers. Looks only'),
    {
      label: 'Screen shake', hint: 'Nearby explosions, HQ damage and boss deaths shake the view',
      on: this.display.screenShakeEnabled,
      toggle: () => this.display.onScreenShakeToggled(!this.display.screenShakeEnabled()),
    },
    {
      label: 'Boss intro', hint: 'Camera cut to a boss as it steps out of its portal; the game pauses meanwhile',
      on: this.display.bossIntroEnabled,
      toggle: () => this.display.onBossIntroToggled(!this.display.bossIntroEnabled()),
    },
    {
      label: 'Health bars', hint: 'Hold Alt to show them the other way round',
      on: this.display.healthBarsVisible,
      toggle: () => this.display.onHealthBarsToggled(!this.display.healthBarsVisible()),
    },
    {
      label: 'Damage numbers', hint: 'Numbers rising from enemies that are hit',
      on: this.display.damageNumbersVisible,
      toggle: () => this.display.onDamageNumbersToggled(!this.display.damageNumbersVisible()),
    },
  ];

  private vfxSwitch(key: VfxSwitch, label: string, hint: string): SwitchRow {
    return {
      label, hint,
      on: () => this.display.vfx()[key],
      toggle: () => this.display.onVfxSettingsChanged({ [key]: !this.display.vfx()[key] }),
    };
  }

  setPreset(preset: VfxPreset): void {
    this.display.onVfxPresetSelected(preset);
  }

  setColorGrading(event: Event): void {
    this.display.onVfxSettingsChanged({ colorGrading: (event.target as HTMLSelectElement).value as ColorGradingPreset });
  }

  setFpsLimit(limit: (typeof FPS_LIMITS)[number]): void {
    this.display.onFpsLimitChanged(limit);
  }

  readonly fullscreen = signal(false);

  private async readFullscreen(): Promise<void> {
    if (typeof this.bridge?.isFullscreen === 'function') this.fullscreen.set(await this.bridge.isFullscreen());
    else this.fullscreen.set(typeof document !== 'undefined' && !!document.fullscreenElement);
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

  // ---- Gameplay ----

  readonly speeds = GAME_SPEEDS;
  readonly speed = this.store.gameSpeed;
  /** Coop: the speed belongs to the host (D15) */
  readonly speedLocked = computed(() => !!this.coop?.inGame() && !this.coop.isHost());

  setSpeed(speed: number): void {
    if (this.speedLocked()) return;
    this.store.gameSpeed.set(speed);
  }

  toggleAutoStart(): void {
    this.ui.autoStartWaves.update((on) => !on);
  }

  // ---- Map ----

  readonly provider = computed(() => (this.config.tileProvider() === 'google' ? 'Google Maps' : 'Cesium ion'));

  /** The key step: swap or clear the Cesium ion token or the Google Maps key */
  changeKey(): void {
    this.config.setupRequested.set(true);
    this.leave.emit();
  }

  // ---- Coop ----

  readonly playerName = signal(this.coop?.name ?? '');
  readonly newLobbyName = signal('');
  readonly newLobbyUrl = signal('');
  readonly lobbyNote = signal<{ ok: boolean; text: string } | null>(null);

  setPlayerName(value: string): void {
    this.playerName.set(value);
    if (this.coop) this.coop.name = value.trim() || 'Player';
  }

  addLobby(): void {
    const coop = this.coop;
    if (!coop) return;
    if (!coop.addLobby(this.newLobbyName(), this.newLobbyUrl())) {
      this.lobbyNote.set({ ok: false, text: 'That is no lobby address (ws:// or wss://).' });
      return;
    }
    this.newLobbyName.set('');
    this.newLobbyUrl.set('');
    void this.checkLobby();
  }

  /** Whether the lobby just added answers and takes this version; one that is down says so once */
  private async checkLobby(): Promise<void> {
    const lobby = this.coop?.lobby();
    if (!this.coop || !lobby) return;
    this.lobbyNote.set({ ok: true, text: 'Asking…' });
    const answer = await this.coop.probeLobby(lobby.url);
    this.lobbyNote.set(answer.down ? { ok: false, text: `${lobby.name} does not answer right now.` } : { ok: answer.ok, text: answer.text });
  }

  removeLobby(url: string): void {
    this.coop?.removeLobby(url);
    this.lobbyNote.set(null);
  }

  // ---- Privacy ----

  /** Coop run logs go to a relay that collects them (TODO E38); asked once after a coop game */
  readonly uploadRuns = signal(readRunUploadConsent() === 'yes');

  setUploadRuns(yes: boolean): void {
    writeRunUploadConsent(yes ? 'yes' : 'no');
    this.uploadRuns.set(yes);
  }

  constructor() {
    void this.readFullscreen();
  }
}
