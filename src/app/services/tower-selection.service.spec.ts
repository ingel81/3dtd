import { describe, it, expect, vi, beforeEach } from 'vitest';

// The line-of-sight view is GPU work; its construction and lifetime are what count here
const vizzes: { opts: Record<string, unknown>; dispose: ReturnType<typeof vi.fn>; setFilterMode: ReturnType<typeof vi.fn> }[] = [];
vi.mock('../utils/tower-los-viz', () => ({
  TowerLosViz: class {
    readonly dispose = vi.fn();
    readonly setFilterMode = vi.fn();
    readonly addTo = vi.fn();
    readonly tick = vi.fn();
    constructor(readonly opts: Record<string, unknown>) {
      vizzes.push(this);
    }
  },
}));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));
vi.mock('./world/global-route-grid.service', () => ({ GlobalRouteGridService: class GlobalRouteGridService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TowerSelectionService } from './tower-selection.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { packet, towerDto } from '../sim/client/mirror/testing/mirror-packets';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { Tower } from '../entities/tower.entity';

const AT = { lat: 48.1, lon: 11.5, height: 520 };

describe('TowerSelectionService', () => {
  let mirror: SimMirror;
  let selection: TowerSelectionService;
  let selected: ReturnType<typeof signal<Tower | null>>;
  let revision: ReturnType<typeof signal<number>>;
  let ring: { select: ReturnType<typeof vi.fn>; deselect: ReturnType<typeof vi.fn> };

  const place = (losReady = true): Tower => {
    const real = new Tower(AT, 'archer');
    real.losReady = losReady;
    mirror.applyState(packet({ towerStates: [towerDto(real)] }));
    return real;
  };

  beforeEach(() => {
    vizzes.length = 0;
    mirror = new SimMirror();
    selected = signal<Tower | null>(null);
    revision = signal(0);
    ring = { select: vi.fn(), deselect: vi.fn() };
    const engine = {
      sync: { geoToLocalSimple: () => ({ x: 1, y: 2, z: 3 }) },
      getLosBlockerGroup: () => ({}),
      getTowerShadowMapper: () => ({}),
      getScene: () => ({}),
      towers: ring,
    };
    const injector = Injector.create({
      providers: [
        { provide: SimMirror, useValue: mirror },
        {
          provide: TowerDefenseStore,
          useValue: { selectedTower: selected, selectedTowerId: () => selected()?.id ?? null, selectedTowerRevision: revision },
        },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        {
          provide: GlobalRouteGridService,
          useValue: { isInitialized: () => true, getCellsInRange: () => [{}], getCellSize: () => 2 },
        },
      ],
    });
    selection = runInInjectionContext(injector, () => new TowerSelectionService());
  });

  it('selects the shadow tower into the store, rings it and builds its line-of-sight view', () => {
    const real = place();
    selection.select(real.id);
    const shadow = mirror.tower(real.id)!;
    expect(selected()).toBe(shadow);
    expect(selection.selectedId).toBe(real.id);
    expect(shadow.selected).toBe(true);
    expect(ring.select).toHaveBeenCalledWith(real.id);
    expect(vizzes).toHaveLength(1);
    expect(vizzes[0].opts['groundRange']).toBe(shadow.combat.range);
    expect(selection.getViz()).toBe(vizzes[0]);
  });

  it('builds no view before the line of sight is resolved, and builds it when the tower state says it is', () => {
    const real = place(false);
    selection.select(real.id);
    expect(vizzes).toHaveLength(0);

    real.losReady = true;
    mirror.applyState(packet({ towerStates: [towerDto(real)] }));
    expect(vizzes).toHaveLength(1);
    expect(revision()).toBe(1);
  });

  it('rebuilds the view on a range upgrade and keeps the filter', () => {
    const real = place();
    selection.applyLosFilter('air');
    selection.select(real.id);
    real.applyUpgrade('range');
    mirror.applyState(packet({ towerStates: [towerDto(real)] }));
    expect(vizzes).toHaveLength(2);
    expect(vizzes[0].dispose).toHaveBeenCalled();
    expect(vizzes[1].opts['groundRange']).toBe(real.combat.range);
    expect(vizzes[1].setFilterMode).toHaveBeenCalledWith('air');
  });

  it('drops the selection with a sold tower, and on select(null)', () => {
    const real = place();
    selection.select(real.id);
    mirror.applyState(packet({ removedTowers: [real.id] }));
    expect(selected()).toBeNull();
    expect(ring.deselect).toHaveBeenCalledWith(real.id);
    expect(vizzes[0].dispose).toHaveBeenCalled();

    const other = place();
    selection.select(other.id);
    selection.select(null);
    expect(selected()).toBeNull();
    expect(selection.getViz()).toBeNull();
  });

  it('follows a new shadow of the selected id (a replay seeks back before an upgrade)', () => {
    const real = place();
    real.applyUpgrade('range');
    mirror.applyState(packet({ towerStates: [towerDto(real)] }));
    selection.select(real.id);
    const before = new Tower(AT, 'archer');
    before.losReady = true;
    mirror.applyState(packet({ towerStates: [{ ...towerDto(before), id: real.id }] }));
    expect(selected()).toBe(mirror.tower(real.id));
    expect(selected()!.getUpgradeLevel('range')).toBe(0);
    expect(selected()!.selected).toBe(true);
  });
});
