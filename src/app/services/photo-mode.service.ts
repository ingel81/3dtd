import { Injectable, Injector, afterNextRender, inject, signal } from '@angular/core';
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

  readonly active = this.uiStore.photoMode;
  /** A screenshot is on its way (capture, stamp, encode) */
  readonly saving = signal(false);

  enter(): void {
    if (this.active() || this.store.loading() || this.store.error()) return;
    // Nothing of the game UI in the picture: build preview, placement
    // markers, an ability's aiming reticle, the selected tower's range and LOS
    if (this.towerPlacement.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.abilityTargeting.targeting()) this.abilityTargeting.cancel();
    this.gameState.towerManager.selectTower(null);
    this.uiStore.openMenu.set(null);
    this.active.set(true);
    this.fitCanvasAfterLayout();
  }

  exit(): void {
    if (!this.active()) return;
    this.active.set(false);
    this.fitCanvasAfterLayout();
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
   */
  private fitCanvasAfterLayout(): void {
    afterNextRender(() => this.engineInit.getEngine()?.fitToCanvas(), { injector: this.injector });
  }
}
