import { ChangeDetectionStrategy, Component, computed, inject, isDevMode, output, signal } from '@angular/core';
import { I18n, injectT } from '../../../../i18n/i18n.service';
import type { Messages } from '../../../../i18n/messages/en';
import { LOCALES, LOCALE_NAMES, PSEUDO_LOCALE, isLocalePreference, type Locale, type LocalePreference } from '../../../../i18n/locale';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent, type TdIconName } from '../../../icon/icon.component';
import { RovingGroupDirective } from '../../../roving-group.directive';
import { UIStore } from '../../../../store/ui.store';
import { GameStore } from '../../../../store/game.store';
import { COOP } from '../../../../services/coop.token';
import { PLAYER_NAME_FALLBACK } from '../../../../coop/coop-name';
import { ConfigService } from '../../../../core/services/config.service';
import { DebugFacadeService, FPS_LIMITS } from '../../../../services/debug/debug-facade.service';
import { GlobeDirectorService, type GlobeSetting } from '../../../../services/world/globe-director.service';
import { VFX_PRESET_IDS, matchingVfxPreset, type VfxPreset, type VfxSettings } from '../../../../three-engine/vfx-settings';
import { COLOR_GRADING_PRESETS, type ColorGradingPreset } from '../../../../three-engine/post-processing/color-grading';
import { GAME_SPEEDS } from '../../../../configs/game-speed.config';
import { readAgentBridge, readDesktopBridge, type AgentStatus } from '../../../../core/desktop-bridge';
import { readRunUploadConsent, writeRunUploadConsent } from '../../../../run-log/run-upload';
import { RenderQualityService } from '../../../../services/infrastructure/render-quality.service';
import { RendererHostService } from '../../../../services/infrastructure/renderer-host.service';
import {
  LIGHTNING_FLASHES, PLANT_MOTIONS, QUALITY_LEVELS, QUALITY_TABLE, pixelRatioFor, type LightningFlash, type PlantMotion, type QualityKnobs, type QualityLevel,
  type QualitySetting, type QualityStep, type QualitySwitch, type QualityWorld,
} from '../../../../three-engine/render-quality';

/** One volume row: the channel's level and mute in UIStore */
interface VolumeRow {
  id: 'master' | 'effects' | 'music' | 'interface';
  icon: TdIconName;
  level: () => number;
  muted: () => boolean;
  set: (level: number) => void;
  toggleMute: () => void;
}

type VfxSwitch = Exclude<keyof VfxSettings, 'colorGrading'>;

type SwitchId = VfxSwitch | 'screenShake' | 'bossIntro' | 'healthBars' | 'damageNumbers';

/** A display switch: what it shows (by id in the dictionary), whether it is on, how it changes */
interface SwitchRow {
  id: SwitchId;
  on: () => boolean;
  toggle: () => void;
}

/** A part of a world the player sets on top of the level, as a row of levels */
interface StepRow {
  id: QualityStep;
  label: string;
  hint: string;
  options: { level: QualityLevel; label: string; hint: string }[];
}

/** The levels of step `id`, each named and with what it sets; `offWhen` names a level that switches the part off */
function stepRow(t: Messages, id: QualityStep, option: (k: QualityKnobs) => string, offWhen?: (k: QualityKnobs) => boolean): StepRow {
  const words = t.settings.steps[id];
  return {
    id, label: words.label, hint: words.hint,
    options: QUALITY_LEVELS.map((level) => {
      const k = QUALITY_TABLE[level];
      return { level, label: offWhen?.(k) ? t.settings.off : t.settings.levels[level], hint: option(k) };
    }),
  };
}

/** What a level draws at on `world`: resolution and antialiasing (the level alone sets them) */
function pictureLine(t: Messages, k: QualityKnobs, world: QualityWorld): string {
  const g = k.general;
  const cap = pixelRatioFor({ ...k, general: { ...g, scale: 1 } }, world, 99);
  return t.settings.picture({
    dynamic: !!g.dynamic, scale: Math.round(g.scale * 100), cap,
    min: Math.round((g.dynamic?.min ?? 0) * 100), max: Math.round((g.dynamic?.max ?? 0) * 100),
    msaa: g.antialias === 'msaa', bloom: g.bloom,
  });
}

/** A tab of the Settings page (TODO E138) */
export type SettingsTab = 'audio' | 'graphics' | 'gameplay' | 'map' | 'coop' | 'privacy';

/** The tab the page opens on next time, for this page load */
let lastTab: SettingsTab = 'audio';

/**
 * The menu's Settings page (plan E121: Audio, Graphics, Gameplay, Map,
 * Coop, Privacy; one tab each since E138, the page had run long). The page
 * opens on the tab it was left on. Every setting is stored where it was before:
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
  private readonly i18n = inject(I18n);
  protected readonly t = injectT();
  /** The languages to pick: the system's (named in the language it stands for), each language in its own words; the pseudo language in a development build */
  readonly locales = computed((): { id: LocalePreference; label: string }[] => [
    { id: 'system', label: this.t().settings.languageSystem(LOCALE_NAMES[this.i18n.systemLocale]) },
    ...([...LOCALES, ...(isDevMode() ? [PSEUDO_LOCALE] : [])] as Locale[]).map((id) => ({ id, label: LOCALE_NAMES[id] })),
  ]);

  setLocale(e: Event): void {
    const value = (e.target as HTMLSelectElement).value;
    if (isLocalePreference(value)) this.ui.localePreference.set(value);
  }
  private readonly store = inject(GameStore);
  private readonly config = inject(ConfigService);
  private readonly display = inject(DebugFacadeService);
  /** The menu globe's quality (docs/GLOBE_PLAN.md) */
  readonly globe = inject(GlobeDirectorService);
  readonly globeOptions: readonly GlobeSetting[] = ['high', 'low', 'off'];
  /** The game's coop service; the Coop section needs it */
  readonly coop = inject(COOP, { optional: true });
  private readonly bridge = readDesktopBridge();

  /** "Change key" was pressed: the menu makes way for the key step */
  readonly leave = output<void>();

  /** The tabs; Coop only with the game's coop service */
  readonly tabs: readonly SettingsTab[] = ['audio', 'graphics', 'gameplay', 'map', ...(this.coop ? ['coop' as const] : []), 'privacy'];
  /** The tab shown */
  readonly tab = signal<SettingsTab>(lastTab === 'coop' && !this.coop ? 'audio' : lastTab);

  /** Show tab `id`; the page opens on it again next time */
  selectTab(id: SettingsTab): void {
    lastTab = id;
    this.tab.set(id);
  }


  // ---- Audio ----

  readonly volumes: readonly VolumeRow[] = [
    {
      id: 'master', icon: 'audio',
      level: this.ui.masterVolume, muted: this.ui.masterMuted,
      set: (v) => { this.ui.masterVolume.set(v); this.ui.masterMuted.set(false); },
      toggleMute: () => this.ui.masterMuted.update((m) => !m),
    },
    {
      id: 'effects', icon: 'sliders',
      level: this.ui.sfxVolume, muted: this.ui.sfxMuted,
      set: (v) => { this.ui.sfxVolume.set(v); this.ui.sfxMuted.set(false); },
      toggleMute: () => this.ui.sfxMuted.update((m) => !m),
    },
    {
      id: 'music', icon: 'music',
      level: this.ui.musicVolume, muted: this.ui.musicMuted,
      set: (v) => { this.ui.musicVolume.set(v); this.ui.musicMuted.set(false); },
      toggleMute: () => this.ui.musicMuted.update((m) => !m),
    },
    {
      id: 'interface', icon: 'gamepad',
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

  /** The picture's quality level (render-quality.ts): one choice for both worlds, parts of each set apart below it (E156) */
  readonly quality = inject(RenderQualityService);
  private readonly renderers = inject(RendererHostService);
  readonly qualityOptions: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];

  /** What the shared level plays per world, own mixes named */
  readonly qualityResolved = computed(() => {
    const s = this.t().settings;
    const world = (name: string, w: QualityWorld) => s.worldLevel(name, s.levels[this.quality.levelFor(w)], this.quality.mixed(w).length > 0);
    return `${world(s.realPlaces, 'tiles')} | ${world(s.customMaps, 'custom-map')}`;
  });

  readonly qualityNote = computed(() => {
    const s = this.t().settings;
    if (this.quality.fromUrl) return s.qualityFromUrl;
    const note = this.quality.setting() !== 'auto' ? s.levelSetsAll : s.autoNote(this.quality.autoMeasured());
    return this.renderers.antialiasPending() ? `${note} ${s.antialiasNextStart}` : note;
  });

  /** One world's section: its level, whether the player mixed it, what it draws at */
  private worldState(world: QualityWorld) {
    const t = this.t();
    const level = this.quality.levelFor(world);
    return { level: t.settings.levels[level], mixed: this.quality.mixed(world).length > 0, picture: pictureLine(t, QUALITY_TABLE[level], world) };
  }

  readonly tilesState = computed(() => this.worldState('tiles'));
  readonly mapsState = computed(() => this.worldState('custom-map'));

  /** Real places: only the tiles' own detail acts there; shadows and the map effects exist on custom maps only */
  readonly tileSteps = computed((): readonly StepRow[] => {
    const t = this.t();
    return [stepRow(t, 'tileDetail', (k) => t.settings.steps.tileDetail.option(k.tiles.errorTarget))];
  });

  /** Custom maps: the parts the level sets that the player may set apart */
  readonly mapSteps = computed((): readonly StepRow[] => {
    const t = this.t();
    const steps = t.settings.steps;
    return [
      stepRow(t, 'shadows', (k) => steps.shadows.option(k.customMaps.shadowMapSize, k.customMaps.shadowRadius > 1.5)),
      stepRow(t, 'farDetail', (k) => steps.farDetail.option(k.customMaps.lodBias, k.customMaps.impostorFrom, k.customMaps.farSingle)),
      stepRow(t, 'grass', (k) => steps.grass.option(k.customMaps.grassBlades, k.customMaps.grassFarBlades), (k) => !k.customMaps.grassBlades),
    ];
  });

  readonly mapSwitches: readonly QualitySwitch[] = ['refraction', 'seaWaves', 'lavaGlow', 'shadowCascade'];

  /** How grass, trees and plants move in the map's wind; no level changes it */
  readonly plantMotions: readonly PlantMotion[] = PLANT_MOTIONS;

  /** How a storm's lightning flashes; no level changes it */
  readonly lightningFlashes: readonly LightningFlash[] = LIGHTNING_FLASHES;

  /** What the level sets on custom maps and no switch here changes */
  readonly mapFixed = computed(() => {
    const knobs = this.quality.knobsFor('custom-map');
    return this.t().settings.mapFixed(Math.round(knobs.customMaps.particles * 100), knobs.customMaps.pointLights, knobs.general.shotLights);
  });

  stepValue(id: QualityStep): QualityLevel {
    return this.quality.overrideValue(id) as QualityLevel;
  }

  switchOn(id: QualitySwitch): boolean {
    return this.quality.overrideValue(id) as boolean;
  }

  setStep(id: QualityStep, level: QualityLevel): void {
    this.quality.setOverride(id, level);
  }

  toggleMapSwitch(id: QualitySwitch): void {
    this.quality.setOverride(id, !this.switchOn(id));
  }

  resetWorld(world: QualityWorld): void {
    this.quality.resetOverrides(world);
  }

  setQuality(setting: QualitySetting): void {
    if (this.quality.fromUrl) return;
    this.quality.set(setting);
  }

  readonly presets = VFX_PRESET_IDS;
  readonly activePreset = computed(() => matchingVfxPreset(this.display.vfx()));
  readonly colorGradings = COLOR_GRADING_PRESETS;
  readonly colorGrading = computed(() => this.display.vfx().colorGrading);
  readonly fpsLimits = FPS_LIMITS;
  readonly fpsLimit = this.display.fpsLimit;

  /** The switches the presets set, then the ones they leave alone */
  readonly switches: readonly SwitchRow[] = [
    this.vfxSwitch('muzzleFlash'),
    this.vfxSwitch('projectileTrails'),
    this.vfxSwitch('impactEffects'),
    this.vfxSwitch('groundMarks'),
    this.vfxSwitch('bloom'),
    this.vfxSwitch('freezeTint'),
    this.vfxSwitch('bloodMoon'),
    {
      id: 'screenShake',
      on: this.display.screenShakeEnabled,
      toggle: () => this.display.onScreenShakeToggled(!this.display.screenShakeEnabled()),
    },
    {
      id: 'bossIntro',
      on: this.display.bossIntroEnabled,
      toggle: () => this.display.onBossIntroToggled(!this.display.bossIntroEnabled()),
    },
    {
      id: 'healthBars',
      on: this.display.healthBarsVisible,
      toggle: () => this.display.onHealthBarsToggled(!this.display.healthBarsVisible()),
    },
    {
      id: 'damageNumbers',
      on: this.display.damageNumbersVisible,
      toggle: () => this.display.onDamageNumbersToggled(!this.display.damageNumbersVisible()),
    },
  ];

  private vfxSwitch(key: VfxSwitch): SwitchRow {
    return {
      id: key,
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
    // The stand-in name goes to the other players as it is: a name, the same in every language
    if (this.coop) this.coop.name = value.trim() || PLAYER_NAME_FALLBACK;
  }

  addLobby(): void {
    const coop = this.coop;
    if (!coop) return;
    if (!coop.addLobby(this.newLobbyName(), this.newLobbyUrl())) {
      this.lobbyNote.set({ ok: false, text: this.t().settings.noLobbyAddress });
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
    this.lobbyNote.set({ ok: true, text: this.t().settings.asking });
    const answer = await this.coop.probeLobby(lobby.url);
    this.lobbyNote.set(answer.down ? { ok: false, text: this.t().settings.lobbyDown(lobby.name) } : { ok: answer.ok, text: answer.text });
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

  /** AI agents editing maps over MCP, desktop app only (docs/AGENT_MCP.md); off until switched on here */
  readonly agent = readAgentBridge();
  readonly agentStatus = signal<AgentStatus>({ enabled: false, url: null });
  readonly agentCopied = signal(false);

  async setAgentEnabled(on: boolean): Promise<void> {
    if (!this.agent) return;
    const status = await this.agent.setEnabled(on);
    if (status) this.agentStatus.set(status);
  }

  async copyAgentUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.agentCopied.set(true);
      setTimeout(() => this.agentCopied.set(false), 2000);
    } catch {
      // The address stays on the page to select by hand
    }
  }

  constructor() {
    void this.readFullscreen();
    void this.agent?.status().then((status) => status && this.agentStatus.set(status));
  }
}
