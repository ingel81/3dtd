import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Vector3 } from 'three';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { CameraControlService } from './camera-control.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { HERO, HeroAmmoId, nextHeroAmmo } from '../configs/hero.config';
import type { GeoPosition } from '../models/game.types';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import { uiSound } from './ui-sound';

/** Warning while no route point is in reach of the cursor */
const NO_ROUTE_WARNING = `No route within ${HERO.orderSnapM} m`;

/**
 * Selecting and ordering the hero: a click on him or G selects him, his
 * button in the ability bar as well. While he is selected the next click on
 * the ground sends him to the route point nearest to it (command:hero-move),
 * a move ring shows where under the cursor, V or the panel switches his ammo
 * (command:hero-ammo). Escape, a short right click or a click on him again
 * lets him go; so do building, placing the HQ or a spawn, aiming an ability,
 * photo mode and selecting a tower, which take the pointer or the panel.
 *
 * Every order goes out as a command; the HeroManager snaps and has the last
 * word, this only previews it. InputHandlerService routes the pointer here
 * while he is selected.
 */
@Injectable({ providedIn: 'root' })
export class HeroControlService {
  private readonly uiStore = inject(UIStore);
  private readonly store = inject(TowerDefenseStore);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly introFlight = inject(IntroCameraFlightService);

  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;
  private readonly scratch = new Vector3();

  /** He is selected */
  readonly selected = this.uiStore.heroSelected;

  /** Why the spot under the cursor would be refused, null while it is fine */
  readonly warning = signal<string | null>(null);

  constructor() {
    // Let him go when something else takes the pointer or the panel, or he is gone (restart)
    effect(() => {
      if (!this.selected()) return;
      const taken = this.uiStore.buildMode()
        || this.uiStore.mapPlacementMode() !== null
        || this.uiStore.abilityTargeting() !== null
        || this.uiStore.photoMode()
        || this.store.selectedTower() !== null
        || !this.store.hero().hired;
      if (taken) untracked(() => this.deselect());
    });
    // The rings under him and on his post follow the selection
    effect(() => {
      const on = this.selected();
      untracked(() => this.engine?.hero.setSelected(on));
    });
  }

  /** Engine for the rings and the pick, game state for the preview and the commands. Once per location. */
  initialize(engine: ThreeTilesEngine, gameState: GameStateManager): void {
    this.deselect();
    this.engine = engine;
    this.gameState = gameState;
  }

  /** Select him, if he is hired. Leaves build mode, placement and aiming, deselects the tower. */
  select(): boolean {
    if (!this.gameState || !this.store.hero().hired || this.uiStore.photoMode()) return false;
    if (this.uiStore.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    if (this.uiStore.abilityTargeting()) this.abilityTargeting.cancel();
    this.gameState.towerManager.selectTower(null);
    this.warning.set(null);
    this.selected.set(true);
    return true;
  }

  deselect(): void {
    this.selected.set(false);
    this.warning.set(null);
    this.engine?.hero.hideMoveTarget();
  }

  /** A click on him: select him, or let him go when he is selected. */
  toggle(): void {
    if (this.selected()) this.deselect();
    else this.select();
  }

  /**
   * G and his bar button: select him, or bring him into view when he is
   * selected. Not in photo mode, no camera while the intro flight plays.
   */
  summon(): boolean {
    if (this.uiStore.photoMode()) return false;
    if (!this.selected()) return this.select();
    const at = this.position();
    if (!at || this.introFlight.active()) return false;
    return this.cameraControl.focusGeo(at.lat, at.lon);
  }

  /**
   * His bar button before the hire. The HeroManager checks research and
   * credits; its refusal shows in the context hint box (RefusalHintService).
   */
  hire(): boolean {
    if (!this.gameState) return false;
    this.gameState.getEventBus().emit({ type: 'command:hire-hero' });
    return true;
  }

  /** Where he stands, null until hired. */
  position(): GeoPosition | null {
    const hero = this.gameState?.heroManager.getHero();
    return hero ? { lat: hero.position.lat, lon: hero.position.lon } : null;
  }

  /** Whether his model is under the screen point. */
  pick(screenX: number, screenY: number): boolean {
    if (!this.engine) return false;
    return this.engine.picker.hits(screenX, screenY, this.engine.hero.pickTarget());
  }

  /** Pointer moved over the map while he is selected: the move ring on the route point he would go to. */
  hover(lat: number, lon: number, hitPoint: Vector3): void {
    if (!this.selected() || !this.engine || !this.gameState) return;
    const snapped = this.gameState.heroManager.resolveMoveTarget({ lat, lon });
    if (snapped) {
      const center = this.engine.sync.geoToLocalSimpleInto(snapped.lat, snapped.lon, 0, this.scratch);
      center.y = this.gameState.getGlobalRouteGrid().getGroundLocalYAt(center.x, center.z) ?? hitPoint.y;
      this.engine.hero.showMoveTarget(center, true);
      this.warning.set(null);
    } else {
      this.engine.hero.showMoveTarget(hitPoint, false);
      this.warning.set(NO_ROUTE_WARNING);
    }
  }

  /** Left click on the ground while he is selected: send him, or stay selected and say why not. */
  click(lat: number, lon: number, height: number): void {
    if (!this.selected() || !this.gameState) return;
    if (!this.gameState.heroManager.resolveMoveTarget({ lat, lon, height })) {
      this.warning.set(NO_ROUTE_WARNING);
      uiSound.play('denied');
      return;
    }
    this.warning.set(null);
    uiSound.play('heroMove');
    this.gameState.getEventBus().emit({ type: 'command:hero-move', target: { lat, lon, height } });
  }

  /** Load `ammo`. */
  setAmmo(ammo: HeroAmmoId): boolean {
    if (!this.gameState || !this.store.hero().hired) return false;
    this.gameState.getEventBus().emit({ type: 'command:hero-ammo', ammo });
    return true;
  }

  /** V: the next ammo round the list. */
  cycleAmmo(): boolean {
    return this.setAmmo(nextHeroAmmo(this.store.hero().ammo));
  }
}
