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
import { downloadCanvasPng, loadImage, screenshotFileName, stampAttribution } from '../utils/screenshot';

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
 * reader hears both changes.
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
    // markers, an ability's aiming reticle, the selected tower's range and LOS
    if (this.towerPlacement.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.abilityTargeting.targeting()) this.abilityTargeting.cancel();
    this.gameState.towerManager.selectTower(null);
    this.uiStore.openMenu.set(null);
    this.active.set(true);
    this.announcer.announce('Photo mode. Esc leaves it.');
    this.afterLayout(() => this.host.nativeElement.querySelector<HTMLElement>('.td-photo-bar button')?.focus());
  }

  exit(): void {
    if (!this.active()) return;
    this.active.set(false);
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

  /** Next drawn frame as PNG download, with the map attribution stamped in. */
  async saveScreenshot(): Promise<void> {
    const engine = this.engineInit.getEngine();
    if (!engine || this.saving()) return;
    this.saving.set(true);
    try {
      const logos = (await Promise.all(this.logoSources().map(loadImage)))
        .filter((logo): logo is HTMLImageElement => logo !== null);
      const frame = await engine.captureFrame();
      if (!frame) return;
      stampAttribution(frame, this.store.mapAttribution(), logos);
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
   * Header and sidebar leave or come back, so the canvas changes size. Its
   * drawing buffer follows once the DOM has, otherwise the picture stretches.
   * `then` runs after it: focus can only go to what is on screen.
   */
  private afterLayout(then: () => void): void {
    afterNextRender(() => {
      this.engineInit.getEngine()?.fitToCanvas();
      then();
    }, { injector: this.injector });
  }
}

/** The focused element, null when nothing but the page has the focus. */
function focusedElement(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}
