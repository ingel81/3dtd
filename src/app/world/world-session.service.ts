import { Injectable, inject, signal } from '@angular/core';
import { LocationManagementService } from '../services/location/location-management.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { closeCustomMaps } from './custom-map/custom-map-world';
import { AppScreen } from './app-screen.service';
import { WorldStartService, type WorldStart } from './world-start';

/**
 * Opens worlds in this page, without a reload (docs/WORLDS_NAVIGATION_PLAN.md,
 * phase 2). A world is the game component with everything it provides: its
 * engine and canvas, the sim worker, the presentation, the menus. Opening
 * another sets the start order and counts `world` up; the game host
 * (GameHostComponent) then takes the old game down and makes a new one on a
 * fresh canvas (its MSAA follows the world). What the root keeps of a run
 * goes when the old game is gone (closed), before the new one starts.
 *
 * At most one world is open: one engine, one sim worker, one game canvas.
 * From the map editor (AppScreen) a world opens once the editor let go.
 */
@Injectable({ providedIn: 'root' })
export class WorldSession {
  private readonly start = inject(WorldStartService);
  private readonly store = inject(TowerDefenseStore);
  private readonly location = inject(LocationManagementService);
  private readonly screens = inject(AppScreen);
  /** What hears that the open world goes for another one in the page, see onLeaving */
  private readonly leaving = new Set<() => void>();

  /** Counts the worlds this page opened; the game host makes the game anew when it changes */
  readonly world = signal(0);

  /**
   * Open the world of `order` in this page, the open one goes. From the map
   * editor the game shows first, once the editor saved (AppScreen.showGame);
   * an editor that stays (its save failed) keeps the screen.
   */
  open(order: WorldStart): void {
    if (this.screens.screen() !== 'game') {
      void this.screens.showGame().then((shown) => {
        if (shown) this.openHere(order);
      });
      return;
    }
    this.openHere(order);
  }

  /**
   * From the map editor: the game in this window again. A run that waits
   * (AppScreen.waitingRun) opens in its world and loads its autosave there;
   * without one the world before is made anew from its start order.
   */
  backToGame(): void {
    const run = this.screens.waitingRun();
    void this.screens.showGame().then((shown) => {
      if (shown && run) this.openHere(run.order);
    });
  }

  /**
   * The open world once more, made anew: after a new tile key the whole tile
   * pipeline is built again. Its save, if it had one, is not loaded twice.
   */
  reopen(): void {
    this.open({ ...this.start.current(), resume: null });
  }

  /**
   * `listener` hears that the open world goes for another one in this page,
   * while its game still stands: what outlives a world (a coop room in the
   * lobby, CoopRoomCarry) is handed on there. Returns the unsubscribe.
   */
  onLeaving(listener: () => void): () => void {
    this.leaving.add(listener);
    return () => this.leaving.delete(listener);
  }

  /**
   * The game of a world went (TowerDefenseComponent.ngOnDestroy, after its
   * facade disposed engine, worker and world): the run state the root
   * services keep goes with it, so the next world starts as on a fresh page.
   */
  closed(): void {
    this.store.resetWorld();
    this.location.reset();
    closeCustomMaps();
  }

  private openHere(order: WorldStart): void {
    // The run that waited is this world's now, or stays only as its world's autosave (Continue)
    this.screens.waitingRun.set(null);
    for (const listener of [...this.leaving]) listener();
    this.start.set(order);
    this.world.update((n) => n + 1);
  }
}
