import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, DestroyRef, Injector, inject, runInInjectionContext, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { GameStore } from '../store/game.store';
import { UIStore } from '../store/ui.store';
import { EngineStore } from '../store/engine.store';
import { LocationStore } from '../store/location.store';
import { ResearchStore } from '../store/research.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { EngineInitializationService } from '../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../services/location/location-management.service';
import { UrlLocationService } from '../services/location/url-location.service';
import { GameHostComponent } from '../game-host.component';
import { WorldsStageComponent } from '../worlds/worlds-stage.component';
import { TowerDefenseComponent } from '../tower-defense.component';
import { createMapDocument } from './custom-map/map-create';
import { MapStore, MemoryMapBackend } from './custom-map/map-store';
import { openCustomMap, openedCustomMap } from './custom-map/custom-map-world';
import { WORLD_NAVIGATE, WorldSession, opensAtOnce, worldStartUrl } from './world-session.service';
import { PLAIN_START, WorldStartService, worldStartFromSearch, type WorldStart } from './world-start';

const MAP: WorldStart = { ...PLAIN_START, world: { kind: 'custom-map', mapId: 'bay', contentHash: '' } };

/**
 * Worlds opened in the page (docs/WORLDS_NAVIGATION_PLAN.md, phase 2): the
 * start order, the game made anew per world, and what the root keeps of a
 * run gone before the next world starts. Whether engine, worker, contexts
 * and listeners go is measured in a browser (e2e/perf/world-switch.ts).
 */
describe('WorldSession', () => {
  let went: string[];
  let start: WorldStartService;
  let session: WorldSession;
  let game: GameStore;
  let ui: UIStore;
  let research: ResearchStore;
  let places: LocationStore;
  let engineInit: { loading: ReturnType<typeof signal<boolean>>; error: ReturnType<typeof signal<string | null>>; reset: () => void };
  let location: { reset: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    went = [];
    engineInit = { loading: signal(false), error: signal<string | null>(null), reset: () => engineInit.loading.set(true) };
    location = { reset: vi.fn() };
    let order: WorldStart = PLAIN_START;
    start = { current: () => order, set: (next: WorldStart) => { order = next; } } as unknown as WorldStartService;
    const real = <T>(type: new () => T) => ({ provide: type, useFactory: () => new type() });
    const injector = Injector.create({
      providers: [
        real(GameStore), real(UIStore), real(EngineStore), real(LocationStore), real(ResearchStore), real(TowerDefenseStore),
        { provide: EngineInitializationService, useValue: engineInit },
        { provide: LocationManagementService, useValue: location },
        { provide: WorldStartService, useValue: start },
        { provide: WORLD_NAVIGATE, useValue: (url: string) => went.push(url) },
      ],
    });
    session = runInInjectionContext(injector, () => new WorldSession());
    game = injector.get(GameStore);
    ui = injector.get(UIStore);
    research = injector.get(ResearchStore);
    places = injector.get(LocationStore);
  });

  it('opens a world in the page: its order, and the game counted on to the next world', () => {
    const leave = session.hostAttached();
    session.open(MAP);
    expect(start.current()).toEqual(MAP);
    expect(session.world()).toBe(1);
    expect(went).toEqual([]);
    leave();
  });

  it('outside the game (the map editor) loads the game page on the order instead, a link the start reads back', () => {
    const order: WorldStart = { ...MAP, place: { hq: { lat: 48.7758, lon: 9.1829 }, spawns: [] }, resume: 'slot-2' };
    session.open(order);
    expect(session.world()).toBe(0);
    expect(went).toHaveLength(1);
    const back = worldStartFromSearch(new URL(went[0]).search, (q) => new UrlLocationService().parseLink(q), true);
    expect(back).toEqual(order);
    expect(worldStartUrl(PLAIN_START, 'http://h/play/')).toBe('http://h/play/');
  });

  it('opens the same world anew for a new key, its save not loaded twice', () => {
    const leave = session.hostAttached();
    session.open({ ...MAP, resume: 'slot-1' });
    session.reopen();
    expect(start.current()).toEqual(MAP);
    expect(session.world()).toBe(2);
    leave();
  });

  it('two worlds started and closed: each closing leaves the root as a fresh page has it, the display choices stay', async () => {
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: async () => new Response('', { status: 404 }), baseUrl: 'http://x/' });
    await store.save(createMapDocument({ id: 'bay', name: 'Bay', width: 64, depth: 64 }), null);
    const fresh = { phase: game.phase(), wave: game.waveNumber(), credits: game.credits(), menu: ui.mainMenu() };
    ui.streetsVisible.set(true);
    ui.musicVolume.set(0.2);
    for (let world = 0; world < 2; world++) {
      // A run under way: waves, research, a place, the pause menu over a replay, a notice, the map open
      await openCustomMap({ kind: 'custom-map', mapId: 'bay', contentHash: '' }, store);
      game.phase.set('wave');
      game.waveNumber.set(7 + world);
      game.credits.set(999);
      research.completedResearches.set(new Set(['archer-range' as never]));
      places.spawnPoints.set([{ id: 's', name: 'S', lat: 1, lon: 2, color: 0 }] as never);
      ui.mainMenu.set({ open: true, layer: 'pause', page: 'home' });
      ui.replayMode.set(true);
      ui.coopMapLocked.set(true);
      ui.notice.set({ text: 'Saved.' });
      engineInit.loading.set(false);

      session.closed();

      expect({ phase: game.phase(), wave: game.waveNumber(), credits: game.credits(), menu: ui.mainMenu() }).toEqual(fresh);
      expect(research.completedResearches().size).toBe(0);
      expect(places.spawnPoints()).toEqual([]);
      expect([ui.replayMode(), ui.coopMapLocked(), ui.notice()]).toEqual([false, false, null]);
      expect(engineInit.loading()).toBe(true);
      expect(location.reset).toHaveBeenCalledTimes(world + 1);
      expect(openedCustomMap({ kind: 'custom-map', mapId: 'bay', contentHash: '' })).toBeNull();
      expect([ui.streetsVisible(), ui.musicVolume()]).toEqual([true, 0.2]);
    }
  });
});

describe('opensAtOnce', () => {
  it('opens the game at once for the start of a run, and on the globes for a pick or none (docs/WORLDS_NAVIGATION_PLAN.md, 3.8)', () => {
    const place = { hq: { lat: 48.7758, lon: 9.1829 }, spawns: [] };
    // A link with a place or a map only picks, nothing loads
    expect(opensAtOnce(PLAIN_START, '', '')).toBe(false);
    expect(opensAtOnce({ ...PLAIN_START, place }, '', '')).toBe(false);
    expect(opensAtOnce(MAP, '', '')).toBe(false);
    // A run: an invite, a save, the editor's test, bots, the benchmark, menu=skip, DevWorld
    expect(opensAtOnce({ ...PLAIN_START, room: { code: 'ABC123', lane: null } }, '', '')).toBe(true);
    expect(opensAtOnce({ ...PLAIN_START, resume: 'slot-1' }, '', '')).toBe(true);
    expect(opensAtOnce({ ...MAP, startWave: 5 }, '', '')).toBe(true);
    expect(opensAtOnce(MAP, '', '3dtd-map-test')).toBe(true);
    for (const search of ['?bot=trial&trialWaves=10', '?bot=manual', '?benchmark', '?menu=skip']) expect(opensAtOnce(PLAIN_START, search, '')).toBe(true);
    expect(opensAtOnce({ ...PLAIN_START, world: { kind: 'devworld', terrain: 'flat', seed: 1, buildings: 'none', spawns: 1 } }, '?devworld', '')).toBe(true);
  });
});

/** The game as the host makes it: counts its lives, and holds what a game holds until it goes */
const lives: string[] = [];
let made = 0;
let listeners = 0;
@Component({ selector: 'app-tower-defense', standalone: true, template: '<canvas></canvas>' })
class FakeGame {
  constructor() {
    const id = `game ${++made}`;
    lives.push(`made ${id}`);
    const onKey = () => undefined;
    window.addEventListener('keydown', onKey);
    listeners++;
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('keydown', onKey);
      listeners--;
      lives.push(`gone ${id}`);
    });
  }
}

@Component({ selector: 'app-worlds-stage', standalone: true, template: '' })
class FakeStage {}

describe('GameHostComponent', () => {
  beforeAll(() => {
    try {
      getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    } catch {
      // Another spec of this worker set it up
    }
  });

  afterEach(() => {
    lives.length = 0;
    made = 0;
    listeners = 0;
    TestBed.resetTestingModule();
  });

  it('starts on the globes, makes the game anew for every world, the old one gone first, one game at a time, and goes back to the globes', () => {
    TestBed.overrideComponent(GameHostComponent, {
      remove: { imports: [TowerDefenseComponent, WorldsStageComponent] },
      add: { imports: [FakeGame, FakeStage] },
    });
    TestBed.configureTestingModule({ providers: [{ provide: WORLD_NAVIGATE, useValue: vi.fn() }] });
    const host = TestBed.createComponent(GameHostComponent);
    TestBed.tick();
    const session = TestBed.inject(WorldSession);
    const stage = () => host.nativeElement.querySelectorAll('app-worlds-stage').length;
    // A page without a run's switches starts on the globes: no game, nothing loads
    expect(lives).toEqual([]);
    expect(stage()).toBe(1);

    session.open(PLAIN_START);
    TestBed.tick();
    TestBed.tick();
    expect(lives).toEqual(['made game 1']);
    expect(stage()).toBe(0);

    // Two worlds opened before a render: only the last one is made
    session.open(PLAIN_START);
    session.open(PLAIN_START);
    TestBed.tick();
    TestBed.tick();
    expect(lives).toEqual(['made game 1', 'gone game 1', 'made game 2']);

    for (const map of ['bay', 'demo-valley']) {
      session.open({ ...PLAIN_START, world: { kind: 'custom-map', mapId: map, contentHash: '' } });
      TestBed.tick();
      TestBed.tick();
      expect(host.nativeElement.querySelectorAll('app-tower-defense').length).toBe(1);
      expect(listeners).toBe(1);
    }
    expect(lives.slice(3)).toEqual(['gone game 2', 'made game 3', 'gone game 3', 'made game 4']);

    // Back to the globes: the game goes with its listeners
    session.close();
    TestBed.tick();
    expect(lives.slice(7)).toEqual(['gone game 4']);
    expect(listeners).toBe(0);
    expect(stage()).toBe(1);

    // The route goes: the last game with it, and a world opened then loads the game's page
    host.destroy();
    expect(listeners).toBe(0);
    session.open(PLAIN_START);
    expect(TestBed.inject(WORLD_NAVIGATE)).toHaveBeenCalledTimes(1);
  });
});
