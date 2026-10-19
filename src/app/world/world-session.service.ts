import { Injectable, inject, signal } from '@angular/core';
import { pageQuery } from '../core/page-switches';
import { startMenuSkipped } from '../components/main-menu/start-menu-skipped';
import { LocationManagementService } from '../services/location/location-management.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { closeCustomMaps } from './custom-map/custom-map-start';
import { bringMapToFront } from './custom-map/map-in-front';
import { AppScreen } from './app-screen.service';
import { WorldStartService, type WorldStart } from './world-start';
import type { WorldId, WorldPick } from '../worlds/world-rules';

/**
 * The world held behind the globes (docs/WORLDS_STATE_PLAN.md, 3.7): what
 * its Continue or Back to says, and what a start in its world weighs
 */
export interface ParkedWorld {
  /** Its world on the globes; null for DevWorld */
  world: WorldId | null;
  /** Its place or map, as the world's menu picks it */
  pick: WorldPick | null;
  /** "Heilbronn", "Demo Valley" */
  label: string;
  /** The wave the run stands before */
  wave: number;
  /** A run is under way (a wave or a tower): Continue; else only Back to the place */
  run: boolean;
  /**
   * What of the run stays when the held world goes for something else (leaveParked): all of it between the
   * waves (saved then), its autosave of the wave's start in a wave, nothing in a wave without one. Absent: all
   */
  keeps?: 'all' | 'wave-start' | 'nothing';
  /** Its run was lost (game over): Back to shows the end, nothing goes on */
  over?: boolean;
}

/**
 * Whether the page opens straight into the game instead of on the globes
 * (docs/WORLDS_NAVIGATION_PLAN.md, 3.8): a start that is a run's, not the
 * player's pick. An automated run (a bot, a benchmark, `menu=skip`),
 * DevWorld, the editor's test run (its trial, `fromWave`), a coop invite and
 * a save to load. A link with a place or a map only picks: the globes show
 * with it chosen in its world's menu.
 */
export function opensAtOnce(order: WorldStart, search: string): boolean {
  const params = new URLSearchParams(search);
  return (
    startMenuSkipped(search) ||
    params.has('bot') ||
    order.world?.kind === 'devworld' ||
    order.startWave > 1 ||
    order.trial !== null ||
    order.benchmark !== null ||
    order.room !== null ||
    order.resume !== null
  );
}

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
 * None is open on the globes (phase 6): the page starts there, unless its
 * start is a run's (opensAtOnce), and goes back there with close(). From
 * the map editor (AppScreen) a world opens once the editor let go.
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
  /** A world is open (the game shows); false on the globes, where nothing of a game loads */
  readonly isOpen = signal(opensAtOnce(this.start.current(), pageQuery()));
  /**
   * The open world stands held behind the globes (All worlds, World menu):
   * its game paused and hidden, engine and worker kept, so Continue or Back
   * to shows it at once. At most this one world; it goes when another
   * starts, the editor opens or a coop room is joined (docs/WORLDS_STATE_PLAN.md, 3.7)
   */
  readonly parked = signal<ParkedWorld | null>(null);
  /** What the held game does before it goes for good: keep its run as autosave, or let it end (see leaveParked) */
  private readonly parkLeaving = new Set<(keep: boolean) => Promise<void>>();

  /**
   * Open the world of `order` in this page, the open one goes. From the map
   * editor the game shows first, once the editor saved (AppScreen.showGame);
   * an editor that stays (its save failed) keeps the screen.
   */
  open(order: WorldStart): void {
    // A world held behind the globes keeps its run as autosave, then goes
    if (this.parked()) {
      void this.leaveParked(true).then(() => this.open(order));
      return;
    }
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

  /** Back to the globes: the open world goes, engine, worker and canvas with it */
  close(): void {
    bringMapToFront(null);
    this.parked.set(null);
    this.isOpen.set(false);
  }

  /** The open world to the globes, held: its game stays, paused and hidden (`info` says what it holds) */
  park(info: ParkedWorld): void {
    if (this.isOpen()) this.parked.set(info);
  }

  /** The held world in front again, at once */
  unpark(): void {
    this.parked.set(null);
  }

  /**
   * The held world goes for good: its game first keeps its run as autosave
   * (`keep`, between the waves) or lets it end; then it closes. Nothing when
   * no world is held.
   */
  async leaveParked(keep: boolean): Promise<void> {
    if (!this.parked()) return;
    for (const leaving of [...this.parkLeaving]) await leaving(keep).catch(() => undefined);
    this.close();
  }

  /** `listener` runs when the held world goes for good (leaveParked); returns the unsubscribe */
  onLeaveParked(listener: (keep: boolean) => Promise<void>): () => void {
    this.parkLeaving.add(listener);
    return () => this.parkLeaving.delete(listener);
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
    this.parked.set(null);
    // The run that waited is this world's now, or stays only as its world's autosave (Continue)
    this.screens.waitingRun.set(null);
    for (const listener of [...this.leaving]) listener();
    this.start.set(order);
    // The map assets of another map or world go (MapAssetLibrary.release), those of this map stay
    bringMapToFront(order.world?.kind === 'custom-map' ? order.world.mapId : null);
    this.world.update((n) => n + 1);
    this.isOpen.set(true);
  }
}
