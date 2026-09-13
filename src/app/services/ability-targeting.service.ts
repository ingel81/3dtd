import { Injectable, effect, inject, signal } from '@angular/core';
import { Vector3 } from 'three';
import type { RouteSweep } from '../utils/route-sweep';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { ABILITIES, AbilityId } from '../configs/abilities.config';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';

/** Warning while no route cell is in reach of the cursor */
function noRouteWarning(id: AbilityId): string {
  return `No route within ${ABILITIES[id].snapRadiusM} m`;
}

/**
 * Targeting mode of the player abilities: the ability's button in the
 * ability bar or its key arms it, the next click on the map fires, Escape or a short right
 * click cancels. InputHandlerService routes the pointer here while it is on.
 *
 * While aiming, a ring of the strike radius follows the cursor, snapped to
 * the route cell the strike would land on: gold where it lands, red with a
 * warning where no route cell is in reach. For a beam the ring sits where
 * its sweep starts and a gold band shows the route stretch it would burn
 * along. The click sends command:use-ability with the clicked point; the
 * AbilityManager snaps it the same way and has the last word.
 */
@Injectable({ providedIn: 'root' })
export class AbilityTargetingService {
  private readonly uiStore = inject(UIStore);
  private readonly store = inject(TowerDefenseStore);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);

  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;
  private readonly scratch = new Vector3();

  /** Ability being aimed, null outside the targeting mode */
  readonly targeting = this.uiStore.abilityTargeting;

  /** Why the spot under the cursor would be refused, null while it is fine */
  readonly warning = signal<string | null>(null);

  constructor() {
    // Leave the mode once the ability cannot fire any more: the wave ended,
    // or the charge is gone
    effect(() => {
      const id = this.targeting();
      if (!id) return;
      if (!this.store.waveActive() || this.store.abilities()[id].charges <= 0) this.cancel();
    });
    // Build mode and map placement take over the pointer
    effect(() => {
      if (this.uiStore.buildMode() || this.uiStore.mapPlacementMode()) this.cancel();
    });
  }

  /** Engine for the aiming ring, game state for the snap and the command. Once per location. */
  initialize(engine: ThreeTilesEngine, gameState: GameStateManager): void {
    this.cancel();
    this.engine = engine;
    this.gameState = gameState;
  }

  /** Arm the targeting mode for `id`, or leave it when it is armed already. */
  toggle(id: AbilityId): void {
    if (this.targeting() === id) {
      this.cancel();
    } else {
      this.start(id);
    }
  }

  /** Arm the targeting mode, if `id` can fire now. One pointer mode at a time. */
  start(id: AbilityId): void {
    if (!this.gameState || this.gameState.abilityManager.checkUse(id) !== null) return;
    if (this.uiStore.buildMode()) this.towerPlacement.exitBuildMode();
    if (this.uiStore.mapPlacementMode()) this.mapPlacement.exitPlacementMode();
    this.warning.set(null);
    this.targeting.set(id);
  }

  cancel(): void {
    this.targeting.set(null);
    this.warning.set(null);
    this.engine?.abilityMarkers.hideAim();
  }

  /** Pointer moved over the map: the ring follows, snapped to where the strike would land. */
  hover(lat: number, lon: number, hitPoint: Vector3): void {
    const id = this.targeting();
    if (!id || !this.engine || !this.gameState) return;

    const radiusM = ABILITIES[id].radiusM;
    const manager = this.gameState.abilityManager;
    const beam = ABILITIES[id].effect.kind === 'beam';
    const sweep = beam ? manager.previewSweep(id, { lat, lon }) : null;
    const snapped = beam ? sweep?.points[0] ?? null : manager.resolveTarget(id, { lat, lon });
    if (snapped) {
      const center = this.engine.sync.geoToLocalSimpleInto(snapped.lat, snapped.lon, snapped.height ?? 0, this.scratch);
      if (sweep) {
        this.engine.abilityMarkers.showAim(center, radiusM, true, this.localPath(sweep));
      } else {
        this.engine.abilityMarkers.showAim(center, radiusM, true);
      }
      this.warning.set(null);
    } else {
      this.engine.abilityMarkers.showAim(hitPoint, radiusM, false);
      this.warning.set(noRouteWarning(id));
    }
  }

  /** The sweep's points in local coordinates, for the band on the ground. */
  private localPath(sweep: RouteSweep): Vector3[] {
    return sweep.points.map((p) => this.engine!.sync.geoToLocalSimpleInto(p.lat, p.lon, p.height ?? 0, new Vector3()));
  }

  /** Left click on the map: fire, or stay in the mode and say why not. */
  click(lat: number, lon: number, height: number): void {
    const id = this.targeting();
    if (!id || !this.gameState) return;

    if (!this.gameState.abilityManager.resolveTarget(id, { lat, lon, height })) {
      this.warning.set(noRouteWarning(id));
      return;
    }
    this.gameState.getEventBus().emit({
      type: 'command:use-ability',
      abilityId: id,
      target: { lat, lon, height },
    });
    this.cancel();
  }
}
