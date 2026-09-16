import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// HeroControlService's effects are collected and run where Angular would
// schedule them, right after the signals they read changed
const angular = vi.hoisted(() => ({ effects: [] as (() => void)[] }));
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return {
    ...actual,
    effect: (fn: () => void) => {
      angular.effects.push(fn);
      fn();
      return { destroy: () => undefined };
    },
  };
});
// Only their DI tokens are needed
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));
vi.mock('./ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({ IntroCameraFlightService: class IntroCameraFlightService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Vector3 } from 'three';
import { MatDialog } from '@angular/material/dialog';
import { InputHandlerService } from './input-handler.service';
import { HeroControlService } from './hero-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { CameraControlService } from './camera-control.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { GameEventBus } from '../game-engine/game-event-bus';
import { HeroManager, type HeroPresentation, type HeroWorld } from '../managers/hero.manager';
import { GameCommandsHandler } from '../managers/game-commands.handler';
import type { GameStateManager } from '../managers/game-state.manager';
import { HERO, type HeroStatus } from '../configs/hero.config';
import { heroPanelView } from '../components/game-sidebar/hero-panel/hero-panel';
import { at, local, line } from '../../test/geo-test-points';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;

/** Two spawns, south and west, joining at (0, 150) and running north to the HQ at (0, 300) */
const ROUTES = new Map([
  ['spawn-south', line([0, 0], [0, 50], [0, 100], [0, 150], [0, 200], [0, 250], [0, 300])],
  ['spawn-west', line([-150, 150], [-100, 150], [-50, 150], [0, 150], [0, 200], [0, 250], [0, 300])],
]);
const HQ = at(0, 300);
/** Screen pixel (x, y) looks at the ground x metres east, y metres north: the fake picker below */
const TOWER_PX = { x: 60, y: 250 };

/**
 * Playtest 386, 387, 389, 391 and 425 (docs/archive/REVIEW_SPRINT_2026-09-14.md)
 * replayed through the pointer: the real InputHandlerService over a canvas,
 * the real HeroControlService wired to it as VisualizationFacadeService does,
 * its commands through GameCommandsHandler to the real HeroManager. The
 * picker is a fake that maps a screen pixel to the ground in metres and hits
 * the hero within 1.5 m of where he stands. The store's hero follows
 * hero:state-changed as GameStateSyncService does.
 *
 * The hint box ("Click Send", "V Ammo", "G Camera", "ESC Let go",
 * tower-defense.component.ts heroHints) and the hero panel in the sidebar
 * (game-sidebar.component.html) show while HeroControlService.selected is on;
 * the tests read that signal.
 */
describe('Hero under the pointer, playtest 386, 387, 389, 391 and 425 replayed', () => {
  let bus: GameEventBus;
  let hero: HeroManager;
  let control: HeroControlService;
  let input: InputHandlerService;
  let canvas: HTMLCanvasElement;
  let credits: number;
  let presented: { x: number; z: number; post: { x: number; z: number } }[];
  const heroStatus = signal<HeroStatus>(undefined as never);
  const selectedTower = signal<object | null>(null);
  const selectedTowerId = signal<string | null>(null);
  const ui = {
    buildMode: signal(false),
    mapPlacementMode: signal<string | null>(null),
    abilityTargeting: signal<string | null>(null),
    photoMode: signal(false),
    viewOnly: signal(false),
    heroSelected: signal(false),
  };
  const heroView = {
    setSelected: vi.fn(),
    showMoveTarget: vi.fn(),
    hideMoveTarget: vi.fn(),
    pickTarget: () => ({ id: 'hero-model' }),
  };
  const exitBuildMode = vi.fn(() => ui.buildMode.set(false));
  const selectTower = vi.fn((id: string | null) => {
    selectedTowerId.set(id);
    selectedTower.set(id ? { id } : null);
  });

  const runEffects = () => angular.effects.forEach((fn) => fn());
  const pointer = (type: string, x: number, y: number, button = 0) =>
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, button, buttons: type === 'pointerup' ? 0 : 1 << (button === 2 ? 1 : 0),
    }));
  /** A left click at screen (x, y), then Angular's effects */
  const click = (x: number, y: number) => {
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
    runEffects();
  };
  const move = (x: number, y: number) => {
    vi.advanceTimersByTime(20);
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  };
  /** The screen pixel that shows the hero */
  const heroPx = () => {
    const p = local(hero.getHero()!.position);
    return { x: p.x, y: p.z };
  };
  const heroAt = () => local(hero.getHero()!.position);
  const tick = (steps: number) => {
    for (let i = 0; i < steps; i++) hero.update(STEP_MS);
  };

  beforeEach(() => {
    angular.effects.length = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    bus = new GameEventBus();
    credits = 0;
    presented = [];
    for (const s of [ui.buildMode, ui.photoMode, ui.viewOnly, ui.heroSelected]) s.set(false);
    ui.mapPlacementMode.set(null);
    ui.abilityTargeting.set(null);
    selectedTower.set(null);
    selectedTowerId.set(null);
    heroView.setSelected.mockClear();
    heroView.showMoveTarget.mockClear();
    heroView.hideMoveTarget.mockClear();
    selectTower.mockClear();

    const world: HeroWorld = {
      routes: () => ROUTES,
      base: () => HQ,
      enemiesInRadius: (_c, _r, out) => {
        out.length = 0;
        return out;
      },
      bodyContact: () => null,
      groundHeight: () => 100,
      fire: () => undefined,
      spend: (cost) => {
        if (credits < cost) return false;
        credits -= cost;
        return true;
      },
    };
    hero = new HeroManager(bus, world);
    hero.setView({
      present: (h: HeroPresentation) => presented.push({ ...local(h), post: local(h.anchor) }),
      clear: () => undefined,
    });
    // GameStateSyncService: GameStore.hero follows the manager
    heroStatus.set(hero.getStatus());
    bus.on('hero:state-changed', (event) => heroStatus.set(event.hero));

    const gameState = {
      heroManager: hero,
      towerManager: { selectTower },
      getGlobalRouteGrid: () => ({ getGroundLocalYAt: () => 0 }),
      getEventBus: () => bus,
    };
    new GameCommandsHandler(gameState as unknown as GameStateManager, bus);

    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const injector = Injector.create({
      providers: [
        { provide: UIStore, useValue: ui },
        { provide: TowerDefenseStore, useValue: { hero: heroStatus, selectedTower, selectedTowerId } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: KeyboardPanService, useValue: {} },
        { provide: TowerPlacementService, useValue: { exitBuildMode } },
        { provide: MapPlacementService, useValue: { exitPlacementMode: vi.fn() } },
        { provide: AbilityTargetingService, useValue: { cancel: vi.fn() } },
        { provide: CameraControlService, useValue: { focusGeo: vi.fn(() => true) } },
        { provide: IntroCameraFlightService, useValue: { active: signal(false) } },
      ],
    });
    control = runInInjectionContext(injector, () => new HeroControlService());
    input = runInInjectionContext(injector, () => new InputHandlerService());

    const engine = {
      hero: heroView,
      picker: {
        // His model is under the pixel within 1.5 m of where he stands
        hits: (x: number, y: number) => {
          const h = hero.getHero();
          if (!h) return false;
          const p = local(h.position);
          return Math.hypot(p.x - x, p.z - y) < 1.5;
        },
        raycastTowers: (x: number, y: number) => (x === TOWER_PX.x && y === TOWER_PX.y ? 't1' : null),
        raycastTerrain: (x: number, y: number) => new Vector3(x, 0, y),
      },
      sync: {
        localToGeo: (v: Vector3) => ({ ...at(v.x, v.z), height: 100 }),
        geoToLocalSimpleInto: (lat: number, lon: number, _h: number, out: Vector3) => {
          const p = local({ lat, lon });
          return out.set(p.x, 0, p.z);
        },
      },
      towers: { setHovered: vi.fn() },
    };
    control.initialize(engine as never, gameState as never);
    input.initialize(canvas, engine as never, gameState as never, ui.buildMode, vi.fn(), vi.fn());
    // VisualizationFacadeService.setHeroCallbacks
    input.setHeroCallbacks({
      selected: () => control.selected(),
      pick: (x, y) => control.pick(x, y),
      toggle: () => control.toggle(),
      click: (lat, lon, height) => control.click(lat, lon, height),
      move: (lat, lon, hitPoint) => control.hover(lat, lon, hitPoint),
      cancel: () => control.deselect(),
    });

    bus.emit({
      type: 'research:completed',
      researchId: HERO.researchId,
      effects: [{ kind: 'global-perk', perkId: HERO.perkId, description: '' }],
    });
    credits = HERO.cost;
  });

  afterEach(() => {
    input.dispose();
    canvas.remove();
    vi.useRealTimers();
  });

  /** His button before the hire: HeroControlService.hire, a synchronous command */
  const hire = () => {
    expect(control.hire()).toBe(true);
    expect(heroStatus().hired).toBe(true);
  };

  it('386: a click on him selects him, draws the rings and holds the hint box and panel; G a second time brings him into view', () => {
    hire();
    const { x, y } = heroPx();
    click(x, y);
    expect(control.selected()).toBe(true);
    expect(heroView.setSelected).toHaveBeenLastCalledWith(true);
    expect(heroPanelView(heroStatus())).toMatchObject({ level: 1, kills: 0, rangeM: 18, status: 'Holding his post' });
    expect(heroPanelView(heroStatus()).ammo.map((a) => a.label)).toEqual(['Standard', 'Explosive', 'Rune']);

    // G and his button: HeroControlService.summon, selected already, so the camera
    expect(control.summon()).toBe(true);
    expect(control.selected()).toBe(true);
  });

  it('387: selected, the ring sits on the nearest route point; beyond 30 m it is red with "No route within 30 m" and a click sends nothing', () => {
    hire();
    click(heroPx().x, heroPx().y);

    move(12, 200);
    expect(heroView.showMoveTarget).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0, z: 200 }), true);
    expect(control.warning()).toBeNull();

    move(40, 200);
    expect(heroView.showMoveTarget).toHaveBeenLastCalledWith(expect.objectContaining({ x: 40, z: 200 }), false);
    expect(control.warning()).toBe('No route within 30 m');

    click(40, 200);
    expect(control.selected()).toBe(true);
    expect(local(hero.getAnchor()!)).toEqual({ x: 0, z: 300 });
    expect(hero.getStatus().mode).toBe('hold');
  });

  it('387: a click past the junction sends him round the corner along the streets, "On his way", then "Holding his post"', () => {
    hire();
    click(heroPx().x, heroPx().y);

    click(-100, 152); // 2 m off the west street, 250 m of route away
    expect(control.selected()).toBe(true);
    expect(local(hero.getAnchor()!)).toEqual({ x: -100, z: 150 });
    expect(heroPanelView(heroStatus()).status).toBe('On his way');

    for (let i = 0; i < 3000 && heroStatus().mode === 'travel'; i++) {
      tick(1);
      const p = heroAt();
      // On the south street or the west street, never across the block
      expect(Math.abs(p.x) < 0.2 || Math.abs(p.z - 150) < 0.2).toBe(true);
    }
    expect(heroAt()).toEqual({ x: -100, z: 150 });
    expect(heroPanelView(heroStatus()).status).toBe('Holding his post');
  });

  it('389: V switches the ammo round the list while he is not selected', () => {
    hire();
    expect(control.selected()).toBe(false);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      expect(control.cycleAmmo()).toBe(true);
      seen.push(heroStatus().ammo);
    }
    expect(seen).toEqual(['explosive', 'rune', 'standard']);
  });

  describe('391: letting him go', () => {
    beforeEach(() => {
      hire();
    });
    const selectHim = () => {
      click(heroPx().x, heroPx().y);
      expect(control.selected()).toBe(true);
    };

    it('a short right click lets him go, a right drag of the camera does not', () => {
      selectHim();
      pointer('pointerdown', 100, 100, 2);
      pointer('pointerup', 130, 100, 2);
      runEffects();
      expect(control.selected()).toBe(true);

      pointer('pointerdown', 100, 100, 2);
      pointer('pointerup', 101, 100, 2);
      runEffects();
      expect(control.selected()).toBe(false);
      expect(heroView.hideMoveTarget).toHaveBeenCalled();
      expect(heroView.setSelected).toHaveBeenLastCalledWith(false);
    });

    it('a second click on him lets him go', () => {
      selectHim();
      click(heroPx().x, heroPx().y);
      expect(control.selected()).toBe(false);
    });

    it('a click on a tower selects the tower and lets him go', () => {
      selectHim();
      click(TOWER_PX.x, TOWER_PX.y);
      expect(selectTower).toHaveBeenLastCalledWith('t1');
      expect(control.selected()).toBe(false);
    });

    it('build mode lets him go, and a click on him in build mode selects nothing', () => {
      selectHim();
      ui.buildMode.set(true);
      runEffects();
      expect(control.selected()).toBe(false);
      click(heroPx().x, heroPx().y);
      expect(control.selected()).toBe(false);
    });

    it('photo mode lets him go; there a click on him and G select nothing', () => {
      selectHim();
      ui.photoMode.set(true);
      ui.viewOnly.set(true);
      runEffects();
      expect(control.selected()).toBe(false);

      click(heroPx().x, heroPx().y);
      expect(control.selected()).toBe(false);
      expect(control.summon()).toBe(false);
      expect(control.selected()).toBe(false);
    });
  });

  it('425: in a pause the hire shows him at once, a click selects him, a far click moves the post ring at once, he walks once sub-steps run', () => {
    // Paused: GameStateManager.update runs no sub-step, so no hero.update here
    hire();
    expect(credits).toBe(0);
    expect(presented).toEqual([{ x: 0, z: 300, post: { x: 0, z: 300 } }]);

    click(heroPx().x, heroPx().y);
    expect(control.selected()).toBe(true);

    click(0, 150);
    expect(presented.at(-1)).toEqual({ x: 0, z: 300, post: { x: 0, z: 150 } });
    expect(heroAt()).toEqual({ x: 0, z: 300 });
    expect(heroStatus().mode).toBe('travel');

    // The pause ends: one second of sub-steps, 8 m at his speed
    tick(60);
    expect(heroAt().z).toBeCloseTo(300 - HERO.speedMps, 0);
  });
});
