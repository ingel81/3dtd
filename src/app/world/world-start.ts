import { Injectable, inject, signal } from '@angular/core';
import { devWorldRef } from '../devworld/dev-world-provider';
import { DevWorldService } from '../devworld/devworld.service';
import type { SavedSpawn } from '../models/location.types';
import { UrlLocationService } from '../services/location/url-location.service';
import { customMapSpawnLimit, customMapStartWave } from './custom-map/custom-map-world';
import { BENCHMARK_FLAG, isBenchmarkSearch } from '../benchmark/benchmark-report';
import { isRenderBenchmarkSearch } from '../benchmark/render-benchmark';
import { customMapsByLink } from './custom-maps-open';
import { mapTrialWaves } from './map-trial';
import { WORLD_URL_PARAM, worldRefFromSearch, type WorldRef } from './world-ref';

/** The URL parameter of a save to load once the page stands on its world (WorldChoiceService.openSave) */
export const RESUME_URL_PARAM = 'resume';

/** The map the editor's entry names (`/editor?map=<id>`), read once like a link (WorldStartService.editorMap) */
export const EDITOR_MAP_PARAM = 'map';

/**
 * The parameters of a link that say what to open: the place, the world, a
 * save, a coop room, the editor's map. Read once at the start into the WorldStart, then gone
 * from the address, so a reload does not carry them out again
 * (docs/WORLDS_NAVIGATION_PLAN.md, 3.8). So is a benchmark's `&benchmark`:
 * the menu starts one in the page, a link once. The switches of development
 * (`?devworld`, `?bot=`, `?quality=` ...) stay: bot tabs reload on them. So
 * does `&relay=`: hosts and bot seats name their relay with it, not only
 * invites.
 */
export const LINK_PARAMS: readonly string[] = ['l', 's', WORLD_URL_PARAM, RESUME_URL_PARAM, 'room', 'lane', BENCHMARK_FLAG, EDITOR_MAP_PARAM];

/** The coop room an invite link names */
export interface StartRoom {
  code: string;
  /** The lane this player had before a reload into the room */
  lane: string | null;
}

/** A benchmark the world is opened for (docs/BENCHMARKS.md) */
export interface BenchmarkStart {
  /** The load benchmark in DevWorld (BenchmarkService), or the graphics one on this world (RenderBenchmarkService) */
  kind: 'load' | 'render';
  /** Where the panel's way back goes: the world and place the menu's entry left; null without one */
  back: WorldStart | null;
}

/**
 * What a world is opened with: the start order. At the page's start it
 * comes from the link (worldStartFromSearch); later the menu makes it
 * (WorldSession). Every service that asked the address what to open reads
 * this instead.
 */
export interface WorldStart {
  /** The world: a custom map, an own tileset, DevWorld; null for the 3D tiles of the configured source */
  world: WorldRef | null;
  /** The place a link names (`?l=`, `&s=`), null where the game asks or guesses */
  place: { hq: { lat: number; lon: number }; spawns: SavedSpawn[] } | null;
  /** A save to load once the world stands (`?resume=`) */
  resume: string | null;
  /** The coop room to join (`?room=`, `&lane=`) */
  room: StartRoom | null;
  /** How many of a map's spawns the run uses (`?spawns=`, customMapSpawnLimit) */
  spawnLimit: number;
  /** The wave a test run of a map starts at (`?fromWave=`, customMapStartWave) */
  startWave: number;
  /** A benchmark to run once the world stands (`&benchmark`), null for a game */
  benchmark: BenchmarkStart | null;
  /**
   * A test run of a map from the editor (Test map, the bot check): never
   * saved, no autosave, no run to come back to; the editor waits with its
   * map. `bot` is the waves the bot plays on its own (`?bot=trial&trialWaves=N`
   * of a link), null for a test the player plays. Null for a game.
   */
  trial: { bot: number | null } | null;
  /**
   * The player pressed Start (a world menu, Continue, a map picked in the
   * game): the game shows as soon as the world stands, no Play in between.
   * A link only picks (docs/WORLDS_NAVIGATION_PLAN.md, 3.8), so never from one
   */
  play: boolean;
  /** What loads, as the loading view names it ("Heilbronn", "Demo Valley"); null: the world names itself */
  label: string | null;
}

/** The order of a start without a link: the 3D tiles, the place guessed or asked */
export const PLAIN_START: WorldStart = {
  world: null,
  place: null,
  resume: null,
  room: null,
  spawnLimit: customMapSpawnLimit(''),
  startWave: 1,
  benchmark: null,
  trial: null,
  play: false,
  label: null,
};

/**
 * The world open now at its place now, as an order: what a benchmark comes
 * back to. The tiles are the order's null world, the place where it stands.
 */
export function orderHere(world: WorldRef, hq: { lat: number; lon: number } | null, spawns: readonly SavedSpawn[]): WorldStart {
  return {
    ...PLAIN_START,
    world: world.kind === 'tiles' ? null : world,
    place: hq ? { hq: { lat: hq.lat, lon: hq.lon }, spawns: [...spawns] } : null,
  };
}

/**
 * The start order a link names. `place` reads `?l=`/`&s=` (UrlLocationService.parseLink);
 * a map link of a release before the maps names no world (the real places).
 */
export function worldStartFromSearch(
  search: string,
  place: (search: string) => WorldStart['place'],
  mapsByLink = customMapsByLink(),
): WorldStart {
  const params = new URLSearchParams(search);
  const world = worldRefFromSearch(search);
  const code = params.get('room');
  const bot = mapTrialWaves(search);
  return {
    world: world?.kind === 'custom-map' && !mapsByLink ? null : world,
    place: place(search),
    resume: params.get(RESUME_URL_PARAM) || null,
    room: code ? { code, lane: params.get('lane') } : null,
    spawnLimit: customMapSpawnLimit(search),
    startWave: customMapStartWave(search),
    benchmark: isBenchmarkSearch(search) ? { kind: 'load', back: null } : isRenderBenchmarkSearch(search) ? { kind: 'render', back: null } : null,
    trial: bot === null ? null : { bot },
    play: false,
    label: null,
  };
}

/** The address without the link's parameters (LINK_PARAMS); the same string when it has none */
export function addressWithoutLink(href: string): string {
  const url = new URL(href);
  const had = LINK_PARAMS.some((key) => url.searchParams.has(key));
  if (!had) return href;
  for (const key of LINK_PARAMS) url.searchParams.delete(key);
  return url.toString();
}

/** The pages of the game's window (app.routes.ts: the shell's game and editor), the only ones a link opens */
const LINK_PAGES = ['', 'editor'];

/**
 * Whether the page at `href` is one of the game's window, whose address is a
 * link to read (LINK_PAGES); a page of its own (`/map-preview`,
 * `/engine-test`) keeps its parameters, `map` among them
 */
export function pageTakesLinks(href: string, base: string): boolean {
  const root = new URL(base).pathname.replace(/\/?$/, '/');
  const path = new URL(href).pathname;
  if (!path.startsWith(root) && `${path}/` !== root) return false;
  return LINK_PAGES.includes(path.slice(root.length).replace(/\/$/, ''));
}

/**
 * The start order of the open world. The page's start reads it from the
 * link once and takes the link's parameters out of the address
 * (LINK_PARAMS); from then on no navigation writes the address.
 */
@Injectable({ providedIn: 'root' })
export class WorldStartService {
  /** Reads a link's place; it holds nothing */
  private readonly links = new UrlLocationService();
  private readonly devWorld = inject(DevWorldService);
  /** The map the editor's entry named (`/editor?map=`), null without one; the editor opens it once */
  readonly editorMap: string | null = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(EDITOR_MAP_PARAM);
  private readonly order = signal<WorldStart>(this.fromAddress());
  /** The save of the order not yet loaded; taken once (takeResume) */
  private resume: string | null = this.order().resume;

  /** The order the open world was made with */
  readonly current = this.order.asReadonly();

  /** The save the order asks to load, once: a second ask (another menu of the same world) gets null */
  takeResume(): string | null {
    const slot = this.resume;
    this.resume = null;
    return slot;
  }

  /** A new order, for the next world (WorldSession) */
  set(order: WorldStart): void {
    this.order.set(order);
    this.resume = order.resume;
  }

  private fromAddress(): WorldStart {
    if (typeof window === 'undefined') return PLAIN_START;
    // Another page's parameters are its own: nothing read, nothing taken out of its address
    // The app's root from <base href> (index.html), not the page's own address where there is none
    const base = new URL(document.querySelector('base')?.getAttribute('href') ?? '/', window.location.href).href;
    if (!pageTakesLinks(window.location.href, base)) return PLAIN_START;
    const search = window.location.search;
    const order = worldStartFromSearch(search, (query) => this.links.parseLink(query));
    const clean = addressWithoutLink(window.location.href);
    if (clean !== window.location.href) window.history.replaceState(window.history.state, '', clean);
    // DevWorld is a switch of development; its WorldRef is the order's world
    return this.devWorld.inUrl ? { ...order, world: devWorldRef(this.devWorld) } : order;
  }
}
