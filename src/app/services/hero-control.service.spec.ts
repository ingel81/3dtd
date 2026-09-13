import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { Vector3 } from 'three';

// inject() hands out the fakes below by class name; effects are collected
// so a test can run them
const injections: Record<string, unknown> = {};
const effects: (() => void)[] = [];
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => injections[token?.name ?? ''],
    effect: (fn: () => void) => { effects.push(fn); },
  };
});
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));
vi.mock('./ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({ IntroCameraFlightService: class IntroCameraFlightService {} }));

import { HeroControlService } from './hero-control.service';
import { heroStatus, initialHeroStatus, type HeroStatus } from '../configs/hero.config';
import type { GameEvent } from '../game-engine/game-event-bus';
import type { GeoPosition } from '../models/game.types';

const HIRED = heroStatus(true, true, 0, 'standard', 'hold');

describe('HeroControlService', () => {
  let service: HeroControlService;
  let ui: {
    buildMode: ReturnType<typeof signal<boolean>>;
    mapPlacementMode: ReturnType<typeof signal<string | null>>;
    abilityTargeting: ReturnType<typeof signal<string | null>>;
    photoMode: ReturnType<typeof signal<boolean>>;
    heroSelected: ReturnType<typeof signal<boolean>>;
  };
  let store: { hero: ReturnType<typeof signal<HeroStatus>>; selectedTower: ReturnType<typeof signal<object | null>> };
  let exitBuildMode: ReturnType<typeof vi.fn>;
  let cancelAiming: ReturnType<typeof vi.fn>;
  let selectTower: ReturnType<typeof vi.fn>;
  let snapTo: GeoPosition | null;
  let sent: GameEvent[];
  let heroView: {
    setSelected: ReturnType<typeof vi.fn>;
    showMoveTarget: ReturnType<typeof vi.fn>;
    hideMoveTarget: ReturnType<typeof vi.fn>;
    pickTarget: () => object;
  };
  let hits: ReturnType<typeof vi.fn>;
  let focusGeo: ReturnType<typeof vi.fn>;
  let introActive: ReturnType<typeof signal<boolean>>;

  const runEffects = () => effects.forEach((fn) => fn());

  beforeEach(() => {
    effects.length = 0;
    ui = {
      buildMode: signal(false),
      mapPlacementMode: signal(null),
      abilityTargeting: signal(null),
      photoMode: signal(false),
      heroSelected: signal(false),
    };
    store = { hero: signal(HIRED), selectedTower: signal(null) };
    exitBuildMode = vi.fn(() => ui.buildMode.set(false));
    cancelAiming = vi.fn(() => ui.abilityTargeting.set(null));
    selectTower = vi.fn((id: string | null) => store.selectedTower.set(id ? {} : null));
    injections['UIStore'] = ui;
    injections['TowerDefenseStore'] = store;
    injections['TowerPlacementService'] = { exitBuildMode };
    injections['MapPlacementService'] = { exitPlacementMode: vi.fn() };
    injections['AbilityTargetingService'] = { cancel: cancelAiming };
    focusGeo = vi.fn(() => true);
    introActive = signal(false);
    injections['CameraControlService'] = { focusGeo };
    injections['IntroCameraFlightService'] = { active: introActive };
    snapTo = { lat: 48.10001, lon: 9.10001 };
    sent = [];
    heroView = { setSelected: vi.fn(), showMoveTarget: vi.fn(), hideMoveTarget: vi.fn(), pickTarget: () => ({ id: 'hero' }) };
    hits = vi.fn(() => true);

    service = new HeroControlService();
    const engine = {
      hero: heroView,
      picker: { hits },
      sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, out: Vector3) => out.set(1, 0, 3) },
    };
    const gameState = {
      heroManager: {
        resolveMoveTarget: () => snapTo,
        getHero: () => ({ position: { lat: 48.2, lon: 9.3 } }),
      },
      towerManager: { selectTower },
      getGlobalRouteGrid: () => ({ getGroundLocalYAt: () => 7 }),
      getEventBus: () => ({ emit: (e: GameEvent) => sent.push(e) }),
    };
    service.initialize(engine as never, gameState as never);
  });

  it('selects him only once he is hired, and ends building, aiming and the tower selection first', () => {
    store.hero.set({ ...initialHeroStatus(), unlocked: true });
    expect(service.select()).toBe(false);
    expect(service.selected()).toBe(false);

    store.hero.set(HIRED);
    ui.buildMode.set(true);
    ui.abilityTargeting.set('nuclear-strike');
    expect(service.select()).toBe(true);
    expect(exitBuildMode).toHaveBeenCalled();
    expect(cancelAiming).toHaveBeenCalled();
    expect(selectTower).toHaveBeenCalledWith(null);
    expect(service.selected()).toBe(true);
  });

  it('toggles on a click on him', () => {
    service.toggle();
    expect(service.selected()).toBe(true);
    service.toggle();
    expect(service.selected()).toBe(false);
    expect(heroView.hideMoveTarget).toHaveBeenCalled();
  });

  it('summons him like G: selects him first, brings him into view the second time', () => {
    expect(service.summon()).toBe(true);
    expect(service.selected()).toBe(true);
    expect(focusGeo).not.toHaveBeenCalled();

    expect(service.summon()).toBe(true);
    expect(focusGeo).toHaveBeenCalledWith(48.2, 9.3);
    expect(service.selected()).toBe(true);
  });

  it('summons nothing before the hire or in photo mode, no camera during the intro flight', () => {
    store.hero.set({ ...initialHeroStatus(), unlocked: true });
    expect(service.summon()).toBe(false);

    store.hero.set(HIRED);
    ui.photoMode.set(true);
    expect(service.summon()).toBe(false);
    expect(service.selected()).toBe(false);

    ui.photoMode.set(false);
    service.select();
    introActive.set(true);
    expect(service.summon()).toBe(false);
    expect(focusGeo).not.toHaveBeenCalled();
  });

  it('hires him by command and leaves the checks to the HeroManager', () => {
    expect(service.hire()).toBe(true);
    expect(sent).toEqual([{ type: 'command:hire-hero' }]);
  });

  it('picks him with his model', () => {
    expect(service.pick(10, 20)).toBe(true);
    expect(hits).toHaveBeenCalledWith(10, 20, { id: 'hero' });
  });

  it('sends him with a click on the route and stays selected', () => {
    service.select();
    service.click(48.1, 9.1, 300);
    expect(sent).toEqual([{ type: 'command:hero-move', target: { lat: 48.1, lon: 9.1, height: 300 } }]);
    expect(service.selected()).toBe(true);
  });

  it('says why and sends nothing where no route is in reach', () => {
    snapTo = null;
    service.select();
    service.click(48.1, 9.1, 300);
    expect(sent).toEqual([]);
    expect(service.warning()).toBe('No route within 30 m');
  });

  it('sends nothing while he is not selected', () => {
    service.click(48.1, 9.1, 300);
    expect(sent).toEqual([]);
  });

  it('shows the move ring gold on the route point on the grid\'s ground, red at the cursor without one', () => {
    service.select();
    service.hover(48.1, 9.1, new Vector3(9, 9, 9));
    expect(heroView.showMoveTarget).toHaveBeenCalledWith(expect.objectContaining({ x: 1, y: 7, z: 3 }), true);

    snapTo = null;
    const cursor = new Vector3(9, 9, 9);
    service.hover(48.1, 9.1, cursor);
    expect(heroView.showMoveTarget).toHaveBeenLastCalledWith(cursor, false);
    expect(service.warning()).toBe('No route within 30 m');
  });

  it('switches the ammo round the list by command', () => {
    service.cycleAmmo();
    store.hero.set({ ...HIRED, ammo: 'rune' });
    service.cycleAmmo();
    expect(sent).toEqual([
      { type: 'command:hero-ammo', ammo: 'explosive' },
      { type: 'command:hero-ammo', ammo: 'standard' },
    ]);
  });

  it('sends no ammo before the hire', () => {
    store.hero.set({ ...initialHeroStatus(), unlocked: true });
    expect(service.setAmmo('rune')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('lets him go when a tower is selected, building starts or he is gone', () => {
    for (const take of [
      () => store.selectedTower.set({}),
      () => ui.buildMode.set(true),
      () => ui.photoMode.set(true),
      () => store.hero.set(initialHeroStatus()),
    ]) {
      store.selectedTower.set(null);
      ui.buildMode.set(false);
      ui.photoMode.set(false);
      store.hero.set(HIRED);
      service.select();
      take();
      runEffects();
      expect(service.selected()).toBe(false);
    }
  });

  it('draws the rings while he is selected', () => {
    service.select();
    runEffects();
    expect(heroView.setSelected).toHaveBeenLastCalledWith(true);
    service.deselect();
    runEffects();
    expect(heroView.setSelected).toHaveBeenLastCalledWith(false);
  });

  it('knows where he stands for the camera', () => {
    expect(service.position()).toEqual({ lat: 48.2, lon: 9.3 });
  });
});
