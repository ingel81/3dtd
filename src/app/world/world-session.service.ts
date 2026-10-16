import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { pageQuery } from '../core/page-switches';
import { startMenuSkipped } from '../components/main-menu/start-menu-skipped';
import { LocationManagementService } from '../services/location/location-management.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { coordKey } from '../utils/geo-utils';
import { closeCustomMaps } from './custom-map/custom-map-world';
import { MAP_TEST_WINDOW } from './map-trial';
import { WORLD_URL_PARAM, worldUrlValue } from './world-ref';
import { RESUME_URL_PARAM, WorldStartService, type WorldStart } from './world-start';

/** How the page loads another page: the map editor, a world from outside the game (a spec records it) */
export const WORLD_NAVIGATE = new InjectionToken<(url: string) => void>('WORLD_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});

/** The game's page on the world of `order`, as a link names it (worldStartFromSearch reads it back) */
export function worldStartUrl(order: WorldStart, base: string): string {
  const url = new URL(base);
  const world = order.world ? worldUrlValue(order.world) : null;
  if (world) url.searchParams.set(WORLD_URL_PARAM, world);
  if (order.place) {
    url.searchParams.set('l', coordKey(order.place.hq));
    if (order.place.spawns.length > 0) url.searchParams.set('s', order.place.spawns.map((s) => coordKey(s)).join(';'));
  }
  if (order.resume) url.searchParams.set(RESUME_URL_PARAM, order.resume);
  return url.toString();
}

/**
 * Whether the page opens straight into the game instead of on the globes
 * (docs/WORLDS_NAVIGATION_PLAN.md, 3.8): a start that is a run's, not the
 * player's pick. An automated run (a bot, the benchmark, `menu=skip`),
 * DevWorld, the editor's test run (`fromWave`, its test window), a coop
 * invite and a save to load. A link with a place or a map only picks: the
 * globes show with it chosen in its world's menu.
 */
export function opensAtOnce(order: WorldStart, search: string, windowName: string): boolean {
  const params = new URLSearchParams(search);
  return (
    startMenuSkipped(search) ||
    params.has('bot') ||
    order.world?.kind === 'devworld' ||
    order.startWave > 1 ||
    params.has('trialWaves') ||
    windowName === MAP_TEST_WINDOW ||
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
 * start is a run's (opensAtOnce), and goes back there with close().
 */
@Injectable({ providedIn: 'root' })
export class WorldSession {
  private readonly start = inject(WorldStartService);
  private readonly store = inject(TowerDefenseStore);
  private readonly location = inject(LocationManagementService);
  private readonly navigate = inject(WORLD_NAVIGATE);
  /** The game host stands (the game's route); without it a world opens as a page */
  private hosts = 0;

  /** Counts the worlds this page opened; the game host makes the game anew when it changes */
  readonly world = signal(0);
  /** A world is open (the game shows); false on the globes, where nothing of a game loads */
  readonly isOpen = signal(
    opensAtOnce(this.start.current(), pageQuery(), typeof window === 'undefined' ? '' : window.name),
  );

  /**
   * Open the world of `order` in this page, the open one goes. Outside the
   * game (the map editor, which asks about unsaved changes before its page
   * goes) the game's page loads on the order's link instead.
   */
  open(order: WorldStart): void {
    if (this.hosts === 0) {
      this.navigate(worldStartUrl(order, document.baseURI));
      return;
    }
    this.start.set(order);
    this.world.update((n) => n + 1);
    this.isOpen.set(true);
  }

  /** Back to the globes: the open world goes, engine, worker and canvas with it */
  close(): void {
    this.isOpen.set(false);
  }

  /**
   * The open world once more, made anew: after a new tile key the whole tile
   * pipeline is built again. Its save, if it had one, is not loaded twice.
   */
  reopen(): void {
    this.open({ ...this.start.current(), resume: null });
  }

  /** The game host came (GameHostComponent); returns its leave */
  hostAttached(): () => void {
    this.hosts++;
    return () => this.hosts--;
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
}
