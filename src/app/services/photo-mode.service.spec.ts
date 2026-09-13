import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed. The real modules pull in the engine, and
// the partially compiled CDK needs the JIT compiler under vitest.
vi.mock('@angular/cdk/a11y', () => ({ LiveAnnouncer: class LiveAnnouncer {} }));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));
vi.mock('./ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('./location/location-management.service', () => ({
  LocationManagementService: class LocationManagementService {},
}));
vi.mock('../core/services/config.service', () => ({ ConfigService: class ConfigService {} }));
vi.mock('../devworld/devworld.service', () => ({ DevWorldService: class DevWorldService {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));
vi.mock('../store/tower-defense.store', () => ({ TowerDefenseStore: class TowerDefenseStore {} }));

// afterNextRender runs when the test has drawn the frame.
const rendered = vi.hoisted(() => [] as (() => void)[]);
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@angular/core')>()),
  afterNextRender: (callback: () => void) => {
    rendered.push(callback);
  },
}));

import { ElementRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { PhotoModeService } from './photo-mode.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { LocationManagementService } from './location/location-management.service';
import { ConfigService } from '../core/services/config.service';
import { DevWorldService } from '../devworld/devworld.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';

/**
 * Photo mode hides the HUD, and with it the control that had the focus: the
 * photo bar takes the focus, leaving gives it back with the quick menu that
 * was open, and a screen reader hears both changes.
 */
describe('PhotoModeService focus', () => {
  let host: HTMLElement;
  let trigger: HTMLButtonElement;
  let save: HTMLButtonElement;
  let openMenu: ReturnType<typeof signal<string | null>>;
  let announce: ReturnType<typeof vi.fn>;
  let service: PhotoModeService;
  /** What EngineInitializationService.getEngine() hands out */
  let engine: unknown;

  const drawFrame = () => rendered.splice(0).forEach((callback) => callback());

  beforeEach(() => {
    rendered.length = 0;
    engine = null;
    trigger = document.createElement('button');
    host = document.createElement('div');
    host.innerHTML = '<div class="td-photo-bar"><button>Save screenshot</button><button>Exit</button></div>';
    save = host.querySelector('button')!;
    document.body.append(trigger, host);

    openMenu = signal<string | null>('display');
    announce = vi.fn();
    const injector = Injector.create({
      providers: [
        { provide: UIStore, useValue: { photoMode: signal(false), openMenu, mapPlacementMode: signal(false) } },
        { provide: TowerDefenseStore, useValue: { loading: signal(false), error: signal(null) } },
        { provide: GameStateManager, useValue: { towerManager: { selectTower: vi.fn() } } },
        { provide: TowerPlacementService, useValue: { buildMode: signal(false) } },
        { provide: MapPlacementService, useValue: {} },
        { provide: AbilityTargetingService, useValue: { targeting: signal(null) } },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: LocationManagementService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: DevWorldService, useValue: {} },
        { provide: LiveAnnouncer, useValue: { announce } },
        { provide: ElementRef, useValue: new ElementRef(host) },
      ],
    });
    service = runInInjectionContext(injector, () => new PhotoModeService());
  });

  afterEach(() => {
    trigger.remove();
    host.remove();
  });

  it('puts the focus on the save button, and gives it back with the open menu on exit', () => {
    trigger.focus();
    service.enter();
    expect(openMenu()).toBeNull();
    drawFrame();
    expect(document.activeElement).toBe(save);

    service.exit();
    expect(openMenu()).toBe('display');
    drawFrame();
    expect(document.activeElement).toBe(trigger);
  });

  it('announces entering and leaving', () => {
    service.enter();
    service.exit();
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      'Photo mode. Esc leaves it.',
      'Photo mode left.',
    ]);
  });

  describe('Tab', () => {
    const tab = (shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
      service.trapTab(event);
      return event;
    };
    const exit = () => host.querySelectorAll('button')[1];

    it('stays in the bar: from the last button to the first and back', () => {
      service.enter();
      drawFrame();
      expect(tab().defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(exit());
      tab();
      expect(document.activeElement).toBe(save);
      tab(true);
      expect(document.activeElement).toBe(exit());
    });

    it('brings the focus back into the bar from elsewhere on the page', () => {
      service.enter();
      drawFrame();
      trigger.focus();
      tab();
      expect(document.activeElement).toBe(save);
      trigger.focus();
      tab(true);
      expect(document.activeElement).toBe(exit());
    });

    it('is left alone outside photo mode', () => {
      trigger.focus();
      expect(tab().defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('hides the veteran badges over the towers while it is on', () => {
    const setVisible = vi.fn();
    engine = { towerBadges: { setVisible }, fitToCanvas: vi.fn() };

    service.enter();
    expect(setVisible).toHaveBeenLastCalledWith(false);
    service.exit();
    expect(setVisible).toHaveBeenLastCalledWith(true);
  });

  it('leaves the focus where it is when the element it came from is gone', () => {
    trigger.focus();
    service.enter();
    drawFrame();
    trigger.remove();

    service.exit();
    drawFrame();

    expect(document.activeElement).toBe(save);
  });
});
