import { ElementRef, Injectable, Injector, afterNextRender, inject, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { GameStateManager } from '../managers/game-state.manager';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { ConfigService } from '../core/services/config.service';
import { DevWorldService } from '../devworld/devworld.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { LocationManagementService } from './location/location-management.service';
import { MapPlacementService } from './world/map-placement.service';
import { TowerPlacementService } from './tower-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { SCREENSHOT_URL, downloadCanvasPng, loadImage, screenshotFileName, stampScreenshot } from '../utils/screenshot';
import { cycleTab, focusedElement } from '../utils/focus-cycle';

/** The game's logo, the watermark of a saved picture */
const BRAND_LOGO = 'assets/images/logo/logo.png';
const GOOGLE_LOGO = 'assets/images/ui/google-maps-logo.svg';
const CESIUM_LOGO = 'assets/images/ui/cesium-ion-logo.svg';

/**
 * Photo mode: the HUD goes (header, sidebar, overlays), the camera controls
 * stay, a small bar saves the canvas as PNG. State in UIStore.photoMode.
 *
 * Provided by the game component, like the facades: it deselects through the
 * component-scoped GameStateManager. O and Esc are game hotkeys
 * (hotkey-map.ts, HotkeyService).
 *
 * The focused control goes with the HUD, so the bar takes the focus, and
 * leaving gives it back together with the quick menu that was open; a screen
 * reader hears both changes. While it is on, Tab stays in the bar (trapTab).
 */
@Injectable()
export class PhotoModeService {
  private readonly uiStore = inject(UIStore);
  private readonly store = inject(TowerDefenseStore);
  private readonly gameState = inject(GameStateManager);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly config = inject(ConfigService);
  private readonly devWorld = inject(DevWorldService);
  private readonly injector = inject(Injector);
  /** The game component's element, whose template holds the photo bar */
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly announcer = inject(LiveAnnouncer);

  readonly active = this.uiStore.photoMode;
  /** A screenshot is on its way (capture, stamp, encode) */
  readonly saving = signal(false);

  /** Focus and open quick menu before enter(); exit() gives both back. */
  private focusBefore: HTMLElement | null = null;
  private menuBefore: ReturnType<UIStore['openMenu']> = null;

  enter(): void {
    if (this.active() || this.store.loading() || this.store.error()) return;
    this.focusBefore = focusedElement();
    this.menuBefore = this.uiStore.openMenu();
    // Nothing of the game UI in the picture: build preview, placement
    // markers, an ability's aiming reticle, the selected tower's range and
    // LOS, the veteran badges over the towers
    if (this.towerPlacement.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.abilityTargeting.targeting()) this.abilityTargeting.cancel();
    this.gameState.towerManager.selectTower(null);
    this.engineInit.getEngine()?.towerBadges.setVisible(false);
    this.uiStore.openMenu.set(null);
    this.active.set(true);
    this.announcer.announce('Photo mode. Esc leaves it.');
    this.afterLayout(() => this.barControls()[0]?.focus());
  }

  exit(): void {
    if (!this.active()) return;
    this.active.set(false);
    this.engineInit.getEngine()?.towerBadges.setVisible(true);
    this.uiStore.openMenu.set(this.menuBefore);
    const focus = this.focusBefore;
    this.focusBefore = null;
    this.announcer.announce('Photo mode left.');
    this.afterLayout(() => {
      if (focus?.isConnected) focus.focus();
    });
  }

  toggle(): void {
    if (this.active()) this.exit();
    else this.enter();
  }

  /**
   * Window keydown while photo mode is on: Tab and Shift+Tab go round the
   * bar's buttons and nowhere else. Header, sidebar and overlays are gone,
   * and what is left of the page (the map attribution) is no stop of photo
   * mode. From anywhere outside the bar, Tab comes back into it; Esc leaves.
   */
  trapTab(event: KeyboardEvent): void {
    if (!this.active()) return;
    cycleTab(event, this.barControls());
  }

  /** The bar's buttons that can take the focus, in tab order */
  private barControls(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.td-photo-bar button:not(:disabled)'));
  }

  /**
   * Next drawn frame as PNG download, with the map attribution, the game's
   * logo as a watermark and its address stamped in.
   */
  async saveScreenshot(): Promise<void> {
    const engine = this.engineInit.getEngine();
    if (!engine || this.saving()) return;
    this.saving.set(true);
    try {
      const [brandLogo, ...providerLogos] = await Promise.all([BRAND_LOGO, ...this.logoSources()].map(loadImage));
      const logos = providerLogos.filter((logo): logo is HTMLImageElement => logo !== null);
      const frame = await engine.captureFrame();
      if (!frame) return;
      stampScreenshot(frame, this.store.mapAttribution(), logos, { logo: brandLogo, url: SCREENSHOT_URL });
      await downloadCanvasPng(frame, screenshotFileName(this.locationMgmt.displayName(), new Date()));
    } finally {
      this.saving.set(false);
    }
  }

  /** The logos the screen shows next to the map; DevWorld has no tiles and none. */
  private logoSources(): string[] {
    if (this.devWorld.isActive) return [];
    return this.config.tileProvider() === 'cesium' ? [GOOGLE_LOGO, CESIUM_LOGO] : [GOOGLE_LOGO];
  }

  /**
   * Header and sidebar leave or come back. `then` runs once the DOM has
   * followed: focus can only go to what is on screen. The drawing buffer
   * follows the canvas' new size by itself (CanvasSizeFollower).
   */
  private afterLayout(then: () => void): void {
    afterNextRender(then, { injector: this.injector });
  }
}
