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

import { AbilityTargetingService } from './ability-targeting.service';
import { lockedAbilityStatus, type AbilityRejectReason, type AbilityStatus } from '../configs/abilities.config';
import type { RouteSweep } from '../utils/route-sweep';
import type { GameEvent } from '../game-engine/game-event-bus';
import type { GeoPosition } from '../models/game.types';

const ON_ROUTE: GeoPosition = { lat: 48.1, lon: 9.1, height: 300 };
const CHARGED: AbilityStatus = { ...lockedAbilityStatus('nuclear-strike'), unlocked: true, charges: 1, launchSite: true };

describe('AbilityTargetingService', () => {
  let service: AbilityTargetingService;
  let ui: { buildMode: ReturnType<typeof signal<boolean>>; mapPlacementMode: ReturnType<typeof signal<string | null>>; abilityTargeting: ReturnType<typeof signal<string | null>> };
  let store: { waveActive: ReturnType<typeof signal<boolean>>; abilities: ReturnType<typeof signal<Record<string, AbilityStatus>>> };
  let exitBuildMode: ReturnType<typeof vi.fn>;
  let useCheck: AbilityRejectReason | null;
  let snapTo: GeoPosition | null;
  let sweep: RouteSweep | null;
  let sent: GameEvent[];
  let markers: { showAim: ReturnType<typeof vi.fn>; hideAim: ReturnType<typeof vi.fn> };
  let refuse: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    effects.length = 0;
    ui = { buildMode: signal(false), mapPlacementMode: signal(null), abilityTargeting: signal(null) };
    store = {
      waveActive: signal(true),
      abilities: signal({ 'nuclear-strike': CHARGED, 'orbital-laser': { ...CHARGED, id: 'orbital-laser' } }),
    };
    exitBuildMode = vi.fn(() => ui.buildMode.set(false));
    injections['UIStore'] = ui;
    injections['TowerDefenseStore'] = store;
    injections['TowerPlacementService'] = { exitBuildMode };
    injections['MapPlacementService'] = { exitPlacementMode: vi.fn() };
    refuse = vi.fn();
    injections['RefusalHintService'] = { ability: refuse };
    useCheck = null;
    snapTo = { lat: 48.10001, lon: 9.10001, height: 301 };
    sweep = null;
    sent = [];
    markers = { showAim: vi.fn(), hideAim: vi.fn() };

    service = new AbilityTargetingService();
    const engine = {
      abilityMarkers: markers,
      sync: { geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, out: Vector3) => out.set(1, 2, 3) },
    };
    const gameState = {
      abilityManager: { checkUse: () => useCheck, resolveTarget: () => snapTo, previewSweep: () => sweep },
      getEventBus: () => ({ emit: (e: GameEvent) => sent.push(e) }),
    };
    service.initialize(engine as never, gameState as never);
  });

  it('arms only when the ability can fire, and ends build mode first', () => {
    useCheck = 'no-wave';
    service.start('nuclear-strike');
    expect(service.targeting()).toBeNull();
    // The manager's reason goes to the context hint box
    expect(refuse).toHaveBeenCalledWith('nuclear-strike', 'no-wave');

    useCheck = null;
    ui.buildMode.set(true);
    service.start('nuclear-strike');
    expect(exitBuildMode).toHaveBeenCalled();
    expect(service.targeting()).toBe('nuclear-strike');
    expect(refuse).toHaveBeenCalledTimes(1);
  });

  it('toggles: a second press leaves the mode and hides the ring', () => {
    service.toggle('nuclear-strike');
    service.toggle('nuclear-strike');
    expect(service.targeting()).toBeNull();
    expect(markers.hideAim).toHaveBeenCalled();
  });

  it('shows the ring gold on the route cell the strike would land on', () => {
    service.start('nuclear-strike');
    service.hover(48.1, 9.1, new Vector3(9, 9, 9));
    expect(markers.showAim).toHaveBeenCalledWith(expect.objectContaining({ x: 1, y: 2, z: 3 }), 25, true);
    expect(service.warning()).toBeNull();
  });

  it('shows the ring red at the cursor and warns where no route is in reach', () => {
    snapTo = null;
    service.start('nuclear-strike');
    const cursor = new Vector3(9, 9, 9);
    service.hover(48.1, 9.1, cursor);
    expect(markers.showAim).toHaveBeenCalledWith(cursor, 25, false);
    expect(service.warning()).toBe('No route within 30 m');
  });

  it('shows a beam the ring where its sweep starts and the band of the stretch it would burn', () => {
    sweep = { points: [{ lat: 48.1, lon: 9.1 }, { lat: 48.0995, lon: 9.1 }], cumulative: [0, 55], length: 55 };
    service.start('orbital-laser');
    service.hover(48.1, 9.1, new Vector3(9, 9, 9));
    expect(markers.showAim).toHaveBeenCalledWith(expect.objectContaining({ x: 1, y: 2, z: 3 }), 5, true, [
      expect.objectContaining({ x: 1, y: 2, z: 3 }),
      expect.objectContaining({ x: 1, y: 2, z: 3 }),
    ]);
    expect(service.warning()).toBeNull();

    sweep = null;
    const cursor = new Vector3(9, 9, 9);
    service.hover(48.2, 9.2, cursor);
    expect(markers.showAim).toHaveBeenLastCalledWith(cursor, 5, false);
    expect(service.warning()).toBe('No route within 30 m');
  });

  it('fires the clicked point and leaves the mode', () => {
    service.start('nuclear-strike');
    service.click(ON_ROUTE.lat, ON_ROUTE.lon, ON_ROUTE.height!);
    expect(sent).toEqual([{ type: 'command:use-ability', abilityId: 'nuclear-strike', target: ON_ROUTE }]);
    expect(service.targeting()).toBeNull();
  });

  it('stays in the mode and says why when the click finds no route', () => {
    snapTo = null;
    service.start('nuclear-strike');
    service.click(ON_ROUTE.lat, ON_ROUTE.lon, ON_ROUTE.height!);
    expect(sent).toEqual([]);
    expect(service.targeting()).toBe('nuclear-strike');
    expect(service.warning()).toBe('No route within 30 m');
  });

  it('leaves the mode when the wave ends or build mode starts', () => {
    const [onAbility, onPointerModes] = effects;
    service.start('nuclear-strike');
    store.waveActive.set(false);
    onAbility();
    expect(service.targeting()).toBeNull();

    store.waveActive.set(true);
    service.start('nuclear-strike');
    ui.buildMode.set(true);
    onPointerModes();
    expect(service.targeting()).toBeNull();
  });

  it('leaves the mode when the missile silo it launches from is sold while aiming', () => {
    const [onAbility] = effects;
    service.start('nuclear-strike');
    onAbility();
    expect(service.targeting()).toBe('nuclear-strike');

    // GameStateSyncService writes the snapshot TowerLifecycle.sell asked for
    store.abilities.update((all) => ({ ...all, 'nuclear-strike': { ...CHARGED, launchSite: false } }));
    onAbility();
    expect(service.targeting()).toBeNull();
    expect(markers.hideAim).toHaveBeenCalled();
  });
});
