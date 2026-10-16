/**
 * A world started and taken down twice in a row leaves nothing behind
 * (docs/WORLDS_NAVIGATION_PLAN.md, phase 2): no listener on window,
 * document or the simulation's bus, no worker, no interval, no handle on
 * the page, and no root service still reaching the old world's canvas or
 * engine. The game's own facades, the state snapshots, the input handler,
 * the height cycle and the simulation client are real; every other service
 * is a stub that answers anything. Engine, WebGL contexts and GPU resources
 * need a browser: e2e/perf/world-switch.ts.
 */
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DestroyRef, Injector, runInInjectionContext, type ProviderToken } from '@angular/core';

// InputHandlerService imports MatDialog; the real module is partially compiled and needs the JIT compiler
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));

import { TowerDefenseFacadeService } from '../services/facade/tower-defense-facade.service';
import { VisualizationFacadeService } from '../services/facade/visualization-facade.service';
import { GameLoopFacadeService } from '../services/facade/game-loop-facade.service';
import { InputHandlerService } from '../services/input-handler.service';
import { HeightUpdateService } from '../services/world/height-update.service';
import { SimClient } from '../sim/client/sim-client.service';
import { StateSnapshotService } from '../director/state-snapshot.service';
import { CoopRoomCarry } from '../coop/coop-room-carry';
import type { CoopSession } from '../coop/coop-session';

/** Answers every property and call with another stub; not a promise, not iterable */
function anything(): unknown {
  const kids = new Map<PropertyKey, unknown>();
  return new Proxy(() => undefined, {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      if (!kids.has(key)) kids.set(key, anything());
      return kids.get(key);
    },
    apply: () => anything(),
  });
}

const REAL: ProviderToken<unknown>[] = [
  TowerDefenseFacadeService,
  VisualizationFacadeService,
  GameLoopFacadeService,
  InputHandlerService,
  HeightUpdateService,
  SimClient,
  StateSnapshotService,
];

/** The game's own services, made anew per world; the rest are the root's */
const GAME: unknown[] = [TowerDefenseFacadeService, VisualizationFacadeService, GameLoopFacadeService, StateSnapshotService];

/** The real services of one game, the rest stubs; a new one per world, as the game component's injector is */
class GameInjector extends Injector {
  private readonly made = new Map<unknown, unknown>();
  private readonly leaving: (() => void)[] = [];
  private readonly destroyRef = { onDestroy: (fn: () => void) => (this.leaving.push(fn), () => undefined) };
  constructor(private readonly root: Map<unknown, unknown>) {
    super();
  }
  /** The game component goes: what its services hooked on DestroyRef runs, as Angular does after ngOnDestroy */
  destroy(): void {
    for (const fn of this.leaving.splice(0)) fn();
  }
  override get(token: unknown): unknown {
    if (token === DestroyRef) return this.destroyRef;
    // The root services outlive the game
    const scope = GAME.includes(token) ? this.made : this.root;
    if (!scope.has(token)) {
      scope.set(token, REAL.includes(token as ProviderToken<unknown>)
        ? runInInjectionContext(this, () => new (token as new () => unknown)())
        : anything());
    }
    return scope.get(token);
  }
}

/** What a world leaves on the page: listeners, workers, intervals, handles */
interface PageHold {
  listeners: Set<string>;
  workers: Set<FakeWorker>;
  intervals: Set<unknown>;
}
const hold: PageHold = { listeners: new Set(), workers: new Set(), intervals: new Set() };
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (fn: unknown) => {
  if (!ids.has(fn as object)) ids.set(fn as object, ++nextId);
  return ids.get(fn as object)!;
};
const key = (target: string, type: string, fn: unknown, options: unknown) =>
  `${target} ${type} #${idOf(fn)} ${typeof options === 'boolean' ? options : !!(options as { capture?: boolean } | undefined)?.capture}`;

class FakeWorker {
  onmessage: unknown = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  constructor() {
    hold.workers.add(this);
  }
  postMessage(): void {
    // The simulation does not run here
  }
  terminate(): void {
    hold.workers.delete(this);
  }
}

describe('A world started and taken down twice', () => {
  const restore: (() => void)[] = [];

  beforeEach(() => {
    hold.listeners.clear();
    hold.workers.clear();
    hold.intervals.clear();
    for (const [name, target] of [['window', window], ['document', document]] as const) {
      const ownAdd = target.addEventListener;
      const ownRemove = target.removeEventListener;
      const add = ownAdd.bind(target);
      const remove = ownRemove.bind(target);
      target.addEventListener = ((type: string, fn: EventListener, options?: unknown) => {
        hold.listeners.add(key(name, type, fn, options));
        add(type, fn, options as AddEventListenerOptions);
      }) as typeof target.addEventListener;
      target.removeEventListener = ((type: string, fn: EventListener, options?: unknown) => {
        hold.listeners.delete(key(name, type, fn, options));
        remove(type, fn, options as EventListenerOptions);
      }) as typeof target.removeEventListener;
      restore.push(() => {
        target.addEventListener = ownAdd;
        target.removeEventListener = ownRemove;
      });
    }
    const setInterval = window.setInterval;
    const clearInterval = window.clearInterval;
    window.setInterval = ((fn: TimerHandler, ms?: number) => {
      const id = setInterval(fn, ms);
      hold.intervals.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      hold.intervals.delete(id);
      clearInterval(id);
    }) as typeof window.clearInterval;
    restore.push(() => {
      window.setInterval = setInterval;
      window.clearInterval = clearInterval;
    });
    vi.stubGlobal('Worker', FakeWorker);
    restore.push(() => vi.unstubAllGlobals());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const undo of restore.splice(0).reverse()) undo();
    vi.restoreAllMocks();
  });

  it('leaves no listener, worker, interval or page handle, and no root service on the old world', () => {
    const root = new Map<unknown, unknown>();
    const pageBefore = new Set(Object.keys(window));
    const listenersBefore = new Set(hold.listeners);
    // The simulation's bus is the root's: the games come and go on it
    const bus = (new GameInjector(root).get(SimClient) as SimClient).bus;
    const busBefore = bus.getListenerCount();
    for (let world = 1; world <= 2; world++) {
      const injector = new GameInjector(root);
      const facade = injector.get(TowerDefenseFacadeService) as TowerDefenseFacadeService;
      const viz = injector.get(VisualizationFacadeService) as VisualizationFacadeService;
      const canvas = document.createElement('canvas');
      injector.get(StateSnapshotService);
      const engine = anything();
      const bridge = anything() as Record<string, unknown>;
      bridge['getCanvasElement'] = () => canvas;
      bridge['getEngine'] = () => engine;

      // The world stands: its simulation, the pointer on its canvas, its height cycle under way
      (facade as unknown as { initialize(bridge: unknown, injector: Injector): void }).initialize(bridge, injector);
      viz.setupClickHandlerWithGameState();
      void viz.scheduleOverlayHeightUpdate();
      expect(hold.workers.size).toBe(1);
      expect(hold.listeners.size).toBeGreaterThan(listenersBefore.size);
      expect(hold.intervals.size).toBe(1);
      expect(Object.keys(window).filter((k) => !pageBefore.has(k))).toContain('__load');

      expect(bus.getListenerCount()).toBeGreaterThan(busBefore);

      // The game goes
      facade.dispose();
      injector.destroy();

      expect([...hold.listeners].filter((l) => !listenersBefore.has(l)), `world ${world}: listeners`).toEqual([]);
      expect(hold.workers.size, `world ${world}: workers`).toBe(0);
      expect(bus.getListenerCount(), `world ${world}: on the simulation's bus`).toBe(busBefore);
      expect(hold.intervals.size, `world ${world}: intervals`).toBe(0);
      expect(Object.keys(window).filter((k) => !pageBefore.has(k)), `world ${world}: page handles`).toEqual([]);
      const input = root.get(InputHandlerService) as Record<string, unknown>;
      const heights = root.get(HeightUpdateService) as Record<string, unknown>;
      expect([input['canvas'], input['engine'], heights['engine']], `world ${world}: root services`).toEqual([null, null, null]);
      expect((root.get(SimClient) as SimClient).started).toBe(false);
    }
  });
});

/**
 * What outlives a world in the page (phases 3 and 4): a coop room in the
 * lobby goes along to the next world's CoopService (CoopRoomCarry) and the
 * editor's session to its next page (AppShellComponent, its own spec). A
 * room is held only between two worlds: taken once, and one kept and never
 * taken leaves its relay connection when the next comes.
 */
describe('a coop room between two worlds', () => {
  it('is taken once, and one never taken closes its connection', () => {
    const carry = new CoopRoomCarry();
    const session = (closed: string[], name: string) => ({ close: () => closed.push(name) }) as unknown as CoopSession;
    const closed: string[] = [];
    const room = (s: CoopSession) => ({ session: s, relay: null, intent: 'join' as const, chat: [], chatId: 1, lan: null });
    const first = session(closed, 'first');
    carry.keep(room(first));
    expect(carry.take()?.session).toBe(first);
    expect(carry.take()).toBeNull();
    carry.keep(room(first));
    carry.keep(room(session(closed, 'second')));
    expect(closed).toEqual(['first']);
    expect(carry.take()?.session).not.toBe(first);
    expect(closed).toEqual(['first']);
  });
});
